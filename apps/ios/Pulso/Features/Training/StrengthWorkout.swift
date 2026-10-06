import Foundation
import HealthKit

/// Writes a finished session to Salud: the strength part as a traditional
/// strength workout, and each cardio block as its own workout of its kind.
enum StrengthWorkout {
    /// Asks only for what this needs: writing workouts. Reading stays with `HealthSync`.
    static func save(start: Date, end: Date, sessionId: String) async throws {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        let store = HealthSync.store
        try await store.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [])

        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .traditionalStrengthTraining
        configuration.locationType = .indoor
        let builder = HKWorkoutBuilder(healthStore: store, configuration: configuration, device: .local())
        try await builder.beginCollection(at: start)
        // The session id lets Salud and the engine recognise the same workout.
        try await builder.addMetadata([HKMetadataKeyExternalUUID: sessionId])
        try await builder.endCollection(at: end)
        _ = try await builder.finishWorkout()
    }

    /// One cardio block, ending when it was logged. Distance and kcal go in as
    /// samples when the person entered them. `index` is the block's place in the
    /// session, so its id is "<sessionId>-<index>".
    static func saveCardio(_ log: CardioLog, modality: String?, speedKmh: Double? = nil, sessionId: String, index: Int) async throws {
        guard HKHealthStore.isHealthDataAvailable(), log.durationSeconds > 0 else { return }
        let store = HealthSync.store
        let (activity, location) = workoutType(modality, speedKmh: speedKmh)
        let distanceType = distanceType(activity)
        var share: Set<HKSampleType> = [HKObjectType.workoutType(), HKQuantityType(.activeEnergyBurned)]
        if let distanceType { share.insert(distanceType) }
        try await store.requestAuthorization(toShare: share, read: [])

        let configuration = HKWorkoutConfiguration()
        configuration.activityType = activity
        configuration.locationType = location
        let end = Date(timeIntervalSince1970: log.doneAt / 1000)
        let start = end.addingTimeInterval(-log.durationSeconds)
        let builder = HKWorkoutBuilder(healthStore: store, configuration: configuration, device: .local())
        try await builder.beginCollection(at: start)
        try await builder.addMetadata([
            HKMetadataKeyExternalUUID: "\(sessionId)-\(index)",
            HKMetadataKeyIndoorWorkout: location == .indoor,
        ])
        var samples: [HKSample] = []
        if let kcal = log.kcal, kcal > 0 {
            samples.append(HKQuantitySample(type: HKQuantityType(.activeEnergyBurned), quantity: HKQuantity(unit: .kilocalorie(), doubleValue: kcal), start: start, end: end))
        }
        if let km = log.distanceKm, km > 0, let distanceType {
            samples.append(HKQuantitySample(type: distanceType, quantity: HKQuantity(unit: .meterUnit(with: .kilo), doubleValue: km), start: start, end: end))
        }
        if !samples.isEmpty { try await builder.addSamples(samples) }
        try await builder.endCollection(at: end)
        _ = try await builder.finishWorkout()
    }

    /// The contract's `CardioModality` as a Salud workout type. On the
    /// treadmill ("caminadora"), a walk unless the target is a running pace.
    static func workoutType(_ modality: String?, speedKmh: Double? = nil) -> (HKWorkoutActivityType, HKWorkoutSessionLocationType) {
        switch modality {
        case "treadmill": ((speedKmh ?? 0) >= runningKmh ? .running : .walking, .indoor)
        case "elliptical": (.elliptical, .indoor)
        case "bike": (.cycling, .indoor)
        case "rower": (.rowing, .indoor)
        case "stairs": (.stairClimbing, .indoor)
        case "run": (.running, .outdoor)
        case "walk": (.walking, .outdoor)
        case "jump_rope": (.jumpRope, .indoor)
        case "hiit": (.highIntensityIntervalTraining, .indoor)
        default: (.mixedCardio, .indoor)
        }
    }

    /// From here up a treadmill target is a run.
    static let runningKmh = 7.5

    private static func distanceType(_ activity: HKWorkoutActivityType) -> HKQuantityType? {
        switch activity {
        case .running, .walking: HKQuantityType(.distanceWalkingRunning)
        case .cycling: HKQuantityType(.distanceCycling)
        case .rowing: HKQuantityType(.distanceRowing)
        default: nil
        }
    }
}

extension WorkoutStage {
    /// What the Watch records for a cardio block.
    static func cardio(_ modality: String?, speedKmh: Double?) -> WorkoutStage {
        let (activity, location) = StrengthWorkout.workoutType(modality, speedKmh: speedKmh)
        return WorkoutStage(activity: activity.rawValue, indoor: location != .outdoor)
    }
}
