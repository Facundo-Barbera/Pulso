import Foundation
import HealthKit

/// Reads workouts from HealthKit and turns them into what the engine accepts.
/// Read-only: Pulso asks for no write permission.
enum HealthSync {
    static let store = HKHealthStore()

    static var available: Bool { HKHealthStore.isHealthDataAvailable() }

    /// Everything the tabs read, asked for once (onboarding, Ajustes) so the person
    /// sees one Health sheet instead of one per tab. Medications are per-object and
    /// stay with the Medicación import.
    static let readTypes: Set<HKObjectType> = [
        HKObjectType.workoutType(),
        HKQuantityType(.activeEnergyBurned),
        HKQuantityType(.distanceWalkingRunning),
        HKQuantityType(.distanceCycling),
        HKQuantityType(.distanceSwimming),
        HKQuantityType(.stepCount),
        HKQuantityType(.appleExerciseTime),
        HKQuantityType(.heartRate),
        HKQuantityType(.restingHeartRate),
        HKQuantityType(.heartRateVariabilitySDNN),
        HKQuantityType(.vo2Max),
        HKQuantityType(.respiratoryRate),
        HKCategoryType(.sleepAnalysis),
        HKQuantityType(.bodyMass),
        HKQuantityType(.bodyFatPercentage),
        HKQuantityType(.leanBodyMass),
    ]

    static func requestAccess() async throws {
        try await store.requestAuthorization(toShare: [], read: readTypes)
    }

    /// Workouts started in the last `days` days, newest first. Those of the last `seriesDays`
    /// also carry their heart rate minute by minute, for the session's chart on the Mac.
    static func recentWorkouts(days: Int = 30, seriesDays: Int = 7) async throws -> [WorkoutInput] {
        let since = Calendar.current.date(byAdding: .day, value: -days, to: .now)!
        let seriesSince = Calendar.current.date(byAdding: .day, value: -seriesDays, to: .now)!
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.workout(HKQuery.predicateForSamples(withStart: since, end: nil))],
            sortDescriptors: [SortDescriptor(\.startDate, order: .reverse)]
        )
        var inputs: [WorkoutInput] = []
        for workout in try await descriptor.result(for: store) {
            var item = input(workout)
            // Pulso's own copies have no heart rate of their own; four hours is far past any session.
            if workout.startDate >= seriesSince, !isPulso(workout), workout.duration <= 4 * 3600 {
                item.heartRate = await heartRate(during: workout)
            }
            inputs.append(item)
        }
        return inputs
    }

    /// Written by this app (Debug or Release) when a session ended.
    static func isPulso(_ workout: HKWorkout) -> Bool {
        workout.sourceRevision.source.bundleIdentifier.hasPrefix("com.facundo.pulso")
    }

    private static let bpm = HKUnit.count().unitDivided(by: .minute())

    /// The minute-by-minute average heart rate during `workout`; nil when Salud has none.
    static func heartRate(during workout: HKWorkout) async -> [HeartRatePoint]? {
        let predicate = HKQuery.predicateForSamples(withStart: workout.startDate, end: workout.endDate)
        let descriptor = HKStatisticsCollectionQueryDescriptor(
            predicate: .quantitySample(type: HKQuantityType(.heartRate), predicate: predicate),
            options: .discreteAverage,
            anchorDate: workout.startDate,
            intervalComponents: DateComponents(minute: 1)
        )
        guard let collection = try? await descriptor.result(for: store) else { return nil }
        var points: [HeartRatePoint] = []
        collection.enumerateStatistics(from: workout.startDate, to: workout.endDate) { statistics, _ in
            if let value = statistics.averageQuantity()?.doubleValue(for: bpm) {
                points.append(HeartRatePoint(at: statistics.startDate.timeIntervalSince1970 * 1000, bpm: value.rounded()))
            }
        }
        return points.isEmpty ? nil : points
    }

    static func input(_ workout: HKWorkout) -> WorkoutInput {
        let energy = workout.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie())
        let heart = workout.statistics(for: HKQuantityType(.heartRate))
        let distance = [HKQuantityType(.distanceWalkingRunning), HKQuantityType(.distanceCycling), HKQuantityType(.distanceSwimming)]
            .lazy
            .compactMap { workout.statistics(for: $0)?.sumQuantity()?.doubleValue(for: .meter()) }
            .first
        return WorkoutInput(
            externalId: workout.uuid.uuidString,
            activity: activityName(workout.workoutActivityType),
            startedAt: workout.startDate.timeIntervalSince1970 * 1000,
            endedAt: workout.endDate.timeIntervalSince1970 * 1000,
            energy: energy,
            distance: distance,
            sourceBundle: workout.sourceRevision.source.bundleIdentifier,
            sourceName: workout.sourceRevision.source.name,
            externalRef: workout.metadata?[HKMetadataKeyExternalUUID] as? String,
            avgHeartRate: heart?.averageQuantity()?.doubleValue(for: bpm).rounded(),
            maxHeartRate: heart?.maximumQuantity()?.doubleValue(for: bpm).rounded()
        )
    }

    /// Stable lowercase names for the engine. Unlisted types keep their raw value so nothing is lost.
    static func activityName(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .running: "running"
        case .walking: "walking"
        case .hiking: "hiking"
        case .cycling: "cycling"
        case .swimming: "swimming"
        case .traditionalStrengthTraining: "strength"
        case .functionalStrengthTraining: "functional_strength"
        case .highIntensityIntervalTraining: "hiit"
        case .yoga: "yoga"
        case .rowing: "rowing"
        case .elliptical: "elliptical"
        case .coreTraining: "core"
        case .flexibility: "flexibility"
        case .crossTraining: "cross_training"
        case .soccer: "soccer"
        case .stairClimbing: "stair_climbing"
        case .stairs: "stairs"
        case .mixedCardio: "mixed_cardio"
        case .jumpRope: "jump_rope"
        case .cooldown: "cooldown"
        default: "other_\(type.rawValue)"
        }
    }
}
