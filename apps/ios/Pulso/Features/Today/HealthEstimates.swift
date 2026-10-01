import Foundation

/// Stand-ins for what Health did not compute. Apple derives resting heart rate and
/// exercise minutes from daytime Watch wear, so a Watch worn only at night leaves
/// them empty while HRV and sleep (recorded overnight) are fine. Pure functions:
/// `HealthMetrics` feeds them samples and flags whatever they return as estimated.
enum HealthEstimates {
    struct HeartSample: Equatable {
        var date: Date
        var bpm: Double
    }

    /// Length of the rolling average, in seconds.
    static let window: TimeInterval = 300
    /// Fewest samples worth trusting: asleep (the Watch samples every few minutes) and over a whole day.
    static let minSleepSamples = 6
    static let minDaySamples = 20

    /// The lowest 5-minute rolling average of heart rate while asleep, else the 5th
    /// percentile of the day's samples. Nil when there are too few samples for either.
    /// `asleep` is the night that ended on `day`; `day` is that local day.
    static func restingHeartRate(samples: [HeartSample], asleep: [DateInterval], day: DateInterval) -> Double? {
        let overnight = samples.filter { sample in asleep.contains { $0.contains(sample.date) } }.sorted { $0.date < $1.date }
        if overnight.count >= minSleepSamples, let lowest = lowestRollingAverage(overnight) { return lowest }
        let daytime = samples.filter { day.contains($0.date) }
        guard daytime.count >= minDaySamples else { return nil }
        return percentile(daytime.map(\.bpm), 0.05)
    }

    /// Mean of the samples in each `window` starting at a sample, lowest wins. Expects `samples` sorted by date.
    static func lowestRollingAverage(_ samples: [HeartSample]) -> Double? {
        var lowest: Double?
        for (i, first) in samples.enumerated() {
            let inWindow = samples[i...].prefix { $0.date.timeIntervalSince(first.date) <= window }
            let mean = inWindow.reduce(0) { $0 + $1.bpm } / Double(inWindow.count)
            lowest = min(lowest ?? mean, mean)
        }
        return lowest
    }

    /// Linear-interpolated percentile, `p` in 0...1.
    static func percentile(_ values: [Double], _ p: Double) -> Double? {
        guard !values.isEmpty else { return nil }
        let sorted = values.sorted()
        let rank = p * Double(sorted.count - 1)
        let lower = Int(rank.rounded(.down)), upper = Int(rank.rounded(.up))
        return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - Double(lower))
    }

    /// Minutes of workouts inside `day`, overlapping sessions (two apps recording one) counted once. Nil when none.
    static func workoutMinutes(_ workouts: [DateInterval], in day: DateInterval) -> Double? {
        let inside = workouts.compactMap { $0.intersection(with: day) }.filter { $0.duration > 0 }
        return inside.isEmpty ? nil : HealthMetrics.union(inside) / 60
    }
}
