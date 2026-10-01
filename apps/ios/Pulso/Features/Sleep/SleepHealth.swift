import Foundation
import HealthKit

/// Reads sleep samples from HealthKit, read-only, for the engine to group into nights.
enum SleepHealth {
    static let type = HKCategoryType(.sleepAnalysis)

    static func requestAccess() async throws {
        try await HealthSync.store.requestAuthorization(toShare: [], read: [type])
    }

    /// Every sleep sample of the last `nights` nights, from every source; the engine picks one per night.
    static func recentSegments(nights: Int = 60) async throws -> [SleepSegmentInput] {
        let since = Calendar.current.date(byAdding: .day, value: -nights, to: .now)!
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.categorySample(type: type, predicate: HKQuery.predicateForSamples(withStart: since, end: nil))],
            sortDescriptors: [SortDescriptor(\.startDate)]
        )
        return try await descriptor.result(for: HealthSync.store).compactMap(input)
    }

    static func input(_ sample: HKCategorySample) -> SleepSegmentInput? {
        guard let value = HKCategoryValueSleepAnalysis(rawValue: sample.value), let stage = stage(value) else { return nil }
        let product = sample.sourceRevision.productType ?? ""
        return SleepSegmentInput(
            start: sample.startDate.timeIntervalSince1970 * 1000,
            end: sample.endDate.timeIntervalSince1970 * 1000,
            stage: stage,
            source: sample.sourceRevision.source.name,
            sourceKind: sourceKind(productType: product),
            tzOffsetMin: TimeZone.current.secondsFromGMT(for: sample.startDate) / 60
        )
    }

    static func stage(_ value: HKCategoryValueSleepAnalysis) -> SleepStage? {
        switch value {
        case .inBed: .inBed
        case .awake: .awake
        case .asleepREM: .rem
        case .asleepCore: .core
        case .asleepDeep: .deep
        case .asleepUnspecified: .asleep
        @unknown default: nil
        }
    }

    /// `productType` is like "Watch7,1" or "iPhone17,2".
    static func sourceKind(productType: String) -> String {
        if productType.hasPrefix("Watch") { return "watch" }
        if productType.hasPrefix("iPhone") { return "phone" }
        return "other"
    }
}
