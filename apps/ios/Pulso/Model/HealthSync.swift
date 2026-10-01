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

    /// Workouts started in the last `days` days, newest first.
    static func recentWorkouts(days: Int = 30) async throws -> [WorkoutInput] {
        let since = Calendar.current.date(byAdding: .day, value: -days, to: .now)!
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.workout(HKQuery.predicateForSamples(withStart: since, end: nil))],
            sortDescriptors: [SortDescriptor(\.startDate, order: .reverse)]
        )
        return try await descriptor.result(for: store).map(input)
    }

    static func input(_ workout: HKWorkout) -> WorkoutInput {
        let energy = workout.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie())
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
            distance: distance
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
        default: "other_\(type.rawValue)"
        }
    }
}
