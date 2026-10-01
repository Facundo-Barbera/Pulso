import Foundation
import SwiftUI

/// HealthKit sleep stages as the engine names them (`@pulso/contract` `SleepStage`).
enum SleepStage: String, Codable, CaseIterable {
    case inBed, awake, rem, core, deep, asleep

    var label: String {
        switch self {
        case .inBed: "En cama"
        case .awake: "Despierto"
        case .rem: "REM"
        case .core: "Central"
        case .deep: "Profundo"
        case .asleep: "Dormido"
        }
    }

    var color: Color {
        switch self {
        case .inBed: Theme.sleepInBed
        case .awake: Theme.sleepAwake
        case .rem: Theme.sleepREM
        case .core: Theme.sleepCore
        case .deep: Theme.sleepDeep
        case .asleep: Theme.sleep
        }
    }
}

/// What the phone sends: one HealthKit sample. Times are epoch ms.
struct SleepSegmentInput: Codable, Equatable {
    var start: Double
    var end: Double
    var stage: SleepStage
    var source: String
    var sourceKind: String
    var tzOffsetMin: Int
}

struct SleepSegment: Codable, Equatable {
    var start: Double
    var end: Double
    var stage: SleepStage

    var startDate: Date { Date(timeIntervalSince1970: start / 1000) }
    var endDate: Date { Date(timeIntervalSince1970: end / 1000) }
}

struct SleepScoreFactor: Codable, Equatable, Identifiable {
    var key: String
    var label: String
    var points: Double
    var maxPoints: Double
    var detail: String
    var id: String { key }
}

struct SleepScore: Codable, Equatable {
    var value: Double
    var factors: [SleepScoreFactor]
    var explanation: String
}

struct SleepMinutes: Codable, Equatable {
    var inBed: Double
    var asleep: Double
    var awake: Double
    var core: Double
    var deep: Double
    var rem: Double
    var unspecified: Double
}

struct SleepStagePct: Codable, Equatable {
    var core: Double
    var deep: Double
    var rem: Double
}

/// One scored night (`SleepNight`). `bedtimeMin`/`wakeMin` are minutes from local midnight of `night`.
struct SleepNight: Codable, Equatable, Identifiable {
    var night: String
    var source: String
    var inBedStart: Double
    var inBedEnd: Double
    var asleepStart: Double
    var asleepEnd: Double
    var minutes: SleepMinutes
    var efficiency: Double
    var stagePct: SleepStagePct?
    var bedtimeMin: Double
    var wakeMin: Double
    var score: SleepScore
    var insights: [String]
    var segments: [SleepSegment]

    var id: String { night }
    /// Local midnight of the day this night ends on.
    var date: Date { SleepNight.dayFormatter.date(from: night) ?? .now }
    var bedtime: Date { Date(timeIntervalSince1970: inBedStart / 1000) }
    var wake: Date { Date(timeIntervalSince1970: asleepEnd / 1000) }

    static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}

struct SleepSummary: Codable, Equatable {
    var nights: Int
    var targetMin: Double
    var avgAsleepMin: Double?
    var avgScore: Double?
    var avgEfficiency: Double?
    var avgBedtimeMin: Double?
    var avgWakeMin: Double?
    var bedtimeSdMin: Double?
    var wakeSdMin: Double?
    var regularity: Double?
    var debtMin: Double
    var insights: [String]
}

/// `GET /api/mobile/sleep`: nights newest first and the 14-night summary.
struct SleepOverview: Codable, Equatable {
    var targetMin: Double
    var nights: [SleepNight]
    var summary: SleepSummary
}

extension PulsoAPI {
    private struct SleepSyncResponse: Decodable { var nights: Int }
    private struct SleepTargetResponse: Decodable { var targetMin: Double }

    func sleep() async throws -> SleepOverview {
        try await call("api/mobile/sleep", method: "GET")
    }

    /// Returns how many nights the engine wrote.
    func syncSleep(_ segments: [SleepSegmentInput]) async throws -> Int {
        let response: SleepSyncResponse = try await call("api/mobile/sleep", method: "POST", body: ["segments": segments])
        return response.nights
    }

    func setSleepTarget(minutes: Double) async throws -> Double {
        let response: SleepTargetResponse = try await call("api/mobile/sleep/target", method: "PUT", body: ["minutes": minutes])
        return response.targetMin
    }
}

extension Theme {
    /// Sleep stages, close to Apple's Sleep palette.
    static let sleep = Color(red: 0.42, green: 0.45, blue: 0.98)
    static let sleepAwake = Color(red: 1.00, green: 0.50, blue: 0.40)
    static let sleepREM = Color(red: 0.38, green: 0.80, blue: 0.98)
    static let sleepCore = Color(red: 0.22, green: 0.50, blue: 0.98)
    static let sleepDeep = Color(red: 0.36, green: 0.26, blue: 0.86)
    static let sleepInBed = Color(red: 0.55, green: 0.60, blue: 0.75)
}

/// "7 h 20 min", "45 min".
func sleepDuration(_ minutes: Double) -> String {
    let total = Int(abs(minutes).rounded())
    let h = total / 60, m = total % 60
    if h == 0 { return "\(m) min" }
    return m == 0 ? "\(h) h" : "\(h) h \(m) min"
}

/// Minutes from midnight (negative = the evening before) as a clock time, "23:15".
func sleepClock(_ minutes: Double) -> String {
    let total = ((Int(minutes.rounded()) % 1440) + 1440) % 1440
    return String(format: "%02d:%02d", total / 60, total % 60)
}
