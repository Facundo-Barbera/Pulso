import Foundation
import HealthKit

/// Reads weight and body-fat % from Apple Health for the Cuerpo trends. Read-only.
enum BodyHealth {
    static let types: [(HKQuantityType, String, HKUnit, Double)] = [
        (HKQuantityType(.bodyMass), "weight", .gramUnit(with: .kilo), 1),
        // HealthKit stores body fat as a fraction; the engine wants %.
        (HKQuantityType(.bodyFatPercentage), "percentBodyFat", .percent(), 100),
    ]

    static func requestAccess() async throws {
        try await HealthSync.store.requestAuthorization(toShare: [], read: Set(types.map(\.0)))
    }

    /// Every weight and body-fat sample of the last `days` days, oldest first.
    static func recentSamples(days: Int = 365) async throws -> [BodySample] {
        let since = Calendar.current.date(byAdding: .day, value: -days, to: .now)!
        var samples: [BodySample] = []
        for (type, metric, unit, factor) in types {
            let descriptor = HKSampleQueryDescriptor(
                predicates: [.quantitySample(type: type, predicate: HKQuery.predicateForSamples(withStart: since, end: nil))],
                sortDescriptors: [SortDescriptor(\.startDate)]
            )
            samples += try await descriptor.result(for: HealthSync.store).map {
                sample($0, metric: metric, value: $0.quantity.doubleValue(for: unit) * factor)
            }
        }
        return samples
    }

    static func sample(_ quantity: HKQuantitySample, metric: String, value: Double) -> BodySample {
        BodySample(
            externalId: quantity.uuid.uuidString,
            metric: metric,
            value: (value * 100).rounded() / 100,
            measuredAt: quantity.startDate.timeIntervalSince1970 * 1000
        )
    }
}
