import Foundation
import HealthKit

/// Writes a finished session to Salud as a traditional strength workout.
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
}
