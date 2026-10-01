import Foundation

/// The numbers the plan screen shows next to each day: the program's week,
/// whether it is a deload, and rough time, energy and recent records.
enum TrainingPlan {
    /// Seconds a set takes besides its rest.
    static let workSeconds = 45
    /// Compendium of Physical Activities, resistance training (multiple exercises, 8–15 reps).
    static let strengthMET = 5.0

    /// 1-based week since the program was created, clamped to its length.
    static func week(of program: TrainingProgram, now: Date = .now, calendar: Calendar = .current) -> Int {
        let start = calendar.startOfDay(for: Date(timeIntervalSince1970: program.createdAt / 1000))
        let days = calendar.dateComponents([.day], from: start, to: calendar.startOfDay(for: now)).day ?? 0
        return min(max(days / 7 + 1, 1), max(program.weeks, 1))
    }

    /// True when a sentence of the notes that mentions a deload names this week:
    /// "semana 4 de descarga", "descarga cada 4 semanas", "última semana: descarga".
    static func isDeload(week: Int, weeks: Int, notes: String?) -> Bool {
        guard let notes else { return false }
        let sentences = notes.lowercased().split { ".;\n".contains($0) }
        return sentences.contains { sentence in
            guard sentence.contains("descarga") || sentence.contains("deload") else { return false }
            let numbers = sentence.split { !$0.isNumber }.compactMap { Int($0) }
            if sentence.contains("cada") || sentence.contains("every") {
                return numbers.first.map { $0 > 0 && week % $0 == 0 } ?? false
            }
            if week == weeks, ["última", "ultima", "last", "final"].contains(where: sentence.contains) { return true }
            return numbers.contains(week)
        }
    }

    /// Sets × (rest + work), rounded to 5 minutes, never under 10.
    static func minutes(_ day: ProgramDay) -> Int {
        let seconds = day.exercises.reduce(0) { $0 + $1.sets * ($1.restSeconds + workSeconds) }
        return max(10, Int((Double(seconds) / 60 / 5).rounded()) * 5)
    }

    /// "4 series de 6 a 8 repeticiones con 32,5 kg", the load only when there is a suggestion.
    static func prescription(_ exercise: ProgramExercise, weightKg: Double?) -> String {
        guard let weightKg, weightKg > 0 else { return exercise.prescription }
        return "\(exercise.prescription) con \(weightKg.formatted()) kg"
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
