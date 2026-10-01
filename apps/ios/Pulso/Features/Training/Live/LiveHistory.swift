import Foundation

/// What the person did on an exercise before, from the recent sessions the store
/// already holds: last time's sets, the records, and the load to prefill.
enum LiveHistory {
    struct Last: Equatable {
        var date: Date
        var sets: [SetLog]
    }

    struct Best: Equatable {
        /// Epley estimate, kg.
        var e1rm: Double
        var heaviestKg: Double
    }

    static func e1rm(weightKg: Double, reps: Int) -> Double { weightKg * (1 + Double(reps) / 30) }

    /// The latest session with sets of `exerciseId`, those sets in order.
    static func last(_ exerciseId: String, in sessions: [TrainingSession]) -> Last? {
        let latest = sessions
            .filter { $0.sets.contains { $0.exerciseId == exerciseId } }
            .max { $0.startedAt < $1.startedAt }
        guard let latest else { return nil }
        let sets = latest.sets.filter { $0.exerciseId == exerciseId }.sorted { $0.setIndex < $1.setIndex }
        return Last(date: latest.start, sets: sets)
    }

    /// Best estimated 1RM and heaviest load across `sessions`; nil without a loaded set.
    static func best(_ exerciseId: String, in sessions: [TrainingSession]) -> Best? {
        let sets = sessions.flatMap(\.sets).filter { $0.exerciseId == exerciseId && $0.weightKg > 0 && $0.reps > 0 }
        guard !sets.isEmpty else { return nil }
        return Best(e1rm: sets.map { e1rm(weightKg: $0.weightKg, reps: $0.reps) }.max() ?? 0, heaviestKg: sets.map(\.weightKg).max() ?? 0)
    }

    /// The load of the last set logged for `exerciseId`, to prefill a swapped or added exercise.
    static func lastWeight(_ exerciseId: String, in sessions: [TrainingSession]) -> Double? {
        last(exerciseId, in: sessions)?.sets.max { $0.doneAt < $1.doneAt }?.weightKg
    }

    /// "80 × 8 · 80 × 8 · 77,5 × 7", or reps alone for bodyweight sets.
    static func line(_ sets: [SetLog]) -> String {
        sets.map { $0.weightKg > 0 ? "\($0.weightKg.formatted()) × \($0.reps)" : "\($0.reps) reps" }.joined(separator: " · ")
    }
}
