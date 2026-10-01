import Foundation
import Observation

/// The end of a session as the summary shows it. `prs` and `uploaded` fill in
/// once the Mac answers; a session that couldn't reach it waits on disk.
struct SessionSummary: Identifiable {
    var session: TrainingSession
    var prs: [TrainingRecord] = []
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
    private(set) var sessions: [TrainingSession] = []
    private(set) var loaded = false
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
            program = response.program
            nextDayId = response.nextDayId
            suggestions = response.suggestions
            sessions = list
        } catch {
            PulsoModel.shared.handle(error)
        }
        loaded = true
    }

    func start(_ day: ProgramDay) {
        guard live == nil else { return }
        let session = LiveSession(state: LiveSessionState(day: day, programId: program?.id, suggestions: suggestions))
        session.begin()
        live = session
    }

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
        let session = live.state.session(endedAt: .now)
        await live.close()
        self.live = nil
        summary = SessionSummary(session: session)
        guard !session.sets.isEmpty else { return }

        do {
            try await StrengthWorkout.save(start: session.start, end: session.start.addingTimeInterval(session.duration), sessionId: session.id)
            summary?.savedToHealth = true
        } catch {
            // Salud refused or is unavailable; the session still goes to the Mac.
        }

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
