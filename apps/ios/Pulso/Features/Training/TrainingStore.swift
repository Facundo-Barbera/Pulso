import Foundation
import Observation

/// The end of a session as the summary shows it. `prs` and `uploaded` fill in
/// once the Mac answers; a session that couldn't reach it waits on disk.
struct SessionSummary: Identifiable {
    var session: TrainingSession
    var prs: [TrainingRecord] = []
    /// Exercises passed over, by name.
    var skipped: [String] = []
    var uploaded = false
    var savedToHealth = false

    var id: String { session.id }
}

@MainActor
@Observable
final class TrainingStore {
    static let shared = TrainingStore()

    private(set) var program: TrainingProgram?
    private(set) var nextDayId: String?
    private(set) var suggestions: [String: LoadSuggestion] = [:]
    private(set) var hrZones: [HrZoneRange]?
    /// Kept on disk too: the gym may have no signal, and the units must still be right.
    private(set) var settings = TrainingFiles.load(TrainingSettings.self, from: TrainingFiles.settings) ?? TrainingSettings(preferredEquipment: []) {
        didSet { if settings != oldValue { TrainingFiles.save(settings, to: TrainingFiles.settings) } }
    }
    private(set) var sessions: [TrainingSession] = []
    private(set) var loaded = false
    /// Latest weighed scan, newest first from the Cuerpo dashboard.
    private(set) var bodyWeightKg: Double?
    private(set) var finishing = false
    var live: LiveSession? = LiveSession.restore()
    var summary: SessionSummary?
    /// Set by the live screen as it closes; the tab finishes once the cover is gone,
    /// so the summary sheet never races the dismissal.
    var finishRequested = false

    var nextDay: ProgramDay? { program?.days.first { $0.id == nextDayId } ?? program?.days.first }

    func load() async {
        guard let api = PulsoModel.shared.api else { return }
        await uploadPending(api)
        do {
            async let view = api.trainingProgram()
            async let recent = api.trainingSessions()
            let (response, list) = try await (view, recent)
            apply(response)
            sessions = list
        } catch {
            PulsoModel.shared.handle(error)
        }
        loaded = true
        // Only for the kcal estimate: a failure just hides it.
        if let scans = try? await api.bodyDashboard().scans {
            bodyWeightKg = scans.lazy.compactMap(\.weight).first
        }
    }

    /// Takes the program as the engine returns it after a load or an edit.
    func apply(_ response: ActiveProgramResponse) {
        program = response.program
        nextDayId = response.nextDayId
        suggestions = response.suggestions
        hrZones = response.hrZones
        if let fresh = response.settings { adopt(fresh) }
    }

    /// Rewrites a day (solo hoy or para siempre) and shows the result. Throws so the editor can stay open.
    func saveDay(_ dayId: String, scope: EditScope, exercises: [DayExerciseInput]) async throws {
        guard let api = PulsoModel.shared.api else { return }
        apply(try await api.saveProgramDay(dayId, edit: DayEdit(scope: scope, exercises: exercises)))
    }

    /// Drops today's one-off changes to a day.
    func resetDay(_ dayId: String) async {
        guard let api = PulsoModel.shared.api else { return }
        do { apply(try await api.resetProgramDay(dayId)) } catch { PulsoModel.shared.handle(error) }
    }

    func savePreferredEquipment(_ equipment: [String]) async {
        var new = settings
        new.preferredEquipment = equipment
        await saveSettings(new, TrainingSettingsUpdate(preferredEquipment: equipment))
    }

    // MARK: Units

    /// The unit an exercise (library id) is shown, typed and stepped in.
    func unit(for exerciseId: String) -> WeightUnit { settings.unit(for: exerciseId) }

    var defaultUnit: WeightUnit { settings.defaultUnit }

    /// "Unidad por defecto". Exercises following it change too, open sets in the live session included.
    func setDefaultUnit(_ unit: WeightUnit) async {
        guard unit != settings.defaultUnit else { return }
        var new = settings
        new.defaultUnit = unit
        await saveSettings(new, TrainingSettingsUpdate(defaultUnit: unit))
    }

    /// The unit of one exercise's machine. A property of the exercise, not of a
    /// day: it sticks for every session and applies at once (before the Mac
    /// answers), open sets snapping to it; reverted if the Mac refuses.
    @discardableResult
    func setUnit(_ unit: WeightUnit, for exerciseId: String) -> Task<Void, Never>? {
        guard unit != self.unit(for: exerciseId), let api = PulsoModel.shared.api else { return nil }
        let old = settings
        var new = settings
        new.exerciseUnits[exerciseId] = unit
        adopt(new)
        return Task {
            do { adopt(try await api.setExerciseUnit(exerciseId, unit: unit)) } catch {
                adopt(old)
                PulsoModel.shared.handle(error)
            }
        }
    }

    /// Shown at once, reverted when the Mac refuses.
    private func saveSettings(_ new: TrainingSettings, _ update: TrainingSettingsUpdate) async {
        guard let api = PulsoModel.shared.api else { return }
        let old = settings
        adopt(new)
        do { adopt(try await api.saveTrainingSettings(update)) } catch {
            adopt(old)
            PulsoModel.shared.handle(error)
        }
    }

    /// New settings; the live session's open sets move onto any exercise's new unit.
    private func adopt(_ new: TrainingSettings) {
        let old = settings
        settings = new
        live?.snapOpenSets { new.unit(for: $0) != old.unit(for: $0) ? new.unit(for: $0) : nil }
    }

    /// Opens the live session for `day` and hands it to the engine, where the Coach can change it.
    func start(_ day: ProgramDay) {
        guard live == nil else { return }
        let session = LiveSession(state: LiveSessionState(day: day, programId: program?.id, suggestions: suggestions))
        session.begin()
        live = session
    }

    /// Drops the session here and (best effort) on the engine.
    func discard() async {
        await live?.close()
        live = nil
    }

    /// Ends the live session: Salud first (it needs no network), then the Mac.
    /// The summary shows right away and fills in records when the Mac answers.
    func finish() async {
        guard let live, !finishing else { return }
        finishing = true
        defer { finishing = false }
        let state = live.state
        let session = state.session(endedAt: .now)
        let cardio = state.exercises.compactMap { ex in ex.cardioLog.map { (log: $0, modality: ex.modality) } }
        await live.close()
        self.live = nil
        summary = SessionSummary(session: session, skipped: state.skippedNames)
        guard state.hasWork else { return }

        // Salud refusing or being unavailable doesn't stop the session going to the Mac.
        var savedToHealth = false
        if !session.sets.isEmpty, (try? await StrengthWorkout.save(start: session.start, end: session.start.addingTimeInterval(session.duration), sessionId: session.id)) != nil {
            savedToHealth = true
        }
        for (index, block) in cardio.enumerated() {
            if (try? await StrengthWorkout.saveCardio(block.log, modality: block.modality, sessionId: session.id, index: index)) != nil {
                savedToHealth = true
            }
        }
        if savedToHealth, summary?.id == session.id { summary?.savedToHealth = true }

        guard let api = PulsoModel.shared.api else { return queue(session) }
        do {
            let saved = try await api.saveTrainingSession(session)
            if summary?.id == session.id {
                summary?.prs = saved.prs
                summary?.uploaded = true
            }
            await load()
        } catch {
            queue(session)
            PulsoModel.shared.handle(error)
        }
    }

    // MARK: Offline queue

    private var pending: [TrainingSession] {
        get { TrainingFiles.load([TrainingSession].self, from: TrainingFiles.pending) ?? [] }
        set { newValue.isEmpty ? TrainingFiles.remove(TrainingFiles.pending) : TrainingFiles.save(newValue, to: TrainingFiles.pending) }
    }

    private func queue(_ session: TrainingSession) {
        pending = pending.filter { $0.id != session.id } + [session]
    }

    /// Retries sessions finished while the Mac was unreachable. The engine upserts by id.
    private func uploadPending(_ api: PulsoAPI) async {
        for session in pending {
            guard (try? await api.saveTrainingSession(session)) != nil else { return }
            pending = pending.filter { $0.id != session.id }
        }
    }
}
