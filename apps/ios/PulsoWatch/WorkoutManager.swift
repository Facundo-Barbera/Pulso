import HealthKit
import Observation
import os

/// The workout the Watch records for the session. It follows the session
/// (`follow`): strength, or the kind of the cardio block whose clock runs.
/// Stages go in as activities of one workout, so Fitness shows the whole visit
/// as one workout with its parts; if this Watch fails an activity of another
/// kind, each stage becomes its own workout instead. The numbers go to the phone
/// live: over the mirrored session, else WatchConnectivity.
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
    private(set) var totalKcal: Double?
    private(set) var averageHeartRate: Double?
    private(set) var steps: Double?
    private(set) var paceSecondsPerKm: Double?
    private(set) var cadence: Double?
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var lastSent = Date.distantPast
    /// False once this Watch failed a stage as an activity: then a workout per stage.
    private var activities = true
    private var starting = false

    private nonisolated static let log = Logger(subsystem: "com.facundo.pulso.watch", category: "workout")
    private static let bpm = HKUnit.count().unitDivided(by: .minute())

    var running: Bool { session != nil }

    /// Time recorded by the workout in progress (pauses left out).
    func elapsed(at date: Date) -> TimeInterval { builder?.elapsedTime(at: date) ?? 0 }

    // MARK: Following the session

    /// Records `stage`: starts the workout, or moves it to that stage.
    func follow(_ next: WorkoutStage) async {
        guard !starting else { return }
        if session == nil {
            await start(next)
        } else if next != stage {
            await change(to: next)
        }
    }

    private static var types: (share: Set<HKSampleType>, read: Set<HKObjectType>) {
        let distances: [HKQuantityType] = [HKQuantityType(.distanceWalkingRunning), HKQuantityType(.distanceCycling), HKQuantityType(.distanceRowing)]
        let energy = [HKQuantityType(.activeEnergyBurned), HKQuantityType(.basalEnergyBurned), HKQuantityType(.stepCount)]
        return (Set([HKObjectType.workoutType()] + energy + distances), Set([HKObjectType.workoutType(), HKQuantityType(.heartRate)] + energy + distances))
    }

    private func authorize() async {
        let (share, read) = Self.types
        do { try await store.requestAuthorization(toShare: share, read: read) } catch { Self.log.error("authorization: \(error)") }
    }

    /// A new workout recording `stage`, as its first activity when activities work here.
    func start(_ stage: WorkoutStage) async {
        guard session == nil, !starting else { return }
        starting = true
        defer { starting = false }
        // Asked once already, the asking (new kinds of data) doesn't hold the start.
        let (share, read) = Self.types
        if (try? await store.statusForAuthorizationRequest(toShare: share, read: read)) == .shouldRequest {
            await authorize()
        }
        // One left running by a previous launch blocks a new one: carry on with it.
        await recover()
        if session != nil {
            if stage != self.stage { await change(to: stage) }
            return
        }
        do {
            // The workout's own kind stays strength: the visit is a strength session with parts.
            let configuration = activities ? WorkoutStage.strength.configuration : stage.configuration
            let session = try HKWorkoutSession(healthStore: store, configuration: configuration)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: configuration)
            session.delegate = self
            builder.delegate = self
            adopt(session, builder, stage: stage)
            let start = Date()
            session.startActivity(with: start)
            try await builder.beginCollection(at: start)
            if activities { begin(stage, at: start) }
            send(force: true)
            try? await session.startMirroringToCompanionDevice()
        } catch {
            Self.log.error("start \(stage.title): \(error)")
        }
    }

    /// The Watch app came back after it was killed mid-workout.
    func recover() async {
        guard session == nil else { return }
        do {
            guard let session = try await store.recoverActiveWorkoutSession() else { return }
            let builder = session.associatedWorkoutBuilder()
            // The live numbers don't come back with it.
            if builder.dataSource == nil {
                builder.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: session.workoutConfiguration)
            }
            session.delegate = self
            builder.delegate = self
            adopt(session, builder, stage: WorkoutStage(builder.currentWorkoutActivity?.workoutConfiguration ?? session.workoutConfiguration))
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
        totalKcal = nil
        averageHeartRate = nil
        clearStageNumbers()
    }

    private func clearStageNumbers() {
        distanceMeters = nil
        steps = nil
        paceSecondsPerKm = nil
        cadence = nil
    }

    private func change(to next: WorkoutStage) async {
        guard let session else { return }
        if !activities {
            // A workout per stage.
            await finish(save: true)
            await start(next)
            return
        }
        let now = Date()
        session.endCurrentActivity(on: now)
        stage = next
        clearStageNumbers()
        begin(next, at: now)
        send(force: true)
    }

    private func begin(_ stage: WorkoutStage, at date: Date) {
        guard let session else { return }
        session.beginNewActivity(configuration: stage.configuration, date: date, metadata: nil)
        if let source = builder?.dataSource {
            source.enableCollection(for: HKQuantityType(.basalEnergyBurned), predicate: nil)
            if let distance = stage.activityType.distanceType { source.enableCollection(for: distance, predicate: nil) }
            if stage.countsSteps { source.enableCollection(for: HKQuantityType(.stepCount), predicate: nil) }
        }
    }

    /// The workout failed: if a stage of another kind did it, a workout per stage from now on.
    private func failed(_ failing: HKWorkoutSession) async {
        guard failing === session else { return }
        let current = stage ?? .strength
        guard activities, current != .strength else { return }
        Self.log.error("activities failed: one workout per stage from now on")
        activities = false
        await finish(save: true)
        await start(current)
    }

    /// Ends the workout in progress: into Salud and Fitness, or thrown away.
    func finish(save: Bool) async {
        guard let session, let builder else { return }
        self.session = nil
        self.builder = nil
        stage = nil
        let end = Date()
        if builder.currentWorkoutActivity != nil { session.endCurrentActivity(on: end) }
        session.end()
        do {
            try await builder.endCollection(at: end)
            if save { _ = try await builder.finishWorkout() } else { builder.discardWorkout() }
        } catch {
            Self.log.error("finish: \(error)")
        }
        say(.stopped)
    }

    func pause() { session?.pause() }
    func resume() { session?.resume() }

    // MARK: Numbers to the phone

    /// By the mirrored session, else by WatchConnectivity.
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

    /// On every change of state, else once a second at most.
    private func send(force: Bool = false) {
        guard session != nil, let stage, force || Date().timeIntervalSince(lastSent) >= 1 else { return }
        lastSent = Date()
        say(.metrics(WatchMetrics(stage: stage, heartRate: heartRate, activeKcal: activeKcal, distanceMeters: distanceMeters, paused: paused,
                                  totalKcal: totalKcal, averageHeartRate: averageHeartRate, steps: steps, paceSecondsPerKm: paceSecondsPerKm, cadence: cadence)))
    }

    private func collect(_ builder: HKLiveWorkoutBuilder, _ types: Set<HKSampleType>) {
        guard builder === self.builder else { return }
        if types.contains(HKQuantityType(.heartRate)) {
            let statistics = builder.statistics(for: HKQuantityType(.heartRate))
            heartRate = statistics?.mostRecentQuantity()?.doubleValue(for: Self.bpm)
            averageHeartRate = statistics?.averageQuantity()?.doubleValue(for: Self.bpm)
        }
        if types.contains(HKQuantityType(.activeEnergyBurned)) || types.contains(HKQuantityType(.basalEnergyBurned)) {
            activeKcal = sum(builder, .activeEnergyBurned, .kilocalorie(), stage: false) ?? 0
            totalKcal = activeKcal + (sum(builder, .basalEnergyBurned, .kilocalorie(), stage: false) ?? 0)
        }
        // This stage's numbers: the treadmill block, not the whole visit.
        if let distance = stage?.activityType.distanceType, types.contains(distance) {
            distanceMeters = (builder.currentWorkoutActivity?.statistics(for: distance) ?? builder.statistics(for: distance))?.sumQuantity()?.doubleValue(for: .meter())
        }
        if types.contains(HKQuantityType(.stepCount)) {
            steps = sum(builder, .stepCount, .count(), stage: true)
        }
        let minutes = stageElapsed(builder) / 60
        if let meters = distanceMeters, meters > 10 { paceSecondsPerKm = minutes * 60 / (meters / 1000) }
        if let steps, minutes > 0.5 { cadence = steps / minutes }
        send()
    }

    private func sum(_ builder: HKLiveWorkoutBuilder, _ id: HKQuantityTypeIdentifier, _ unit: HKUnit, stage: Bool) -> Double? {
        let type = HKQuantityType(id)
        let statistics = stage ? builder.currentWorkoutActivity?.statistics(for: type) ?? builder.statistics(for: type) : builder.statistics(for: type)
        return statistics?.sumQuantity()?.doubleValue(for: unit)
    }

    /// Time in the stage now: since its activity began, else the whole workout.
    private func stageElapsed(_ builder: HKLiveWorkoutBuilder) -> TimeInterval {
        if let start = builder.currentWorkoutActivity?.startDate, activities == true { return Date().timeIntervalSince(start) }
        return builder.elapsedTime
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
        Task { @MainActor in await failed(workoutSession) }
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didReceiveDataFromRemoteWorkoutSession data: [Data]) {
        // The phone speaks over WatchConnectivity: the session's copy is more than this road carries.
    }
}

extension WorkoutManager: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        Task { @MainActor in collect(workoutBuilder, collectedTypes) }
    }

    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

}
