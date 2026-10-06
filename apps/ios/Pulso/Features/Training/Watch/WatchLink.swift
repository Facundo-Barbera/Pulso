import HealthKit
import Observation
import os

/// The phone's side of the Watch. The session is one: the phone owns it and
/// the Watch keeps a copy it can change on its own, with or without a
/// connection (see WatchShared/SessionSync.swift). Here:
/// - every change of the session (and the next day's plan) is published to the Watch;
/// - the Watch's edits are applied (the latest wins), and acknowledged;
/// - starting a session opens Pulso on the Watch, which records the workout and
///   sends its heart rate, energy and distance live.
/// What the Watch recorded, the phone doesn't write to Salud again on finish.
@MainActor
@Observable
final class WatchLink: NSObject {
    static let shared = WatchLink()

    /// The Watch's latest numbers; nil while it isn't recording (or not heard from).
    private(set) var metrics: WatchMetrics?
    private var mirrored: HKWorkoutSession?
    private var recorded = Recorded.load()
    /// The last session that ended, told to the Watch so it ends its recording too.
    private var closed: WatchSync.Closed?
    /// Ids of the Watch's edits applied here, sent back so it stops replaying them.
    private var applied: [String] = UserDefaults.standard.stringArray(forKey: WatchLink.appliedKey) ?? []
    private var publishing: Task<Void, Never>?

    private static let appliedKey = "pulso.training.watchApplied"
    private static let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "Pulso", category: "watch")

    var connected: Bool { metrics != nil }

    /// What the Watch recorded for a session: kept on disk, so a relaunch before
    /// "Terminar" still knows not to write it to Salud twice.
    struct Recorded: Codable, Equatable {
        var sessionId: String
        var strength = false
        /// Live exercise ids of the cardio blocks.
        var cardio: Set<String> = []

        private static let key = "pulso.training.watchRecorded"

        static func load() -> Recorded? {
            UserDefaults.standard.data(forKey: key).flatMap { try? JSONDecoder().decode(Recorded.self, from: $0) }
        }

        func save() { UserDefaults.standard.set(try? JSONEncoder().encode(self), forKey: Self.key) }

        static func clear() { UserDefaults.standard.removeObject(forKey: key) }
    }

    /// At launch: the Watch's workout is mirrored back only to an app listening from the start.
    func activate() {
        HealthSync.store.workoutSessionMirroringStartHandler = { session in
            Task { @MainActor in WatchLink.shared.adopt(session) }
        }
        WatchChannel.shared.receive = { message in WatchLink.shared.handle(message) }
        WatchChannel.shared.reachable = { WatchLink.shared.publish() }
        WatchChannel.shared.activate()
    }

    // MARK: Session lifecycle

    /// The session `sessionId` began. Started here, it opens Pulso on the Watch;
    /// started on the Watch (`launch` false), the Watch is already recording.
    func began(sessionId: String, launch: Bool) {
        recorded = Recorded(sessionId: sessionId)
        recorded?.save()
        closed = nil
        metrics = nil
        publish()
        guard launch, HKHealthStore.isHealthDataAvailable() else { return }
        Task {
            do {
                try await HealthSync.store.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [HKQuantityType(.heartRate)])
                try await HealthSync.store.startWatchApp(toHandle: WorkoutStage.strength.configuration)
            } catch {
                // No Watch, Pulso not installed on it, or no permission: the phone carries on alone.
                Self.log.error("watch not started: \(error)")
            }
        }
    }

    /// The session ended (saved or thrown away): the Watch ends its recording.
    /// Returns what the Watch recorded, so the phone writes only the rest to Salud.
    @discardableResult
    func ended(sessionId: String, saved: Bool) -> Recorded? {
        let done = recorded?.sessionId == sessionId ? recorded : nil
        closed = WatchSync.Closed(id: sessionId, saved: saved)
        recorded = nil
        Recorded.clear()
        publish()
        return done
    }

    // MARK: To the Watch

    /// The session (or the plan, without one), soon: changes in a burst go as one.
    func publish() {
        publishing?.cancel()
        publishing = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            let store = TrainingStore.shared
            let state = store.live?.state
            let plan = state == nil ? store.watchPlan : nil
            let ids = state?.exercises.map(\.exerciseId) ?? plan?.day.exercises.map(\.exerciseId) ?? []
            let units = Dictionary(ids.map { ($0, store.unit(for: $0)) }, uniquingKeysWith: { first, _ in first })
            let sync = WatchSync(state: state, closed: closed, applied: Array(applied.suffix(200)), units: units, plan: plan, hrZones: store.hrZones)
            WatchChannel.shared.send(.sync(sync))
            WatchChannel.shared.publish(.sync(sync))
        }
    }

    // MARK: From the Watch

    private func handle(_ message: WatchMessage) {
        switch message {
        case .metrics(let metrics): receive(metrics)
        case .stopped: metrics = nil
        case .edits(let edits): Task { await apply(edits) }
        case .sync: break
        }
    }

    private func apply(_ edits: [WatchEdit]) async {
        let fresh = edits.filter { !applied.contains($0.id) }
        guard !fresh.isEmpty else { return publish() }
        applied.append(contentsOf: fresh.map(\.id))
        applied = Array(applied.suffix(300))
        UserDefaults.standard.set(applied, forKey: Self.appliedKey)
        let store = TrainingStore.shared
        for edit in fresh {
            switch edit.change {
            case .start(let state): store.adoptFromWatch(state)
            case .unit(let id, let unit): _ = store.setUnit(unit, for: id)
            case .finish(let save):
                guard store.live?.state.id == edit.sessionId else { continue }
                if save { await store.finish() } else { await store.discard() }
            default:
                store.live?.applyWatch(edit)
            }
        }
        publish()
    }

    private func receive(_ metrics: WatchMetrics) {
        self.metrics = metrics
        guard var recorded, let live = TrainingStore.shared.live, live.state.id == recorded.sessionId else { return }
        // Only what the Watch actually records counts: then the phone won't save it again.
        if metrics.stage == .strength {
            recorded.strength = true
        } else if let block = live.state.runningCardio {
            recorded.cardio.insert(block.id)
        }
        if recorded != self.recorded {
            self.recorded = recorded
            recorded.save()
        }
    }

    // MARK: Mirroring (the numbers, on devices)

    private func adopt(_ session: HKWorkoutSession) {
        mirrored = session
        session.delegate = self
    }

    private func ended(_ session: HKWorkoutSession) {
        guard session === mirrored else { return }
        mirrored = nil
    }
}

extension WatchLink: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
        guard toState == .ended || toState == .stopped else { return }
        Task { @MainActor in ended(workoutSession) }
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        Task { @MainActor in ended(workoutSession) }
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didDisconnectFromRemoteDeviceWithError error: Error?) {
        Task { @MainActor in ended(workoutSession) }
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didReceiveDataFromRemoteWorkoutSession data: [Data]) {
        let messages = data.compactMap(WatchMessage.decode)
        Task { @MainActor in for message in messages { handle(message) } }
    }
}
