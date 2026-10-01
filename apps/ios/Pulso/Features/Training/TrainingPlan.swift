import Foundation

/// The numbers the plan screen shows next to each day: rough time, energy and
/// recent records. The week and its deload come from the engine (`TrainingBlock`).
enum TrainingPlan {
    /// Seconds a set takes besides its rest.
    static let workSeconds = 45
    /// Compendium of Physical Activities, resistance training (multiple exercises, 8–15 reps).
    static let strengthMET = 5.0

    /// Sets × (rest + work), rounded to 5 minutes, never under 10.
    static func minutes(_ day: ProgramDay) -> Int {
        let seconds = day.exercises.reduce(0) { $0 + $1.sets * ($1.restSeconds + workSeconds) }
        return max(10, Int((Double(seconds) / 60 / 5).rounded()) * 5)
    }

    /// "4 series de 6 a 8 repeticiones con 32,5 kg" (or "con 70 lb"), the load only when there is one.
    static func prescription(_ exercise: ProgramExercise, weightKg: Double?, unit: WeightUnit = .kg) -> String {
        guard let weightKg, weightKg > 0 else { return exercise.prescription }
        return "\(exercise.prescription) con \(unit.format(unit.snapKg(weightKg)))"
    }

    /// MET × kg × hours; nil without a body weight.
    static func kcal(_ day: ProgramDay, weightKg: Double?) -> Int? {
        guard let weightKg, weightKg > 0 else { return nil }
        return Int((strengthMET * weightKg * Double(minutes(day)) / 60).rounded())
    }

    /// Exercises whose best estimated 1RM in a session of the last `days` beat
    /// every earlier session in `sessions`. A first time doing it is not a record.
    static func recentRecords(_ sessions: [TrainingSession], now: Date = .now, days: Double = 14) -> Set<String> {
        let since = (now.timeIntervalSince1970 - days * 86_400) * 1000
        var best: [String: Double] = [:]
        var records: Set<String> = []
        for session in sessions.sorted(by: { $0.startedAt < $1.startedAt }) {
            var top: [String: Double] = [:]
            for set in session.sets where set.weightKg > 0 && set.reps > 0 {
                top[set.exerciseId] = max(top[set.exerciseId] ?? 0, set.weightKg * (1 + Double(set.reps) / 30))
            }
            for (id, e1rm) in top {
                if let previous = best[id], e1rm > previous, session.startedAt >= since { records.insert(id) }
                best[id] = max(best[id] ?? 0, e1rm)
            }
        }
        return records
    }
}
