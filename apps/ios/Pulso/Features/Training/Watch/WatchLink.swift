import HealthKit
import Observation
import os

/// The Apple Watch's side of the live session. Starting a session opens Pulso
/// on the Watch (`startWatchApp`), which records a workout with its sensors and
/// mirrors it here: heart rate, energy and distance arrive live. A cardio block
/// switches the Watch to that kind of workout and back to strength after, so
/// each lands in Fitness as its own workout and fills the rings. What the Watch
/// recorded, the phone doesn't write to Salud again on finish.
///
/// Without a Watch (or with Pulso not on it) nothing happens and the phone
/// saves to Salud as before.
@MainActor
@Observable
final class WatchLink: NSObject {
    static let shared = WatchLink()

    /// The Watch's latest numbers; nil while nothing is mirrored.
    private(set) var metrics: WatchMetrics?
    private var mirrored: HKWorkoutSession?
    /// Commands said before the Watch's workout reached the phone.
    private var pending: [WatchCommand] = []
    /// The cardio block (live exercise id) the Watch is switched to, if any.
    private var cardioBlock: String?
    private var recorded = Recorded.load()

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
    }

    /// At launch: the Watch's workout comes back mirrored only to an app listening from the start.
    func activate() {
        HealthSync.store.workoutSessionMirroringStartHandler = { session in
            Task { @MainActor in WatchLink.shared.adopt(session) }
        }
        // The second road, for when mirroring can't carry the messages (and on simulators).
        WatchChannel.shared.receive = { message in WatchLink.shared.handle(message) }
        WatchChannel.shared.reachable = { WatchLink.shared.flush() }
        WatchChannel.shared.activate()
    }

    /// The session `sessionId` began: the Watch starts recording strength.
    func start(sessionId: String) {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        recorded = Recorded(sessionId: sessionId)
        recorded?.save()
        cardioBlock = nil
        metrics = nil
        pending = []
        let stage = WorkoutStage.strength
        Task {
            do {
                try await HealthSync.store.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [HKQuantityType(.heartRate)])
                try await HealthSync.store.startWatchApp(toHandle: stage.configuration)
            } catch {
                // No Watch, Pulso not installed on it, or no permission: the phone carries on alone.
                Self.log.error("watch not started: \(error)")
            }
        }
    }

    /// A cardio block's clock started: the Watch records that kind of workout.
    func enterCardio(_ blockId: String, stage: WorkoutStage) {
        guard recorded != nil, cardioBlock != blockId else { return }
        cardioBlock = blockId
        send(.stage(stage))
    }

    /// Back to the sets after a cardio block.
    func enterStrength() {
        guard recorded != nil, cardioBlock != nil else { return }
        cardioBlock = nil
        send(.stage(.strength))
    }

    /// The session finished (`save`) or was thrown away: the Watch ends its workout.
    /// Returns what it recorded, so the phone writes only the rest to Salud.
    @discardableResult
    func end(save: Bool) -> Recorded? {
        let done = recorded
        send(.end(save: save))
        recorded = nil
        Recorded.clear()
        cardioBlock = nil
        return done
    }

    // MARK: Mirroring

    private func adopt(_ session: HKWorkoutSession) {
        mirrored = session
        session.delegate = self
        flush()
    }

    /// What waited for a road to the Watch.
    private func flush() {
        let queued = pending
        pending = []
        for command in queued { send(command) }
    }

    /// By the mirrored session, else by WatchConnectivity, else kept until one opens.
    private func send(_ command: WatchCommand) {
        guard let mirrored else {
            if !WatchChannel.shared.send(.command(command)) { queue(command) }
            return
        }
        guard let data = try? WatchMessage.command(command).encoded() else { return }
        Task {
            do {
                try await mirrored.sendToRemoteWorkoutSession(data: data)
            } catch {
                if !WatchChannel.shared.send(.command(command)) { queue(command) }
            }
        }
    }

    /// A new stage replaces one not sent yet; an end replaces everything.
    private func queue(_ command: WatchCommand) {
        if case .end = command {
            pending = [command]
        } else {
            pending.removeAll { if case .stage = $0 { true } else { false } }
            pending.append(command)
        }
    }

    private func handle(_ message: WatchMessage) {
        switch message {
        case .metrics(let metrics): receive(metrics)
        case .stopped: metrics = nil
        case .command: break
        }
    }

    private func receive(_ metrics: WatchMetrics) {
        self.metrics = metrics
        guard var recorded else { return }
        // Only what the Watch actually records counts: then the phone won't save it again.
        if metrics.stage == .strength {
            recorded.strength = true
        } else if let cardioBlock {
            recorded.cardio.insert(cardioBlock)
        }
        if recorded != self.recorded {
            self.recorded = recorded
            recorded.save()
        }
    }

    private func ended(_ session: HKWorkoutSession) {
        // A stage change ends one mirrored workout and the next arrives on its own.
        guard session === mirrored else { return }
        mirrored = nil
        metrics = nil
    }
}

extension WatchLink.Recorded {
    static func clear() { UserDefaults.standard.removeObject(forKey: "pulso.training.watchRecorded") }
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
