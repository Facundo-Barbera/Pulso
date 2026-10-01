import Foundation

/// `@pulso/contract` medication types. Dates are local "yyyy-MM-dd", times "HH:mm".
struct MedicationSchedule: Codable, Equatable {
    var asNeeded: Bool
    var times: [String]
    /// ISO weekdays, 1 = lunes … 7 = domingo. Empty = every day.
    var days: [Int]

    static let asNeededOnly = MedicationSchedule(asNeeded: true, times: [], days: [])
}

enum MedicationKind: String, Codable, CaseIterable, Identifiable {
    case medicamento, suplemento
    var id: String { rawValue }
    var label: String { self == .medicamento ? "Medicamento" : "Suplemento" }
    var symbol: String { self == .medicamento ? "pills.fill" : "leaf.fill" }
}

enum DoseStatus: String, Codable {
    case tomada, omitida, pospuesta, pendiente
}

struct Medication: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var kind: MedicationKind
    var dose: Double
    var unit: String
    var form: String?
    var instructions: String?
    var schedule: MedicationSchedule
    var startDate: String
    var endDate: String?
    var stock: Double?
    var lowStockThreshold: Double?
    var lowStock: Bool
    var active: Bool
    var notes: String?

    var doseText: String { "\(dose.formatted()) \(unit)" }
}

/// What the editor sends, for both create and update. Every field is always
/// encoded (nil as null) so clearing a field in the editor clears it on the Mac.
struct MedicationDraft: Encodable, Equatable {
    var name = ""
    var kind = MedicationKind.medicamento
    var dose = 1.0
    var unit = "comprimido"
    var form: String?
    var instructions: String?
    var schedule = MedicationSchedule(asNeeded: false, times: ["08:00"], days: [])
    var startDate = LocalClock.date(.now)
    var endDate: String?
    var stock: Double?
    var lowStockThreshold: Double?
    var active = true
    var notes: String?

    init() {}

    init(_ med: Medication) {
        name = med.name
        kind = med.kind
        dose = med.dose
        unit = med.unit
        form = med.form
        instructions = med.instructions
        schedule = med.schedule
        startDate = med.startDate
        endDate = med.endDate
        stock = med.stock
        lowStockThreshold = med.lowStockThreshold
        active = med.active
        notes = med.notes
    }

    enum CodingKeys: CodingKey {
        case name, kind, dose, unit, form, instructions, schedule, startDate, endDate, stock, lowStockThreshold, active, notes
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name.trimmingCharacters(in: .whitespaces), forKey: .name)
        try c.encode(kind, forKey: .kind)
        try c.encode(dose, forKey: .dose)
        try c.encode(unit.trimmingCharacters(in: .whitespaces), forKey: .unit)
        try c.encode(form, forKey: .form)
        try c.encode(instructions, forKey: .instructions)
        try c.encode(schedule, forKey: .schedule)
        try c.encode(startDate, forKey: .startDate)
        try c.encode(endDate, forKey: .endDate)
        try c.encode(stock, forKey: .stock)
        try c.encode(lowStockThreshold, forKey: .lowStockThreshold)
        try c.encode(active, forKey: .active)
        try c.encode(notes, forKey: .notes)
    }
}

struct DoseEvent: Codable, Identifiable, Equatable {
    var id: String
    var medicationId: String
    var date: String
    var scheduledTime: String?
    var status: DoseStatus
    var takenAt: Double?
}

struct DoseLog: Codable, Equatable {
    var medicationId: String
    var date: String
    var scheduledTime: String?
    var status: DoseStatus
    /// Epoch ms.
    var takenAt: Double?
}

struct DoseSlot: Codable, Identifiable, Equatable {
    var medicationId: String
    var name: String
    var kind: MedicationKind
    var dose: Double
    var unit: String
    var instructions: String?
    var date: String
    var time: String
    var status: DoseStatus
    var eventId: String?
    var takenAt: Double?

    var id: String { "\(medicationId)|\(date)|\(time)" }
    var doseText: String { "\(dose.formatted()) \(unit)" }
}

struct MedicationDay: Codable, Equatable {
    var date: String
    var slots: [DoseSlot]
    var asNeeded: [DoseEvent]
    var next: DoseSlot?

    var taken: Int { slots.count { $0.status == .tomada } }
}

struct AdherenceWindow: Codable, Equatable {
    var due: Int
    var taken: Int
    var rate: Double?
}

struct MedicationAdherence: Codable, Identifiable, Equatable {
    var medicationId: String
    var name: String
    var last7: AdherenceWindow
    var last30: AdherenceWindow
    var currentStreak: Int
    var bestStreak: Int
    var id: String { medicationId }
}

struct AdherenceDay: Codable, Identifiable, Equatable {
    var date: String
    var due: Int
    var taken: Int
    var id: String { date }
    var rate: Double? { due > 0 ? Double(taken) / Double(due) : nil }
}

struct AdherenceReport: Codable, Equatable {
    struct Overall: Codable, Equatable {
        var last7: AdherenceWindow
        var last30: AdherenceWindow
        var currentStreak: Int
        var bestStreak: Int
    }
    var overall: Overall
    var medications: [MedicationAdherence]
    var days: [AdherenceDay]
}

/// The engine speaks local "yyyy-MM-dd" / "HH:mm"; these convert both ways in the phone's calendar.
enum LocalClock {
    private static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = format
        return f
    }
    private static let dayFormatter = formatter("yyyy-MM-dd")
    private static let timeFormatter = formatter("HH:mm")

    static func date(_ d: Date) -> String { dayFormatter.string(from: d) }
    static func time(_ d: Date) -> String { timeFormatter.string(from: d) }

    /// Midnight of a "yyyy-MM-dd".
    static func day(_ s: String) -> Date? { dayFormatter.date(from: s) }

    /// The instant of "HH:mm" on "yyyy-MM-dd".
    static func instant(date: String, time: String, calendar: Calendar = .current) -> Date? {
        guard let day = day(date) else { return nil }
        let parts = time.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return nil }
        return calendar.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: day)
    }

    /// "08:00" as the person's locale shows times ("8:00", "8:00 a. m.").
    static func display(_ time: String) -> String {
        instant(date: date(.now), time: time)?.formatted(date: .omitted, time: .shortened) ?? time
    }

    /// 1 = lunes … 7 = domingo.
    static func isoWeekday(_ d: Date, calendar: Calendar = .current) -> Int {
        let weekday = calendar.component(.weekday, from: d) // 1 = domingo
        return weekday == 1 ? 7 : weekday - 1
    }
}
