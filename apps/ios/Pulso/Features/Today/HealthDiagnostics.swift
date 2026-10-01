#if DEBUG
import HealthKit
import os

/// Answers "why is this metric empty?": per type, how many samples the last days hold,
/// which sources wrote them, and whether iOS would still ask for access. A denied read
/// and no data look the same to the app (both return nothing), so zero samples with
/// request status `unnecessary` means either; `shouldRequest` means the sheet never ran.
/// Read the lines in Console.app, subsystem = the app's bundle id, category `health`.
enum HealthDiagnostics {
    private static let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "Pulso", category: "health")

    private static let types: [HKSampleType] = [
        HKQuantityType(.heartRate),
        HKQuantityType(.restingHeartRate),
        HKQuantityType(.appleExerciseTime),
        HKQuantityType(.heartRateVariabilitySDNN),
        HKQuantityType(.stepCount),
        HKCategoryType(.sleepAnalysis),
        HKObjectType.workoutType(),
    ]

    static func logReport(days: Int = 7) async {
        for line in await report(days: days) { log.info("\(line, privacy: .public)") }
    }

    static func report(days: Int = 7) async -> [String] {
        let start = Calendar.current.date(byAdding: .day, value: -(days - 1), to: Calendar.current.startOfDay(for: .now))!
        var lines: [String] = []
        for type in types {
            let descriptor = HKSampleQueryDescriptor(
                predicates: [.sample(type: type, predicate: HKQuery.predicateForSamples(withStart: start, end: nil))],
                sortDescriptors: []
            )
            let samples = (try? await descriptor.result(for: HealthMetrics.store)) ?? []
            let sources = Dictionary(grouping: samples) { $0.sourceRevision.source.name }.mapValues(\.count)
                .sorted { $0.value > $1.value }
                .map { "\($0.key) ×\($0.value)" }
            let daysWithData = Set(samples.map { DayKey.string($0.startDate) }).count
            let status = try? await HealthMetrics.store.statusForAuthorizationRequest(toShare: [], read: [type])
            let request = status.map { String(describing: $0) } ?? "error"
            lines.append("\(type.identifier): \(samples.count) samples on \(daysWithData)/\(days) days · request \(request) · \(sources.isEmpty ? "no sources" : sources.joined(separator: ", "))")
        }
        return lines
    }
}
#endif
