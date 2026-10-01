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
        // Raw heart rate feeds the resting-HR estimate when Health has none.
        HKQuantityType(.heartRate),
        HKQuantityType(.restingHeartRate),
        HKQuantityType(.heartRateVariabilitySDNN),
        HKQuantityType(.vo2Max),
        HKQuantityType(.respiratoryRate),
        HKCategoryType(.sleepAnalysis),
    ]

    static func requestAccess() async throws {
        try await store.requestAuthorization(toShare: [], read: readTypes)
    }

    private static let perMinute = HKUnit.count().unitDivided(by: .minute())

    /// One row per local day for the last `days` days (today included), only days with some data.
    /// Resting heart rate and exercise minutes Health left empty are estimated and flagged.
    static func recentDays(days: Int = 30) async -> [DailyMetrics] {
        let calendar = Calendar.current
        let start = calendar.date(byAdding: .day, value: -(days - 1), to: calendar.startOfDay(for: .now))!

        // Read access is invisible to the app: a denied type just returns nothing, so each metric fails alone.
        async let steps = daily(.stepCount, .count(), sum: true, from: start)
        async let energy = daily(.activeEnergyBurned, .kilocalorie(), sum: true, from: start)
        async let exercise = daily(.appleExerciseTime, .minute(), sum: true, from: start)
        async let resting = daily(.restingHeartRate, perMinute, sum: false, from: start)
        async let hrv = daily(.heartRateVariabilitySDNN, .secondUnit(with: .milli), sum: false, from: start)
        async let vo2 = daily(.vo2Max, HKUnit(from: "ml/kg*min"), sum: false, from: start)
        async let breathing = daily(.respiratoryRate, perMinute, sum: false, from: start)
        async let segmentsRead = sleepSegments(from: start)

        let (s, e, measuredExercise, measuredResting, h, v, b, segments) = await (steps, energy, exercise, resting, hrv, vo2, breathing, segmentsRead)
        let n = nights(segments).filter { $0.key >= DayKey.string(start) }
        var x = measuredExercise, r = measuredResting

        let localDays = (0..<days).map { offset -> (key: String, interval: DateInterval) in
            let date = calendar.date(byAdding: .day, value: offset, to: start)!
            return (DayKey.string(date), calendar.dateInterval(of: .day, for: date)!)
        }
        let estimatedResting = await estimatedRestingHeartRate(days: localDays.filter { measuredResting[$0.key] == nil }, asleep: asleepIntervals(segments))
        let estimatedExercise = await estimatedExerciseMinutes(days: localDays.filter { measuredExercise[$0.key] == nil }, from: start)
        r.merge(estimatedResting) { measured, _ in measured }
        x.merge(estimatedExercise) { measured, _ in measured }

        let dates = Set(s.keys).union(e.keys).union(x.keys).union(r.keys).union(h.keys).union(v.keys).union(b.keys).union(n.keys)
        return dates.sorted().map { date in
            let night = n[date]
            return DailyMetrics(
                date: date, steps: s[date], activeEnergy: e[date],
                exerciseMinutes: x[date], exerciseMinutesEstimated: estimatedExercise[date] == nil ? nil : true,
                restingHeartRate: r[date], restingHeartRateEstimated: estimatedResting[date] == nil ? nil : true,
                hrv: h[date],
                sleepMinutes: night?.asleep, sleepDeep: night?.deep, sleepCore: night?.core, sleepRem: night?.rem, sleepAwake: night?.awake,
                vo2max: v[date], respiratoryRate: b[date]
            )
        }
    }

    /// Per missing day, from the raw heart-rate samples around it (the night that ended on it, and the day itself).
    private static func estimatedRestingHeartRate(days: [(key: String, interval: DateInterval)], asleep: [String: [DateInterval]]) async -> [String: Double] {
        await withTaskGroup(of: (String, Double?).self) { group in
            for day in days {
                group.addTask {
                    // From the noon before: the night that ends on this day starts the evening earlier.
                    let samples = await heartSamples(from: day.interval.start.addingTimeInterval(-12 * 3600), to: day.interval.end)
                    return (day.key, HealthEstimates.restingHeartRate(samples: samples, asleep: asleep[day.key] ?? [], day: day.interval))
                }
            }
            var estimates: [String: Double] = [:]
            for await (key, value) in group { if let value { estimates[key] = value } }
            return estimates
        }
    }

    private static func heartSamples(from start: Date, to end: Date) async -> [HealthEstimates.HeartSample] {
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.quantitySample(type: HKQuantityType(.heartRate), predicate: HKQuery.predicateForSamples(withStart: start, end: end))],
            sortDescriptors: []
        )
        guard let samples = try? await descriptor.result(for: store) else { return [] }
        return samples.map { HealthEstimates.HeartSample(date: $0.startDate, bpm: $0.quantity.doubleValue(for: perMinute)) }
    }

    /// Per missing day, the minutes of workouts that fell on it.
    private static func estimatedExerciseMinutes(days: [(key: String, interval: DateInterval)], from start: Date) async -> [String: Double] {
        guard !days.isEmpty else { return [:] }
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.workout(HKQuery.predicateForSamples(withStart: start, end: nil))],
            sortDescriptors: []
        )
        guard let workouts = try? await descriptor.result(for: store) else { return [:] }
        let intervals = workouts.map { DateInterval(start: $0.startDate, end: $0.endDate) }
        return days.reduce(into: [:]) { estimates, day in
            if let minutes = HealthEstimates.workoutMinutes(intervals, in: day.interval) { estimates[day.key] = minutes }
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

    private static func sleepSegments(from start: Date) async -> [SleepSegment] {
        let descriptor = HKSampleQueryDescriptor(
            // A day earlier so the first night's start is included.
            predicates: [.categorySample(type: HKCategoryType(.sleepAnalysis), predicate: HKQuery.predicateForSamples(withStart: start.addingTimeInterval(-86_400), end: nil))],
            sortDescriptors: []
        )
        guard let samples = try? await descriptor.result(for: store) else { return [] }
        return samples.compactMap { sample in
            HKCategoryValueSleepAnalysis(rawValue: sample.value).map { SleepSegment(stage: $0, interval: DateInterval(start: sample.startDate, end: sample.endDate)) }
        }
    }

    struct SleepSegment {
        var stage: HKCategoryValueSleepAnalysis
        var interval: DateInterval
    }

    /// The time actually asleep, any source or stage, per night (see `nights`).
    static func asleepIntervals(_ segments: [SleepSegment]) -> [String: [DateInterval]] {
        Dictionary(grouping: segments.filter { HKCategoryValueSleepAnalysis.allAsleepValues.contains($0.stage) }) {
            DayKey.night(endingAt: $0.interval.end)
        }.mapValues { $0.map(\.interval) }
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
