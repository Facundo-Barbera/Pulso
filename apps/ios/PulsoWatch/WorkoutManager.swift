import HealthKit
import Observation
import os

/// The workout this Watch records for the session running on the phone. The
/// phone starts it (`startWatchApp`), and it is mirrored back so the phone gets
/// the heart rate, energy and distance live and can pause, change or end it. A
/// stage change (strength ↔ a cardio block) ends this workout and starts the
/// next, so each lands in Fitness as its own workout of its kind.
@MainActor
@Observable
final class WorkoutManager: NSObject {
    static let shared = WorkoutManager()

    let store = HKHealthStore()
    private(set) var stage: WorkoutStage?
    private(set) var heartRate: Double?
    private(set) var activeKcal: Double = 0
    private(set) var distanceMeters: Double?
    private(set) var paused = false
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var lastSent = Date.distantPast

    private nonisolated static let log = Logger(subsystem: "com.facundo.pulso.watch", category: "workout")
    private static let bpm = HKUnit.count().unitDivided(by: .minute())

    var running: Bool { session != nil }

    /// Time recorded by the workout in progress (pauses left out).
    func elapsed(at date: Date) -> TimeInterval { builder?.elapsedTime(at: date) ?? 0 }

    // MARK: Lifecycle

    private func authorize() async {
        let distances: [HKQuantityType] = [HKQuantityType(.distanceWalkingRunning), HKQuantityType(.distanceCycling), HKQuantityType(.distanceRowing)]
        let share: Set<HKSampleType> = Set([HKObjectType.workoutType(), HKQuantityType(.activeEnergyBurned)] + distances)
        let read: Set<HKObjectType> = Set([HKObjectType.workoutType(), HKQuantityType(.heartRate), HKQuantityType(.activeEnergyBurned)] + distances)
        do { try await store.requestAuthorization(toShare: share, read: read) } catch { Self.log.error("authorization: \(error)") }
    }

    /// Records `stage`, ending (and saving) the workout in progress first.
    func start(_ stage: WorkoutStage) async {
        await authorize()
        if session != nil { await finish(save: true) }
        do {
            let configuration = stage.configuration
            let session = try HKWorkoutSession(healthStore: store, configuration: configuration)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: configuration)
            session.delegate = self
            builder.delegate = self
            adopt(session, builder, stage: stage)
            let start = Date()
            session.startActivity(with: start)
            try await builder.beginCollection(at: start)
            try await session.startMirroringToCompanionDevice()
            send(force: true)
        } catch {
            Self.log.error("start \(stage.title): \(error)")
        }
    }

    /// The Watch app came back after it was killed mid-workout.
    func recover() async {
        do {
            guard let session = try await store.recoverActiveWorkoutSession() else { return }
            let builder = session.associatedWorkoutBuilder()
            session.delegate = self
            builder.delegate = self
            adopt(session, builder, stage: WorkoutStage(session.workoutConfiguration))
            try? await session.startMirroringToCompanionDevice()
        } catch {
            Self.log.error("recover: \(error)")
        }
    }

    private func adopt(_ session: HKWorkoutSession, _ builder: HKLiveWorkoutBuilder, stage: WorkoutStage) {
        self.session = session
        self.builder = builder
        self.stage = stage
        heartRate = nil
        activeKcal = 0
        distanceMeters = nil
        paused = false
    }

    /// Ends the workout in progress: into Salud and Fitness, or thrown away.
    func finish(save: Bool) async {
        guard let session, let builder else { return }
        self.session = nil
        self.builder = nil
        stage = nil
        let end = Date()
        session.end()
        do {
            try await builder.endCollection(at: end)
            if save { _ = try await builder.finishWorkout() } else { builder.discardWorkout() }
        } catch {
            Self.log.error("finish: \(error)")
        }
    }

    /// "Terminar" on the Watch: saved, and the phone stops showing it.
    func endFromWatch() async {
        await finish(save: true)
        say(.stopped)
    }

    func pause() { session?.pause() }
    func resume() { session?.resume() }

    // MARK: Phone

    /// Commands also arrive by WatchConnectivity, when the mirrored session can't carry them.
    func listen() {
        WatchChannel.shared.receive = { [weak self] message in
            guard case .command(let command) = message else { return }
            Task { await self?.handle(command) }
        }
        WatchChannel.shared.activate()
    }

    private func handle(_ command: WatchCommand) async {
        switch command {
        case .pause: pause()
        case .resume: resume()
        case .stage(let next): if next != stage { await start(next) }
        case .end(let save):
            await finish(save: save)
            say(.stopped)
        }
    }

    /// To the phone by the mirrored session, else by WatchConnectivity.
    private func say(_ message: WatchMessage) {
        guard let data = try? message.encoded() else { return }
        guard let session else {
            WatchChannel.shared.send(message)
            return
        }
        Task {
            do {
                try await session.sendToRemoteWorkoutSession(data: data)
            } catch {
                WatchChannel.shared.send(message)
            }
        }
    }

    /// The numbers to the phone: on every change of state, else once a second at most.
    private func send(force: Bool = false) {
        guard let session, let stage, force || Date().timeIntervalSince(lastSent) >= 1 else { return }
        lastSent = Date()
        _ = session
        say(.metrics(WatchMetrics(stage: stage, heartRate: heartRate, activeKcal: activeKcal, distanceMeters: distanceMeters, paused: paused)))
    }

    private func collect(_ builder: HKLiveWorkoutBuilder, _ types: Set<HKSampleType>) {
        guard builder === self.builder else { return }
        if types.contains(HKQuantityType(.heartRate)) {
            heartRate = builder.statistics(for: HKQuantityType(.heartRate))?.mostRecentQuantity()?.doubleValue(for: Self.bpm)
        }
        if types.contains(HKQuantityType(.activeEnergyBurned)) {
            activeKcal = builder.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie()) ?? 0
        }
        if let distance = stage?.activityType.distanceType, types.contains(distance) {
            distanceMeters = builder.statistics(for: distance)?.sumQuantity()?.doubleValue(for: .meter())
        }
        send()
    }
}

extension WorkoutManager: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
        Task { @MainActor in
            guard workoutSession === session else { return }
            paused = toState == .paused
            send(force: true)
        }
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        Self.log.error("session failed: \(error)")
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didReceiveDataFromRemoteWorkoutSession data: [Data]) {
        let commands = data.compactMap { message -> WatchCommand? in
            if case .command(let command) = WatchMessage.decode(message) { return command }
            return nil
        }
        Task { @MainActor in
            for command in commands { await handle(command) }
        }
    }
}

extension WorkoutManager: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        Task { @MainActor in collect(workoutBuilder, collectedTypes) }
    }

    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
}
