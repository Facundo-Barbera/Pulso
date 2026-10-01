import Foundation
import Observation
import os

/// The end of a session as the summary shows it. `prs` and `uploaded` fill in
/// once the Mac answers; a session that couldn't reach it waits on disk.
struct SessionSummary: Identifiable {
    var session: TrainingSession
    var prs: [TrainingRecord] = []
    /// The Mac couldn't be reached or refused it; it stays queued and "Reintentar" shows.
    var uploadFailed = false
    /// Exercises passed over, by name.
    var skipped: [String] = []
    /// Cardio blocks ended early, done against planned: "Cinta · 12 de 20 min".
    var cutShort: [String] = []
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
    /// Every block, oldest first, the active one last.
    private(set) var blocks: [TrainingBlock] = []
    /// The Coach's review of the next day, when there is one.
    private(set) var adjustment: NextAdjustment?
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

    /// The next day not done this week; nil with no program or the week complete.
    var nextDay: ProgramDay? {
        guard let program else { return nil }
        // An older engine sends no blocks and may send no next day: its first, as before.
        if blocks.isEmpty { return program.days.first { $0.id == nextDayId } ?? program.days.first }
        return program.days.first { $0.id == nextDayId }
    }

    /// The active program's block.
    var activeBlock: TrainingBlock? { blocks.first { $0.programId == program?.id } }

    /// What starting `day` uses: the Coach's adjusted copy of it when one applies.
    private func dayToStart(_ day: ProgramDay) -> (ProgramDay, [String: LoadSuggestion]) {
        if let adjustment, adjustment.dayId == day.id, adjustment.applies { return (adjustment.day, adjustment.suggestions) }
        return (day, suggestions)
    }

    func load() async {
        guard let api = PulsoModel.shared.api else { return }
        await uploadPending()
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
        blocks = response.blocks ?? []
        adjustment = response.adjustment
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

    // MARK: Weeks, blocks and the Coach's review

    /// "Empezar la semana ya".
    func startNextWeek() async {
        guard let api = PulsoModel.shared.api else { return }
        do { apply(try await api.startNextWeek()) } catch { PulsoModel.shared.handle(error) }
    }

    /// "Retomar" an earlier block.
    func resume(_ block: TrainingBlock) async {
        guard let api = PulsoModel.shared.api else { return }
        do { apply(try await api.resumeBlock(block.programId)) } catch { PulsoModel.shared.handle(error) }
    }

    /// "Entrenar normal" (true) or back to the Coach's plan (false). Shown at once.
    func setAdjustmentDismissed(_ dismissed: Bool) async {
        guard let api = PulsoModel.shared.api, let current = adjustment else { return }
        adjustment?.dismissed = dismissed
        do { apply(try await api.setAdjustmentDismissed(current.id, dismissed)) } catch {
            adjustment?.dismissed = current.dismissed
            PulsoModel.shared.handle(error)
        }
    }

    /// "Ver por qué": opens the review in a Coach thread.
    func discussAdjustment() async {
        guard let api = PulsoModel.shared.api, let adjustment else { return }
        do {
            let threadId = try await api.adjustmentThread(adjustment.id)
            let detail = try await api.agentThread(threadId)
            CoachLauncher.shared.open(detail.thread)
        } catch {
            PulsoModel.shared.handle(error)
        }
    }

    /// A logged session by id: from the recent list, else from the Mac.
    func session(_ id: String) async -> TrainingSession? {
        if let known = sessions.first(where: { $0.id == id }) { return known }
        guard let api = PulsoModel.shared.api else { return nil }
        do { return try await api.trainingSession(id) } catch {
            PulsoModel.shared.handle(error)
            return nil
        }
    }

    /// Opens the live session for `day` (the Coach's adjusted copy of it when one applies)
    /// and hands it to the engine, where the Coach can change it.
    func start(_ day: ProgramDay) {
        guard live == nil else { return }
        let (day, suggestions) = dayToStart(day)
        let session = LiveSession(state: LiveSessionState(day: day, programId: program?.id, suggestions: suggestions))
        session.begin()
        live = session
    }

    /// Drops the session here and on the engine, saving nothing.
    func discard() async {
        await live?.close()
        live = nil
        if let api = PulsoModel.shared.api { Task { try? await api.deleteLiveSession(discard: true) } }
    }

    /// Ends the live session. The finished session is on disk (the upload queue)
    /// before anything can fail, hang or be killed; then it goes to the Mac, and
    /// only once the Mac has it is the engine's live copy dropped. Salud runs
    /// beside it, so a permission sheet left open can't hold the session back.
    /// The summary shows right away and fills in as the answers come.
    func finish() async {
        guard let live, !finishing else { return }
        finishing = true
        defer { finishing = false }
        let state = live.state
        let session = state.session(endedAt: .now)
        let cardio = state.exercises.compactMap { ex in ex.cardioLog.map { (log: $0, modality: ex.modality) } }
        if state.hasWork { queue.add(session) }
        await live.close()
        self.live = nil
        summary = SessionSummary(session: session, skipped: state.skippedNames, cutShort: state.exercises.compactMap(\.cutShortSummary))
        guard state.hasWork else {
            if let api = PulsoModel.shared.api { Task { try? await api.deleteLiveSession(discard: true) } }
            return
        }
        Task { await saveToHealth(session, cardio: cardio) }
        guard await upload(session) else { return }
        // A session started meanwhile is the engine's live copy now: leave that one.
        if self.live == nil, let api = PulsoModel.shared.api { try? await api.deleteLiveSession() }
        await load()
    }

    /// "Reintentar" on the summary of a session the Mac didn't get.
    func retryUpload() async {
        guard let summary, !summary.uploaded else { return }
        self.summary?.uploadFailed = false
        if await upload(summary.session) { await load() }
    }

    /// Salud refusing, unavailable or waiting on its permission sheet doesn't touch the Mac's copy.
    private func saveToHealth(_ session: TrainingSession, cardio: [(log: CardioLog, modality: String?)]) async {
        var saved = false
        if !session.sets.isEmpty, (try? await StrengthWorkout.save(start: session.start, end: session.start.addingTimeInterval(session.duration), sessionId: session.id)) != nil {
            saved = true
        }
        for (index, block) in cardio.enumerated() {
            if (try? await StrengthWorkout.saveCardio(block.log, modality: block.modality, sessionId: session.id, index: index)) != nil { saved = true }
        }
        if saved, summary?.id == session.id { summary?.savedToHealth = true }
    }

    // MARK: Upload queue

    private static let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "Pulso", category: "training")
    private let queue = SessionQueue(url: TrainingFiles.pending)
    private var uploading = false

    /// Posts one finished session (the engine upserts by id). It leaves the queue
    /// only once the Mac has it; a failure is logged and shown, never swallowed.
    private func upload(_ session: TrainingSession) async -> Bool {
        guard let api = PulsoModel.shared.api else { return false }
        do {
            let saved = try await api.saveTrainingSession(session)
            queue.remove(session.id)
            if summary?.id == session.id {
                summary?.prs = saved.prs
                summary?.uploaded = true
                summary?.uploadFailed = false
            }
            return true
        } catch {
            Self.log.error("Session \(session.id, privacy: .public) didn't reach the Mac: \(String(describing: error), privacy: .public)")
            if summary?.id == session.id { summary?.uploadFailed = true }
            PulsoModel.shared.handle(error)
            return false
        }
    }

    /// Sends the sessions still queued, oldest first: at launch, back in the
    /// foreground and with every load. Stops at the first failure, which shows.
    func uploadPending() async {
        guard !uploading else { return }
        uploading = true
        defer { uploading = false }
        for session in queue.items {
            guard await upload(session) else { return }
        }
    }
}

/// Finished sessions waiting for the Mac, as JSON on disk: the model, not bytes,
/// so each upload encodes it afresh (and sanitized). A file that no longer reads
/// is set aside rather than written over.
struct SessionQueue {
    let url: URL

    var items: [TrainingSession] { (try? JSONDecoder().decode([TrainingSession].self, from: Data(contentsOf: url))) ?? [] }

    func add(_ session: TrainingSession) {
        write(items.filter { $0.id != session.id } + [session.sanitized])
    }

    func remove(_ id: String) {
        write(items.filter { $0.id != id })
    }

    private func write(_ sessions: [TrainingSession]) {
        let manager = FileManager.default
        if manager.fileExists(atPath: url.path), (try? JSONDecoder().decode([TrainingSession].self, from: Data(contentsOf: url))) == nil {
            try? manager.moveItem(at: url, to: url.deletingPathExtension().appendingPathExtension("unreadable-\(Int(Date.now.timeIntervalSince1970)).json"))
        }
        if sessions.isEmpty { TrainingFiles.remove(url) } else { TrainingFiles.save(sessions, to: url) }
    }
}
