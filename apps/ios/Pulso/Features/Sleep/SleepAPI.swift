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

    /// A shape per stage for legends and lane labels when the person asks to
    /// differentiate without colour.
    var symbol: String {
        switch self {
        case .inBed: "rectangle.fill"
        case .awake: "triangle.fill"
        case .rem: "diamond.fill"
        case .core: "circle.fill"
        case .deep: "square.fill"
        case .asleep: "hexagon.fill"
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
    /// Set on a night logged by hand (`sourceKind` "manual").
    struct Manual: Codable, Equatable {
        var id: String
        var note: String?
    }

    var night: String
    var source: String
    /// "watch" | "phone" | "other" | "manual"; nil from an older engine.
    var sourceKind: String?
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
    /// Only on a hand-logged night: one asleep span, no stages, efficiency not measured.
    var manual: Manual?

    var id: String { night }
    var isManual: Bool { manual != nil }
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

    /// Logs a night by hand. 409 "measured" when Health already has it, "taken" when one was logged for that date.
    func addManualSleep(start: Date, end: Date, note: String?) async throws -> ManualSleepNight {
        try await call("api/mobile/sleep/manual", method: "POST", body: ManualSleepBody(start: start, end: end, note: note))
    }

    func updateManualSleep(id: String, start: Date, end: Date, note: String?) async throws -> ManualSleepNight {
        try await call("api/mobile/sleep/manual/\(id)", method: "PATCH", body: ManualSleepBody(start: start, end: end, note: note))
    }

    @discardableResult
    func deleteManualSleep(id: String) async throws -> ManualSleepNight {
        try await call("api/mobile/sleep/manual/\(id)", method: "DELETE")
    }
}

/// A night logged by hand (`@pulso/contract` `ManualSleepNight`). `night` is the wake date.
struct ManualSleepNight: Codable, Equatable, Identifiable {
    var id: String
    var night: String
    var start: Double
    var end: Double
    var tzOffsetMin: Int
    var note: String?
    /// Health measured that night since; the measured one is shown instead.
    var hidden: Bool
    var createdAt: Double
    var updatedAt: Double
}

/// POST and PATCH body. `note` is always sent, so nil clears it on an edit.
private struct ManualSleepBody: Encodable {
    var start: Double
    var end: Double
    var tzOffsetMin: Int
    var note: String?

    init(start: Date, end: Date, note: String?) {
        self.start = (start.timeIntervalSince1970 * 1000).rounded()
        self.end = (end.timeIntervalSince1970 * 1000).rounded()
        tzOffsetMin = TimeZone.current.secondsFromGMT(for: start) / 60
        self.note = note
    }

    private enum CodingKeys: String, CodingKey { case start, end, tzOffsetMin, note }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(start, forKey: .start)
        try c.encode(end, forKey: .end)
        try c.encode(tzOffsetMin, forKey: .tzOffsetMin)
        try c.encode(note, forKey: .note)
    }
}

extension Theme {
    /// Sleep stages. Deep → core → REM step up in lightness so they read apart without hue
    /// (red-green colour blindness); awake is the one warm stage.
    static let sleep = Color(light: 0x5A5FE0, dark: 0x7B80FF)
    static let sleepAwake = Color(light: 0xE8650F, dark: 0xFFA24D)
    static let sleepREM = Color(light: 0x5FBFF0, dark: 0xA8DEFF)
    static let sleepCore = Color(light: 0x3C7FF0, dark: 0x4D9BFF)
    static let sleepDeep = Color(light: 0x2F3FB8, dark: 0x4B5BEA)
    static let sleepInBed = Color(light: 0x8A8F98, dark: 0x9AA0AA)
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
