import Foundation
import SwiftUI
import UIKit

/// `@pulso/contract` substance types. Dates are local "yyyy-MM-dd", times "HH:mm".
/// Enums decode values this build doesn't know as a neutral fallback, and lists drop
/// items they can't read, so a newer engine never empties the screen.
protocol SubstanceLenientEnum: RawRepresentable, Decodable where RawValue == String {
    static var fallback: Self { get }
}

extension SubstanceLenientEnum {
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: raw) ?? .fallback
    }
}

/// Decodes an array item by item, skipping the ones that fail.
struct SubstanceLossyList<T: Decodable>: Decodable {
    var items: [T]

    private struct Item: Decodable {
        var value: T?
        init(from decoder: Decoder) throws { value = try? T(from: decoder) }
    }

    init(from decoder: Decoder) throws {
        items = try decoder.singleValueContainer().decode([Item].self).compactMap(\.value)
    }
}

private extension KeyedDecodingContainer {
    func lossyList<T: Decodable>(_ type: T.Type, forKey key: Key) -> [T] {
        (try? decodeIfPresent(SubstanceLossyList<T>.self, forKey: key))?.items ?? []
    }
}

enum SubstanceStyle {
    /// One calm color for the whole feature; levels are its opacity, never red or green.
    static let tint = Theme.training
    static let symbol = "circle.dashed"
}

/// A substance the person tracks: Cannabis and Alcohol come built in, the rest are theirs.
/// Archived ones are hidden from pickers but keep their history.
struct Substance: Decodable, Identifiable, Equatable, Hashable {
    static let cannabis = "cannabis"

    var id: String
    var name: String
    /// An emoji or an SF Symbol name; nil = the default symbol.
    var symbol: String?
    /// What an entry's `quantity` counts: sesiones, mg, ml, tragos…
    var unit: String
    /// How it can be taken, in order; the first is the default when logging.
    var forms: [String]
    var maxDaysPerWeek: Int?
    var archived: Bool
    var position: Int
    var builtin: Bool

    init(id: String, name: String, symbol: String? = nil, unit: String = "veces", forms: [String] = [], maxDaysPerWeek: Int? = nil, archived: Bool = false, position: Int = 0, builtin: Bool = false) {
        self.id = id
        self.name = name
        self.symbol = symbol
        self.unit = unit
        self.forms = forms
        self.maxDaysPerWeek = maxDaysPerWeek
        self.archived = archived
        self.position = position
        self.builtin = builtin
    }

    enum CodingKeys: CodingKey { case id, name, symbol, unit, forms, maxDaysPerWeek, archived, position, builtin }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        symbol = try? c.decodeIfPresent(String.self, forKey: .symbol)
        unit = (try? c.decodeIfPresent(String.self, forKey: .unit)) ?? "veces"
        forms = c.lossyList(String.self, forKey: .forms)
        maxDaysPerWeek = try? c.decodeIfPresent(Int.self, forKey: .maxDaysPerWeek)
        archived = (try? c.decodeIfPresent(Bool.self, forKey: .archived)) ?? false
        position = (try? c.decodeIfPresent(Int.self, forKey: .position)) ?? 0
        builtin = (try? c.decodeIfPresent(Bool.self, forKey: .builtin)) ?? false
    }

    /// Active by position, then archived by position: the order the engine lists them in.
    static func sorted(_ list: [Substance]) -> [Substance] {
        list.sorted { ($0.archived ? 1 : 0, $0.position) < ($1.archived ? 1 : 0, $1.position) }
    }
}

/// How a substance's `symbol` draws: an emoji as text, else an SF Symbol (the
/// neutral default when the name is empty or not a symbol on this iOS).
enum SubstanceGlyph: Equatable {
    case emoji(String)
    case system(String)

    static func resolve(_ symbol: String?, isSystemSymbol: (String) -> Bool = { UIImage(systemName: $0) != nil }) -> SubstanceGlyph {
        let text = symbol?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if isEmoji(text) { return .emoji(text) }
        if !text.isEmpty, isSystemSymbol(text) { return .system(text) }
        return .system(SubstanceStyle.symbol)
    }

    /// One character that renders as an emoji ("🌿", "☕️", "👍🏽"); digits and letters don't count.
    static func isEmoji(_ text: String) -> Bool {
        guard text.count == 1, let first = text.unicodeScalars.first else { return false }
        if first.properties.isEmojiPresentation { return true }
        let scalars = text.unicodeScalars
        return first.properties.isEmoji && (first.value > 0x238C || scalars.contains { $0.value == 0xFE0F })
    }
}

/// Draws a substance symbol at the surrounding font.
struct SubstanceGlyphView: View {
    let symbol: String?

    var body: some View {
        switch SubstanceGlyph.resolve(symbol) {
        case let .emoji(emoji): Text(emoji)
        case let .system(name): Image(systemName: name)
        }
    }
}

/// What the dashboard shows: every active substance together, or one.
enum SubstanceScope: Hashable {
    case all
    case one(String)

    var query: String {
        switch self {
        case .all: "all"
        case let .one(id): id
        }
    }

    var substanceId: String? {
        if case let .one(id) = self { id } else { nil }
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
    var substanceId: String
    var date: String
    var time: String
    /// One of the substance's forms, or nil.
    var form: String?
    var amount: SubstanceAmount
    /// How much, in the substance's unit.
    var quantity: Double?
    var thcMg: Double?
    var context: SubstanceContext?
    var note: String?

    enum CodingKeys: CodingKey { case id, substanceId, date, time, form, amount, quantity, thcMg, context, note }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        substanceId = try c.decode(String.self, forKey: .substanceId)
        date = try c.decode(String.self, forKey: .date)
        time = try c.decode(String.self, forKey: .time)
        form = try? c.decodeIfPresent(String.self, forKey: .form)
        amount = (try? c.decodeIfPresent(SubstanceAmount.self, forKey: .amount)) ?? .normal
        quantity = try? c.decodeIfPresent(Double.self, forKey: .quantity)
        thcMg = try? c.decodeIfPresent(Double.self, forKey: .thcMg)
        context = try? c.decodeIfPresent(SubstanceContext.self, forKey: .context)
        note = try? c.decodeIfPresent(String.self, forKey: .note)
    }

    var at: Date? { LocalClock.instant(date: date, time: time) }

    /// "Fumado · Normal"; with the name first when entries of several substances mix
    /// ("Alcohol · Poco"), and the name alone standing in for a missing form.
    func title(substanceName: String, showingName: Bool) -> String {
        var parts: [String] = []
        if showingName || form == nil { parts.append(substanceName) }
        if let form { parts.append(SubstanceText.capitalizedFirst(form)) }
        parts.append(amount.label)
        return parts.joined(separator: " · ")
    }
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
    struct FormUses: Decodable, Equatable { var form: String; var uses: Int }
    struct ContextUses: Decodable, Equatable { var context: SubstanceContext; var uses: Int }
    struct SubstanceUses: Decodable, Equatable { var substanceId: String; var uses: Int }

    /// Nil = Todas.
    var substanceId: String?
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
    var byForm: [FormUses]
    var byContext: [ContextUses]
    /// Todas only: uses per substance.
    var bySubstance: [SubstanceUses]
    /// The substance's own goal; nil for Todas or without one.
    var goal: Goal?
    var correlations: [SubstanceCorrelation]
    /// Alcohol only: days with alcoholic drinks logged as meals in Dieta.
    var drinkDays: Int?

    enum CodingKeys: CodingKey {
        case substanceId, today, days, weeks, avgDaysPerWeek, daysThisWeek, daysWithout, longestWithout, lastUse
        case timeOfDay, byForm, byContext, bySubstance, goal, correlations, drinkDays
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        substanceId = try? c.decodeIfPresent(String.self, forKey: .substanceId)
        today = try c.decode(String.self, forKey: .today)
        days = c.lossyList(SubstanceDay.self, forKey: .days)
        weeks = c.lossyList(SubstanceWeek.self, forKey: .weeks)
        avgDaysPerWeek = try? c.decodeIfPresent(Double.self, forKey: .avgDaysPerWeek)
        daysThisWeek = (try? c.decodeIfPresent(Int.self, forKey: .daysThisWeek)) ?? 0
        daysWithout = try? c.decodeIfPresent(Int.self, forKey: .daysWithout)
        longestWithout = (try? c.decodeIfPresent(Int.self, forKey: .longestWithout)) ?? 0
        lastUse = try? c.decodeIfPresent(LastUse.self, forKey: .lastUse)
        timeOfDay = c.lossyList(SubstanceTimeBucket.self, forKey: .timeOfDay)
        byForm = c.lossyList(FormUses.self, forKey: .byForm)
        byContext = c.lossyList(ContextUses.self, forKey: .byContext)
        bySubstance = c.lossyList(SubstanceUses.self, forKey: .bySubstance)
        goal = try? c.decodeIfPresent(Goal.self, forKey: .goal)
        correlations = c.lossyList(SubstanceCorrelation.self, forKey: .correlations)
        drinkDays = try? c.decodeIfPresent(Int.self, forKey: .drinkDays)
    }
}

struct SubstanceOverview: Decodable, Equatable {
    /// Active by position, then archived.
    var substances: [Substance]
    var summary: SubstanceSummary
    /// The last 60 days, newest first.
    var entries: [SubstanceEntry]

    enum CodingKeys: CodingKey { case substances, summary, entries }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        substances = Substance.sorted(c.lossyList(Substance.self, forKey: .substances))
        summary = try c.decode(SubstanceSummary.self, forKey: .summary)
        entries = c.lossyList(SubstanceEntry.self, forKey: .entries)
    }

    var scope: SubstanceScope { summary.substanceId.map(SubstanceScope.one) ?? .all }

    /// Nothing ever logged for this substance (or any, for Todas).
    var isEmpty: Bool { summary.lastUse == nil && entries.isEmpty }
}

/// `{ substances }` from the types routes.
struct SubstanceList: Decodable {
    var substances: [Substance]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        substances = Substance.sorted(c.lossyList(Substance.self, forKey: .substances))
    }

    enum CodingKeys: CodingKey { case substances }
}

/// Body for creating (with `name`) or changing a substance. Only set fields are
/// sent; a field set to `.some(nil)` goes as null, which is how a symbol or goal clears.
struct SubstancePatch: Encodable, Equatable {
    var name: String?
    var symbol: String??
    var unit: String?
    var forms: [String]?
    var maxDaysPerWeek: Int??
    var archived: Bool?

    enum CodingKeys: CodingKey { case name, symbol, unit, forms, maxDaysPerWeek, archived }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(name, forKey: .name)
        if let symbol { try c.encode(symbol, forKey: .symbol) }
        try c.encodeIfPresent(unit, forKey: .unit)
        try c.encodeIfPresent(forms, forKey: .forms)
        if let maxDaysPerWeek { try c.encode(maxDaysPerWeek, forKey: .maxDaysPerWeek) }
        try c.encodeIfPresent(archived, forKey: .archived)
    }
}

/// What the "Nueva sustancia" / edit sheet holds while typing.
struct SubstanceDefinition: Equatable {
    var name = ""
    var symbol = ""
    var unit = ""
    var forms: [String] = []
    var maxDaysPerWeek: Int?

    init() {}

    init(_ substance: Substance) {
        name = substance.name
        symbol = substance.symbol ?? ""
        unit = substance.unit
        forms = substance.forms
        maxDaysPerWeek = substance.maxDaysPerWeek
    }

    var isValid: Bool { !Self.clean(name).isEmpty }

    /// Trimmed; an empty unit is left out so the engine keeps (or defaults) it.
    var patch: SubstancePatch {
        let symbol = Self.clean(symbol)
        let unit = Self.clean(unit)
        var seen = Set<String>()
        let forms = forms.map(Self.clean).filter { !$0.isEmpty && seen.insert($0.lowercased()).inserted }
        return SubstancePatch(
            name: Self.clean(name),
            symbol: .some(symbol.isEmpty ? nil : symbol),
            unit: unit.isEmpty ? nil : unit,
            forms: forms,
            maxDaysPerWeek: .some(maxDaysPerWeek)
        )
    }

    private static func clean(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
}

/// What the log sheet sends, for both create and edit. Every field is encoded
/// (nil as null) so clearing one in the sheet clears it on the Mac.
struct SubstanceDraft: Encodable, Equatable {
    var substanceId: String
    var at = Date.now
    var form: String?
    var amount = SubstanceAmount.normal
    var quantity: Double?
    var thcMg: Double?
    var context: SubstanceContext?
    var note = ""

    init(substance: Substance) {
        substanceId = substance.id
        form = substance.forms.first
    }

    init(_ entry: SubstanceEntry) {
        substanceId = entry.substanceId
        at = entry.at ?? .now
        form = entry.form
        amount = entry.amount
        quantity = entry.quantity
        thcMg = entry.thcMg
        context = entry.context
        note = entry.note ?? ""
    }

    /// mg of THC only means something for cannabis edibles.
    var showsThc: Bool { substanceId == Substance.cannabis && form == "comestible" }

    /// Moving to another substance keeps the form only if that one has it too.
    mutating func switchTo(_ substance: Substance) {
        substanceId = substance.id
        if form.map({ !substance.forms.contains($0) }) ?? true { form = substance.forms.first }
    }

    enum CodingKeys: CodingKey { case substanceId, date, time, form, amount, quantity, thcMg, context, note }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(substanceId, forKey: .substanceId)
        try c.encode(LocalClock.date(at), forKey: .date)
        try c.encode(LocalClock.time(at), forKey: .time)
        try c.encode(form, forKey: .form)
        try c.encode(amount, forKey: .amount)
        try c.encode(quantity.flatMap { $0 > 0 ? $0 : nil }, forKey: .quantity)
        try c.encode(showsThc ? thcMg.flatMap { $0 > 0 ? $0 : nil } : nil, forKey: .thcMg)
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
        return capitalizedFirst(day.formatted(.dateTime.weekday(.wide).day().month(.abbreviated)))
    }

    static func days(_ n: Int) -> String { n == 1 ? "día" : "días" }

    /// "fumado" → "Fumado", leaving the rest as typed.
    static func capitalizedFirst(_ text: String) -> String { text.prefix(1).uppercased() + text.dropFirst() }

    /// A unit as a field label: "Tragos", but "mg" stays an abbreviation.
    static func unitLabel(_ unit: String) -> String { unit.count <= 2 ? unit : capitalizedFirst(unit) }

    /// Units the "Nueva sustancia" sheet suggests.
    static let unitSuggestions = ["sesiones", "mg", "ml", "unidades", "tragos"]

    private static let singulars = [
        "sesiones": "sesión", "unidades": "unidad", "tragos": "trago", "veces": "vez",
        "caladas": "calada", "cigarrillos": "cigarrillo", "bebidas": "bebida", "dosis": "dosis",
    ]

    /// "2 tragos", "1 trago", "2,5 mg".
    static func quantity(_ value: Double, unit: String) -> String {
        let number = value.formatted(.number.precision(.fractionLength(0...1)))
        let word = value == 1 ? singulars[unit.lowercased()] ?? unit : unit
        return "\(number) \(word)"
    }

    /// An SF Symbol for the forms Pulso knows; nil for the person's own.
    static func formSymbol(_ form: String) -> String? {
        switch form.lowercased() {
        case "fumado": "smoke"
        case "vapeado": "cloud"
        case "comestible": "fork.knife"
        case "bebido", "bebida": "cup.and.saucer"
        default: nil
        }
    }
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
