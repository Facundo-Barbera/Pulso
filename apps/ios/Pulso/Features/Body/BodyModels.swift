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
}

struct BodyImport: Decodable {
    struct Skipped: Decodable { var line: Int; var reason: String }
    var imported: Int
    var skipped: [Skipped]
}
