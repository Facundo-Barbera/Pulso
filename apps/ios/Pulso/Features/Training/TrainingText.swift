import Foundation

/// How training targets read on screen: whole Spanish words, no "RIR", "RPE",
/// "reps" or "3 × 8" shorthand.
enum TrainingText {
    /// "3 series de 6 a 8 repeticiones", "1 serie de 10 repeticiones".
    static func target(sets: Int, repMin: Int, repMax: Int) -> String {
        "\(sets) \(sets == 1 ? "serie" : "series") de \(reps(repMin, repMax))"
    }

    /// "4 series de 6 a 8", for lists.
    static func short(sets: Int, repMin: Int, repMax: Int) -> String {
        "\(sets) \(sets == 1 ? "serie" : "series") de \(repMin == repMax ? "\(repMin)" : "\(repMin) a \(repMax)")"
    }

    /// "6 a 8 repeticiones", "1 repetición".
    static func reps(_ min: Int, _ max: Int) -> String {
        min == max ? repetitions(min) : "\(min) a \(max) repeticiones"
    }

    /// "8 repeticiones", "1 repetición".
    static func repetitions(_ count: Int) -> String { count == 1 ? "1 repetición" : "\(count) repeticiones" }

    /// "80 kg, 8 repeticiones", "70 lb, 8 repeticiones", or the repetitions alone without a load.
    static func load(_ kg: Double, reps: Int, unit: WeightUnit = .kg) -> String {
        kg > 0 ? "\(unit.format(kg)), \(repetitions(reps))" : repetitions(reps)
    }

    /// A set from last time, short: "70 lb · 8", or "8 repeticiones" without a load.
    static func previous(_ kg: Double, reps: Int, unit: WeightUnit) -> String {
        kg > 0 ? "\(unit.format(kg)) · \(reps)" : repetitions(reps)
    }

    /// Repetitions to leave in the tank: the target RIR, else 10 − RPE.
    static func reserve(rir: Int?, rpe: Double?) -> Int? {
        rir ?? rpe.map { max(0, Int((10 - $0).rounded())) }
    }

    /// "Acaba cada serie pudiendo hacer 2 más"; nil without an effort target.
    static func effort(rir: Int?, rpe: Double?) -> String? {
        guard let left = reserve(rir: rir, rpe: rpe) else { return nil }
        return left == 0 ? "Lleva cada serie hasta no poder más" : "Acaba cada serie pudiendo hacer \(left) más"
    }

    /// 180 → "3 min", 90 → "1 min 30 s", 45 → "45 s".
    static func rest(_ seconds: Int) -> String {
        let (m, s) = (seconds / 60, seconds % 60)
        if m == 0 { return "\(s) s" }
        return s == 0 ? "\(m) min" : "\(m) min \(s) s"
    }
}

/// The 1–10 effort rating after an exercise, as Apple Fitness bands it.
/// Stored in the sets' `rpe` field.
enum EffortLevel {
    static let range = 1...10

    /// 1–3 Fácil, 4–6 Moderado, 7–8 Difícil, 9–10 Máximo.
    static func word(_ value: Int) -> String {
        switch value {
        case ...3: "Fácil"
        case 4...6: "Moderado"
        case 7...8: "Difícil"
        default: "Máximo"
        }
    }

    /// The bands with how many segments each covers, for the labels under the bar.
    static let bands: [(word: String, span: Int)] = [("Fácil", 3), ("Moderado", 3), ("Difícil", 2), ("Máximo", 2)]
}
