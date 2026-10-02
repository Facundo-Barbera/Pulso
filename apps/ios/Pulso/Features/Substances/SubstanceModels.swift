import Foundation
import SwiftUI

/// `@pulso/contract` substance types. Dates are local "yyyy-MM-dd", times "HH:mm".
/// Enums decode values this build doesn't know as a neutral fallback, so a newer
/// engine never empties the screen.
protocol SubstanceLenientEnum: RawRepresentable, Decodable where RawValue == String {
    static var fallback: Self { get }
}

extension SubstanceLenientEnum {
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: raw) ?? .fallback
    }
}

enum SubstanceStyle {
    /// One calm color for the whole feature; levels are its opacity, never red or green.
    static let tint = Theme.training
    static let symbol = "circle.dashed"
}

/// Strict: an entry for a substance this build doesn't know is dropped, not misfiled.
enum Substance: String, Codable, CaseIterable, Identifiable {
    case cannabis, alcohol, nicotina
    var id: String { rawValue }

    var label: String {
        switch self {
        case .cannabis: "Cannabis"
        case .alcohol: "Alcohol"
        case .nicotina: "Nicotina/Tabaco"
        }
    }

    /// For the segmented picker.
    var shortLabel: String { self == .nicotina ? "Nicotina" : label }

    var symbol: String {
        switch self {
        case .cannabis: "circle.dashed"
        case .alcohol: "wineglass"
        case .nicotina: "smoke"
        }
    }

    /// What `count` counts, in the log sheet.
    var countLabel: String {
        switch self {
        case .cannabis: "Sesiones o caladas"
        case .alcohol: "Bebidas"
        case .nicotina: "Cigarrillos o caladas"
        }
    }
}

enum SubstanceForm: String, Encodable, CaseIterable, Identifiable, SubstanceLenientEnum {
    case fumado, vapeado, comestible, otro
    static let fallback = SubstanceForm.otro
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
    var symbol: String {
        switch self {
        case .fumado: "smoke"
        case .vapeado: "cloud"
        case .comestible: "fork.knife"
        case .otro: "circle.dashed"
        }
    }
}

enum SubstanceAmount: String, Encodable, CaseIterable, Identifiable, SubstanceLenientEnum {
    case poco, normal, mucho
    static let fallback = SubstanceAmount.normal
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

enum SubstanceContext: String, Encodable, CaseIterable, Identifiable, SubstanceLenientEnum {
    case social, solo, dormir, estres, otro
    static let fallback = SubstanceContext.otro
    var id: String { rawValue }
    var label: String {
        switch self {
        case .social: "Social"
        case .solo: "Solo"
        case .dormir: "Para dormir"
        case .estres: "Estrés"
        case .otro: "Otro"
        }
    }
}

struct SubstanceEntry: Decodable, Identifiable, Equatable {
    var id: String
    var substance: Substance
    var date: String
    var time: String
    var form: SubstanceForm?
    var amount: SubstanceAmount
    var count: Int?
    var thcMg: Double?
    var context: SubstanceContext?
    var note: String?

    var at: Date? { LocalClock.instant(date: date, time: time) }

    /// "Fumado · Normal", or "Alcohol · Poco".
    var title: String {
        [form?.label ?? substance.label, amount.label].joined(separator: " · ")
    }

    var symbol: String { form?.symbol ?? substance.symbol }
}

/// One day of the 8-week heatmap. `level` is the largest amount that day, 0 = none.
struct SubstanceDay: Decodable, Identifiable, Equatable {
    var date: String
    var uses: Int
    var level: Int
    var id: String { date }
}

/// One ISO week (Monday start).
struct SubstanceWeek: Decodable, Identifiable, Equatable {
    var weekStart: String
    var days: Int
    var id: String { weekStart }
    var start: Date? { LocalClock.day(weekStart) }
}

struct SubstanceTimeBucket: Decodable, Identifiable, Equatable {
    /// manana | tarde | noche | madrugada
    var key: String
    var label: String
    var uses: Int
    var id: String { key }

    var symbol: String {
        switch key {
        case "manana": "sunrise"
        case "tarde": "sun.max"
        case "noche": "moon"
        default: "moon.stars"
        }
    }
}

/// Nights (or next days) with and without use, compared softly and always with sample sizes.
struct SubstanceCorrelation: Decodable, Identifiable, Equatable {
    var key: String
    var label: String
    var unit: String
    var withUse: Double?
    var withoutUse: Double?
    var diff: Double?
    var nWith: Int
    var nWithout: Int
    var enough: Bool
    /// The engine's Spanish one-liner when `enough`.
    var text: String?
    var id: String { key }

    var symbol: String {
        switch key {
        case "sleep_minutes", "sleep_score": "bed.double"
        case "hrv": "waveform.path.ecg"
        case "resting_hr": "heart"
        case "readiness": "gauge.with.dots.needle.67percent"
        case "late_eating": "fork.knife"
        default: "chart.bar"
        }
    }
}

struct SubstanceSummary: Decodable, Equatable {
    struct LastUse: Decodable, Equatable { var date: String; var time: String }
    struct Goal: Decodable, Equatable { var maxDaysPerWeek: Int; var daysThisWeek: Int; var within: Bool }

    var today: String
    /// Oldest first, from a Monday seven weeks ago through today.
    var days: [SubstanceDay]
    /// Last 8 ISO weeks, oldest first; the last is this week so far.
    var weeks: [SubstanceWeek]
    var avgDaysPerWeek: Double?
    var daysThisWeek: Int
    /// Days in a row without use ending today; nil when nothing was ever logged.
    var daysWithout: Int?
    var longestWithout: Int
    var lastUse: LastUse?
    var timeOfDay: [SubstanceTimeBucket]
    var goal: Goal?
    var correlations: [SubstanceCorrelation]
    /// Alcohol only: days with alcoholic drinks logged as meals in Dieta.
    var drinkDays: Int?
}

struct SubstanceSettings: Codable, Equatable {
    var maxDaysPerWeek: Int?

    enum CodingKeys: CodingKey { case maxDaysPerWeek }

    init(maxDaysPerWeek: Int?) { self.maxDaysPerWeek = maxDaysPerWeek }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        maxDaysPerWeek = try c.decodeIfPresent(Int.self, forKey: .maxDaysPerWeek)
    }

    /// Nil goes as null: that is how the goal is cleared.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(maxDaysPerWeek, forKey: .maxDaysPerWeek)
    }
}

struct SubstanceOverview: Decodable, Equatable {
    var summary: SubstanceSummary
    /// The last 60 days, newest first.
    var entries: [SubstanceEntry]
    var settings: SubstanceSettings

    init(summary: SubstanceSummary, entries: [SubstanceEntry], settings: SubstanceSettings) {
        self.summary = summary
        self.entries = entries
        self.settings = settings
    }

    enum CodingKeys: CodingKey { case summary, entries, settings }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        summary = try c.decode(SubstanceSummary.self, forKey: .summary)
        entries = try c.decode([Lossy<SubstanceEntry>].self, forKey: .entries).compactMap(\.value)
        settings = try c.decodeIfPresent(SubstanceSettings.self, forKey: .settings) ?? SubstanceSettings(maxDaysPerWeek: nil)
    }

    /// Nothing ever logged for this substance.
    var isEmpty: Bool { summary.lastUse == nil && entries.isEmpty }

    private struct Lossy<T: Decodable>: Decodable {
        var value: T?
        init(from decoder: Decoder) throws { value = try? T(from: decoder) }
    }
}

/// What the log sheet sends, for both create and edit. Every field is encoded
/// (nil as null) so clearing one in the sheet clears it on the Mac.
struct SubstanceDraft: Encodable, Equatable {
    var substance = Substance.cannabis
    var at = Date.now
    var form: SubstanceForm? = .fumado
    var amount = SubstanceAmount.normal
    var count: Int?
    var thcMg: Double?
    var context: SubstanceContext?
    var note = ""

    init(substance: Substance = .cannabis) {
        self.substance = substance
        form = substance == .cannabis ? .fumado : nil
    }

    init(_ entry: SubstanceEntry) {
        substance = entry.substance
        at = entry.at ?? .now
        form = entry.form
        amount = entry.amount
        count = entry.count
        thcMg = entry.thcMg
        context = entry.context
        note = entry.note ?? ""
    }

    /// mg of THC matters for edibles; the field shows there (or when already filled).
    var showsThc: Bool { substance == .cannabis && (form == .comestible || thcMg != nil) }

    enum CodingKeys: CodingKey { case substance, date, time, form, amount, count, thcMg, context, note }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        let cannabis = substance == .cannabis
        try c.encode(substance, forKey: .substance)
        try c.encode(LocalClock.date(at), forKey: .date)
        try c.encode(LocalClock.time(at), forKey: .time)
        try c.encode(cannabis ? (form ?? .fumado) : nil, forKey: .form)
        try c.encode(amount, forKey: .amount)
        try c.encode(count.flatMap { $0 > 0 ? $0 : nil }, forKey: .count)
        try c.encode(cannabis ? thcMg.flatMap { $0 > 0 ? $0 : nil } : nil, forKey: .thcMg)
        try c.encode(context, forKey: .context)
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        try c.encode(trimmed.isEmpty ? nil : trimmed, forKey: .note)
    }
}

/// Pure helpers the views draw from; tested.
enum SubstanceText {
    /// "Hoy, 21:30", "Ayer, 21:30", "Hace 3 días".
    static func lastUse(date: String, time: String, now: Date = .now, calendar: Calendar = .current) -> String {
        guard let day = LocalClock.day(date) else { return date }
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: day), to: calendar.startOfDay(for: now)).day ?? 0
        switch days {
        case ...0: return "Hoy, \(LocalClock.display(time))"
        case 1: return "Ayer, \(LocalClock.display(time))"
        default: return "Hace \(days) días"
        }
    }

    /// "Hoy", "Ayer", else "lunes 29 sept".
    static func dayTitle(_ date: String, calendar: Calendar = .current) -> String {
        guard let day = LocalClock.day(date) else { return date }
        if calendar.isDateInToday(day) { return "Hoy" }
        if calendar.isDateInYesterday(day) { return "Ayer" }
        let text = day.formatted(.dateTime.weekday(.wide).day().month(.abbreviated))
        return text.prefix(1).uppercased() + text.dropFirst()
    }

    static func days(_ n: Int) -> String { n == 1 ? "día" : "días" }
}

enum SubstanceHeatmap {
    /// `days` (oldest first) as week columns of 7 weekday rows, Monday first. Days
    /// before the first or after the last (the rest of this week) are nil.
    static func columns(_ days: [SubstanceDay], calendar: Calendar = .current) -> [[SubstanceDay?]] {
        guard let first = days.first.flatMap({ LocalClock.day($0.date) }) else { return [] }
        let leading = LocalClock.isoWeekday(first, calendar: calendar) - 1
        var cells: [SubstanceDay?] = Array(repeating: nil, count: leading) + days.map { Optional($0) }
        if cells.count % 7 != 0 { cells += Array(repeating: nil, count: 7 - cells.count % 7) }
        return stride(from: 0, to: cells.count, by: 7).map { Array(cells[$0..<$0 + 7]) }
    }

    static func opacity(level: Int) -> Double {
        switch level {
        case ...0: 0.1
        case 1: 0.38
        case 2: 0.65
        default: 0.95
        }
    }
}
