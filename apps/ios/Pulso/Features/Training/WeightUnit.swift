import Foundation

/// Kilos and pounds. Weights are stored (and sent) in kg; a unit only changes how
/// a weight is shown, typed and stepped. A port of the engine's
/// `src/training/units.ts`: keep the two in step.
enum WeightUnit: String, Codable, CaseIterable, Hashable, Identifiable {
    case kg
    case lb

    static let kgPerLb = 0.45359237

    var id: Self { self }
    var other: WeightUnit { self == .kg ? .lb : .kg }

    func toUnit(_ kg: Double) -> Double { self == .lb ? kg / Self.kgPerLb : kg }
    /// The exact kg of a weight typed in this unit: 45 lb → 20.41165665 kg, which reads 45 lb again.
    func fromUnit(_ value: Double) -> Double { self == .lb ? value * Self.kgPerLb : value }

    /// The step real equipment moves in at `value`: plates and pin stacks go by
    /// 5 lb or 2.5 kg; small dumbbells (≤ 25 lb, ≤ 10 kg) by 2.5 lb or 1 kg.
    private func stepAt(_ value: Double) -> Double {
        self == .lb ? (value <= 25 ? 2.5 : 5) : (value <= 10 ? 1 : 2.5)
    }

    private var smallUpTo: Double { self == .lb ? 25 : 10 }

    /// Off by less than this from a quarter, a value is one the person typed or lifted (and float noise).
    private static let epsilon = 1e-6
    private static func quarter(_ v: Double) -> Double { (v * 4).rounded() / 4 }
    private static func isQuarter(_ v: Double) -> Bool { abs(v - quarter(v)) < epsilon }

    /// A weight as it reads on the equipment, in this unit. One that already is
    /// (a multiple of 0.25: 14 kg, 45 lb, 47.5 lb) stays; one that came from the
    /// other unit (20 kg = 44.09 lb) goes to the nearest step.
    func snap(_ kg: Double) -> Double {
        let v = toUnit(kg)
        if Self.isQuarter(v) { return max(0, Self.quarter(v)) }
        let step = stepAt(v)
        return max(0, (v / step).rounded() * step)
    }

    /// `snap` back in kg, exact: what to store for a weight on this unit's steps.
    func snapKg(_ kg: Double) -> Double { fromUnit(snap(kg)) }

    /// One step up from `value` (in this unit), landing on the step grid.
    func stepUp(_ value: Double) -> Double {
        let step = value < smallUpTo ? stepAt(value) : stepAt(smallUpTo + 1)
        return (value / step + Self.epsilon).rounded(.down) * step + step
    }

    /// One step down from `value` (in this unit), landing on the step grid, never below 0.
    func stepDown(_ value: Double) -> Double {
        let step = stepAt(value)
        return max(0, (value / step - Self.epsilon).rounded(.up) * step - step)
    }

    /// A weight for reading: a real one as it is (61.25 kg), a converted one to 0.1 (44.1 lb for 20 kg).
    func shown(_ kg: Double) -> Double {
        let v = toUnit(kg)
        return Self.isQuarter(v) ? Self.quarter(v) : (v * 10).rounded() / 10
    }

    /// "45 lb", "20,4 kg", "61,25 kg".
    func format(_ kg: Double) -> String { "\(Self.number(shown(kg))) \(rawValue)" }

    /// "100 lb · 45,4 kg": the weight in this unit, then the other one.
    func formatBoth(_ kg: Double) -> String { "\(format(kg)) · \(other.format(kg))" }

    /// A total, whole: "2368 lb" for a session's volume.
    func formatTotal(_ kg: Double) -> String { "\(Self.number(toUnit(kg).rounded())) \(rawValue)" }

    /// Spanish decimals, up to two: "20,4", "61,25", "1074".
    static func number(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)).locale(Locale(identifier: "es")))
    }
}
