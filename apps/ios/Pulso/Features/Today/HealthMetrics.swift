import Foundation
import HealthKit

/// Daily signals from HealthKit: activity, heart, sleep. Also the one place the
/// app asks for read access, workouts included, so the person sees a single sheet.
enum HealthMetrics {
    static var store: HKHealthStore { HealthSync.store }

    static let readTypes: Set<HKObjectType> = [
        HKObjectType.workoutType(),
        HKQuantityType(.activeEnergyBurned),
        HKQuantityType(.distanceWalkingRunning),
        HKQuantityType(.distanceCycling),
        HKQuantityType(.distanceSwimming),
        HKQuantityType(.stepCount),
        HKQuantityType(.appleExerciseTime),
        HKQuantityType(.restingHeartRate),
        HKQuantityType(.heartRateVariabilitySDNN),
        HKQuantityType(.vo2Max),
        HKQuantityType(.respiratoryRate),
        HKCategoryType(.sleepAnalysis),
    ]

    static func requestAccess() async throws {
        try await store.requestAuthorization(toShare: [], read: readTypes)
    }

    /// One row per local day for the last `days` days (today included), only days with some data.
    static func recentDays(days: Int = 30) async -> [DailyMetrics] {
        let calendar = Calendar.current
        let start = calendar.date(byAdding: .day, value: -(days - 1), to: calendar.startOfDay(for: .now))!
        let perMinute = HKUnit.count().unitDivided(by: .minute())

        // Read access is invisible to the app: a denied type just returns nothing, so each metric fails alone.
        async let steps = daily(.stepCount, .count(), sum: true, from: start)
        async let energy = daily(.activeEnergyBurned, .kilocalorie(), sum: true, from: start)
        async let exercise = daily(.appleExerciseTime, .minute(), sum: true, from: start)
        async let resting = daily(.restingHeartRate, perMinute, sum: false, from: start)
        async let hrv = daily(.heartRateVariabilitySDNN, .secondUnit(with: .milli), sum: false, from: start)
        async let vo2 = daily(.vo2Max, HKUnit(from: "ml/kg*min"), sum: false, from: start)
        async let breathing = daily(.respiratoryRate, perMinute, sum: false, from: start)
        async let nights = sleep(from: start)

        let (s, e, x, r, h, v, b, n) = await (steps, energy, exercise, resting, hrv, vo2, breathing, nights)
        let dates = Set(s.keys).union(e.keys).union(x.keys).union(r.keys).union(h.keys).union(v.keys).union(b.keys).union(n.keys)
        return dates.sorted().map { date in
            let night = n[date]
            return DailyMetrics(
                date: date, steps: s[date], activeEnergy: e[date], exerciseMinutes: x[date],
                restingHeartRate: r[date], hrv: h[date],
                sleepMinutes: night?.asleep, sleepDeep: night?.deep, sleepCore: night?.core, sleepRem: night?.rem, sleepAwake: night?.awake,
                vo2max: v[date], respiratoryRate: b[date]
            )
        }
    }

    /// Daily sum (activity) or average (heart, VO2max, breathing) keyed by local date.
    private static func daily(_ id: HKQuantityTypeIdentifier, _ unit: HKUnit, sum: Bool, from start: Date) async -> [String: Double] {
        let descriptor = HKStatisticsCollectionQueryDescriptor(
            predicate: .quantitySample(type: HKQuantityType(id), predicate: HKQuery.predicateForSamples(withStart: start, end: nil)),
            options: sum ? .cumulativeSum : .discreteAverage,
            anchorDate: start,
            intervalComponents: DateComponents(day: 1)
        )
        guard let collection = try? await descriptor.result(for: store) else { return [:] }
        var values: [String: Double] = [:]
        collection.enumerateStatistics(from: start, to: .now) { stats, _ in
            if let quantity = sum ? stats.sumQuantity() : stats.averageQuantity() {
                values[DayKey.string(stats.startDate)] = quantity.doubleValue(for: unit)
            }
        }
        return values
    }

    struct Night: Equatable {
        var asleep: Double
        var deep: Double?
        var core: Double?
        var rem: Double?
        var awake: Double?
    }

    private static func sleep(from start: Date) async -> [String: Night] {
        let descriptor = HKSampleQueryDescriptor(
            // A day earlier so the first night's start is included.
            predicates: [.categorySample(type: HKCategoryType(.sleepAnalysis), predicate: HKQuery.predicateForSamples(withStart: start.addingTimeInterval(-86_400), end: nil))],
            sortDescriptors: []
        )
        guard let samples = try? await descriptor.result(for: store) else { return [:] }
        let segments = samples.compactMap { sample in
            HKCategoryValueSleepAnalysis(rawValue: sample.value).map { SleepSegment(stage: $0, interval: DateInterval(start: sample.startDate, end: sample.endDate)) }
        }
        return nights(segments).filter { $0.key >= DayKey.string(start) }
    }

    struct SleepSegment {
        var stage: HKCategoryValueSleepAnalysis
        var interval: DateInterval
    }

    /// Groups segments into nights and sums each stage. iPhone and Watch often
    /// both record the same night, so overlapping time is counted once.
    static func nights(_ segments: [SleepSegment]) -> [String: Night] {
        Dictionary(grouping: segments) { DayKey.night(endingAt: $0.interval.end) }.compactMapValues { night in
            func minutes(_ stages: Set<HKCategoryValueSleepAnalysis>) -> Double? {
                let intervals = night.filter { stages.contains($0.stage) }.map(\.interval)
                return intervals.isEmpty ? nil : union(intervals) / 60
            }
            guard let asleep = minutes(HKCategoryValueSleepAnalysis.allAsleepValues) else { return nil }
            let deep = minutes([.asleepDeep]), core = minutes([.asleepCore]), rem = minutes([.asleepREM])
            let staged = deep != nil || core != nil || rem != nil
            return Night(asleep: asleep, deep: staged ? deep ?? 0 : nil, core: staged ? core ?? 0 : nil, rem: staged ? rem ?? 0 : nil, awake: minutes([.awake]))
        }
    }

    /// Seconds covered by the intervals, overlaps counted once.
    static func union(_ intervals: [DateInterval]) -> TimeInterval {
        var total: TimeInterval = 0
        var current: DateInterval?
        for interval in intervals.sorted(by: { $0.start < $1.start }) {
            if let open = current, interval.start <= open.end {
                current = DateInterval(start: open.start, end: max(open.end, interval.end))
            } else {
                total += current?.duration ?? 0
                current = interval
            }
        }
        return total + (current?.duration ?? 0)
    }
}

/// `YYYY-MM-DD` in the phone's calendar, the engine's date key.
enum DayKey {
    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func string(_ date: Date) -> String {
        formatter.timeZone = .current
        return formatter.string(from: date)
    }

    static func date(_ key: String) -> Date? {
        formatter.timeZone = .current
        return formatter.date(from: key)
    }

    /// A night belongs to the morning it ends on. Shifting six hours keeps
    /// sleep that ends before midnight with the next day.
    static func night(endingAt end: Date) -> String {
        string(end.addingTimeInterval(6 * 3600))
    }
}
