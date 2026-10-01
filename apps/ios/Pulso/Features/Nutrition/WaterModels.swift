import Foundation

// Mirrors of `@pulso/contract` water types, and the person's units.

/// How the person counts water.
enum WaterUnit: String, Codable, CaseIterable, Identifiable {
    case ml, vaso, botella
    var id: String { rawValue }

    var title: String {
        switch self {
        case .ml: "Mililitros"
        case .vaso: "Vasos"
        case .botella: "Botellas"
        }
    }
}

struct WaterSettings: Codable, Equatable {
    /// nil = automatic (35 ml/kg of body weight, or 2 L).
    var goalMl: Double?
    var unit: WaterUnit
    var glassMl: Double
    var bottleMl: Double

    static let standard = WaterSettings(goalMl: nil, unit: .vaso, glassMl: 250, bottleMl: 500)

    /// Millilitres in one `unit`.
    func ml(per unit: WaterUnit) -> Double {
        switch unit {
        case .ml: 1
        case .vaso: glassMl
        case .botella: bottleMl
        }
    }

    /// `ml` counted in the person's unit: 750 ml → 3 vasos of 250 ml.
    func count(_ ml: Double, in unit: WaterUnit? = nil) -> Double { ml / self.ml(per: unit ?? self.unit) }

    /// "1,25 L", "750 ml", "3 vasos", "1,5 botellas".
    func format(_ ml: Double, in unit: WaterUnit? = nil) -> String {
        switch unit ?? self.unit {
        case .ml: Self.litres(ml)
        case .vaso: Self.counted(count(ml, in: .vaso), "vaso", "vasos")
        case .botella: Self.counted(count(ml, in: .botella), "botella", "botellas")
        }
    }

    /// Below a litre in ml, from there in litres with up to two decimals.
    static func litres(_ ml: Double) -> String {
        ml < 1000 ? "\(Int(ml.rounded())) ml" : "\((ml / 1000).formatted(.number.precision(.fractionLength(0...2)))) L"
    }

    private static func counted(_ n: Double, _ one: String, _ many: String) -> String {
        let rounded = (n * 2).rounded() / 2 // halves are as precise as anyone counts glasses
        return "\(rounded.formatted(.number.precision(.fractionLength(0...1)))) \(rounded == 1 ? one : many)"
    }
}

struct WaterEntry: Codable, Equatable, Identifiable {
    var id: String
    var date: String
    var loggedAt: Double
    var amountMl: Double
    var source: String
}

struct WaterDay: Codable, Equatable {
    var date: String
    var totalMl: Double
    var goalMl: Double
    /// "custom", "weight" or "default".
    var goalSource: String
    var entries: [WaterEntry]
    var settings: WaterSettings

    var progress: Double { goalMl > 0 ? totalMl / goalMl : 0 }
    var leftMl: Double { max(goalMl - totalMl, 0) }
}

/// A one-tap amount on the water card.
struct WaterPreset: Identifiable, Equatable {
    var title: String
    var ml: Double
    var systemImage: String
    var id: String { "\(title)-\(ml)" }

    /// A glass and a bottle of the person's sizes, plus a litre when their bottle isn't one.
    static func presets(_ settings: WaterSettings) -> [WaterPreset] {
        var presets = [
            WaterPreset(title: "Vaso", ml: settings.glassMl, systemImage: "drop.fill"),
            WaterPreset(title: "Botella", ml: settings.bottleMl, systemImage: "waterbottle.fill"),
        ]
        if settings.bottleMl != 1000 { presets.append(WaterPreset(title: "1 L", ml: 1000, systemImage: "waterbottle")) }
        return presets
    }
}
