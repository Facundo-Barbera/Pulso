import Foundation

/// Lean, fat (kg) or ECW ratio per body segment (`@pulso/contract` `Segmental`).
struct Segmental: Codable, Equatable {
    var rightArm: Double
    var leftArm: Double
    var trunk: Double
    var rightLeg: Double
    var leftLeg: Double
}

/// One body-composition measurement (`BodyScan`). Times are epoch ms. Also what
/// the phone POSTs to save one: nil fields mean "not measured". `id` is nil
/// until the engine has stored it (a parsed QR has none yet).
struct BodyScan: Codable, Identifiable, Equatable {
    var id: String?
    var measuredAt: Double
    var source: String = "manual"
    var externalId: String?
    var device: String?
    var weight: Double?
    var skeletalMuscleMass: Double?
    var bodyFatMass: Double?
    var percentBodyFat: Double?
    var bmi: Double?
    var visceralFatLevel: Double?
    var bmr: Double?
    var totalBodyWater: Double?
    var ecwRatio: Double?
    var inbodyScore: Double?
    var softLeanMass: Double?
    var protein: Double?
    var mineral: Double?
    var boneMineralContent: Double?
    var bodyCellMass: Double?
    var intracellularWater: Double?
    var extracellularWater: Double?
    var smi: Double?
    var waistHipRatio: Double?
    var waistCircumference: Double?
    var visceralFatArea: Double?
    var phaseAngle: Double?
    var segmentalLean: Segmental?
    var segmentalFat: Segmental?
    var segmentalEcw: Segmental?
    var raw: String?

    var date: Date { Date(timeIntervalSince1970: measuredAt / 1000) }

    /// Lean mass when the sheet does not say: weight minus fat.
    var leanMass: Double? {
        guard let weight, let bodyFatMass else { return nil }
        return weight - bodyFatMass
    }
}

/// The four metrics with a trend, projection and goal.
enum BodyMetric: String, Codable, CaseIterable, Identifiable {
    case weight, bodyFatMass, skeletalMuscleMass, percentBodyFat
    var id: String { rawValue }

    var title: String {
        switch self {
        case .weight: "Peso"
        case .bodyFatMass: "Grasa"
        case .skeletalMuscleMass: "Músculo"
        case .percentBodyFat: "% Grasa"
        }
    }

    var unit: String { self == .percentBodyFat ? "%" : "kg" }

    /// Which direction is good news, for coloring a change.
    var lowerIsBetter: Bool { self != .skeletalMuscleMass }

    func value(in scan: BodyScan) -> Double? {
        switch self {
        case .weight: scan.weight
        case .bodyFatMass: scan.bodyFatMass
        case .skeletalMuscleMass: scan.skeletalMuscleMass
        case .percentBodyFat: scan.percentBodyFat
        }
    }
}

struct BodyGoal: Codable, Equatable {
    var metric: BodyMetric
    var target: Double
    var setAt: Double
}

struct ProjectionPoint: Codable, Equatable {
    var at: Double
    var value: Double
    var low: Double
    var high: Double
    var date: Date { Date(timeIntervalSince1970: at / 1000) }
}

struct BodyProjection: Codable, Equatable {
    struct Observed: Codable, Equatable {
        var at: Double
        var value: Double
        var date: Date { Date(timeIntervalSince1970: at / 1000) }
    }
    struct Horizon: Codable, Equatable {
        var weeks: Int
        var at: Double
        var value: Double
        var low: Double
        var high: Double
    }
    struct Goal: Codable, Equatable {
        var target: Double
        var eta: Double?
        var message: String
    }

    var metric: BodyMetric
    var unit: String
    var observed: [Observed]
    var current: Double?
    var slopePerWeek: Double?
    var band: [ProjectionPoint]
    var horizons: [Horizon]
    var goal: Goal?
    var note: String
}

/// A weight or body-fat reading from Apple Health (`BodySample`). Body fat in %.
struct BodySample: Codable, Equatable {
    var externalId: String
    var metric: String
    var value: Double
    var measuredAt: Double
}

struct BodyDashboard: Decodable {
    var scans: [BodyScan]
    var goals: [BodyGoal]
    var projections: [BodyProjection]
    /// Nil from an engine older than the InBody-style analysis.
    var analysis: BodyAnalysis?
}

/// Where a value sits against its normal range (`BodyBand`).
enum BodyBand: String, Codable {
    case low, normal, high

    var title: String {
        switch self {
        case .low: "Bajo"
        case .normal: "Normal"
        case .high: "Alto"
        }
    }
}

/// One bar of InBody's Muscle-Fat or Obesity analysis, laid out by the engine (`BodyGauge`).
struct BodyGauge: Codable, Equatable, Identifiable {
    struct Range: Codable, Equatable { var low: Double; var high: Double }
    struct Positions: Codable, Equatable { var value: Double; var previous: Double?; var low: Double; var high: Double }

    var metric: String
    var measuredAt: Double
    var value: Double
    var previous: Double?
    var unit: String
    var normal: Range
    var band: BodyBand
    /// % of the person's standard, for weight, muscle and fat mass.
    var percent: Double?
    /// 0–1 along the bar.
    var at: Positions
    var ticks: [String]

    var id: String { metric }
    var date: Date { Date(timeIntervalSince1970: measuredAt / 1000) }
}

/// One segment's mass against its standard (`SegmentValue`).
struct SegmentValue: Codable, Equatable {
    var kg: Double
    var percent: Double?
    var band: BodyBand?
}

struct SegmentValues: Codable, Equatable {
    var rightArm: SegmentValue
    var leftArm: SegmentValue
    var trunk: SegmentValue
    var rightLeg: SegmentValue
    var leftLeg: SegmentValue
}

/// InBody-style analysis from the engine (`BodyAnalysis`): standards for the height, the bars and the segments.
struct BodyAnalysis: Codable, Equatable {
    struct Basis: Codable, Equatable {
        var heightCm: Double
        var heightFrom: String
        var sex: String?
        var standardWeight: Double
    }
    struct MuscleFat: Codable, Equatable {
        var measuredAt: Double
        var gauges: [BodyGauge]
    }
    struct Segments: Codable, Equatable {
        struct Balance: Codable, Equatable, Hashable { var text: String; var even: Bool }
        var measuredAt: Double
        /// "height" against the standard for the height, "weight" against the person's own weight.
        var basis: String
        var lean: SegmentValues?
        var fat: SegmentValues?
        var balance: [Balance]
    }

    var basis: Basis?
    var muscleFat: MuscleFat?
    var obesity: [BodyGauge]
    var segments: Segments?
}

struct BodyImport: Decodable {
    struct Skipped: Decodable { var line: Int; var reason: String }
    var imported: Int
    var skipped: [Skipped]
}
