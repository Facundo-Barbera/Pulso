import Foundation

/// `@pulso/contract` medication types. Dates are local "yyyy-MM-dd", times "HH:mm".
enum DoseMeal: String, Codable, CaseIterable, Identifiable {
    case desayuno, comida, cena
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
    /// "con el desayuno"
    var phrase: String { "con \(self == .desayuno ? "el" : "la") \(rawValue)" }
    var symbol: String {
        switch self {
        case .desayuno: "cup.and.saucer.fill"
        case .comida: "fork.knife"
        case .cena: "moon.haze.fill"
        }
    }
}

/// On a training day the dose is due when the workout ends, to take within
/// `withinMinutes`; on a rest day at `restDayTime`, or not at all when nil.
struct TrainingRule: Codable, Equatable {
    var withinMinutes: Int
    var restDayTime: String?

    enum CodingKeys: CodingKey { case withinMinutes, restDayTime }

    init(withinMinutes: Int = 60, restDayTime: String? = "09:00") {
        self.withinMinutes = withinMinutes
        self.restDayTime = restDayTime
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        withinMinutes = try c.decode(Int.self, forKey: .withinMinutes)
        restDayTime = try c.decodeIfPresent(String.self, forKey: .restDayTime)
    }

    /// `restDayTime: null` means "No tomar", so it is always sent.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(withinMinutes, forKey: .withinMinutes)
        try c.encode(restDayTime, forKey: .restDayTime)
    }
}

/// Fixed clock `times` plus slots tied to a moment: after training, with a meal,
/// before bed. `days` apply to every slot. Always encoded whole.
struct MedicationSchedule: Codable, Equatable {
    var asNeeded: Bool
    var times: [String]
    /// ISO weekdays, 1 = lunes … 7 = domingo. Empty = every day.
    var days: [Int]
    var training: TrainingRule?
    var meals: [DoseMeal]
    var bedtime: Bool

    init(asNeeded: Bool, times: [String], days: [Int], training: TrainingRule? = nil, meals: [DoseMeal] = [], bedtime: Bool = false) {
        self.asNeeded = asNeeded
        self.times = times
        self.days = days
        self.training = training
        self.meals = meals
        self.bedtime = bedtime
    }

    static let asNeededOnly = MedicationSchedule(asNeeded: true, times: [], days: [])

    /// "08:00 y 20:00 · con el desayuno · después de entrenar"
    var summary: String {
        var parts: [String] = []
        if !times.isEmpty { parts.append(times.map(LocalClock.display).formatted(.list(type: .and))) }
        if !meals.isEmpty { parts.append(meals.map(\.phrase).formatted(.list(type: .and))) }
        if let training { parts.append(training.restDayTime.map { "después de entrenar (sin entreno, \(LocalClock.display($0)))" } ?? "después de entrenar") }
        if bedtime { parts.append("antes de dormir") }
        return parts.joined(separator: " · ")
    }

    /// A scheduled med needs at least one slot.
    var hasSlots: Bool { !times.isEmpty || !meals.isEmpty || bedtime || training != nil }

    enum CodingKeys: CodingKey { case asNeeded, times, days, training, meals, bedtime }

    /// An older engine sends only asNeeded/times/days.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        asNeeded = try c.decode(Bool.self, forKey: .asNeeded)
        times = try c.decode([String].self, forKey: .times)
        days = try c.decode([Int].self, forKey: .days)
        training = try c.decodeIfPresent(TrainingRule.self, forKey: .training)
        meals = try c.decodeIfPresent([DoseMeal].self, forKey: .meals) ?? []
        bedtime = try c.decodeIfPresent(Bool.self, forKey: .bedtime) ?? false
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(asNeeded, forKey: .asNeeded)
        try c.encode(times, forKey: .times)
        try c.encode(days, forKey: .days)
        try c.encode(training, forKey: .training)
        try c.encode(meals, forKey: .meals)
        try c.encode(bedtime, forKey: .bedtime)
    }
}

/// What a slot hangs on: a clock time, the end of a workout, a meal or bedtime.
enum DoseMoment: String, Codable, CaseIterable {
    case hora, entreno, desayuno, comida, cena, dormir

    /// Section heading on Hoy.
    var title: String {
        switch self {
        case .hora: "A su hora"
        case .entreno: "Después de entrenar"
        case .desayuno: "Con el desayuno"
        case .comida: "Con la comida"
        case .cena: "Con la cena"
        case .dormir: "Antes de dormir"
        }
    }

    var symbol: String {
        switch self {
        case .hora: "clock"
        case .entreno: "figure.strengthtraining.traditional"
        case .desayuno: "cup.and.saucer.fill"
        case .comida: "fork.knife"
        case .cena: "moon.haze.fill"
        case .dormir: "bed.double.fill"
        }
    }

    /// A slot key: "HH:MM" for a fixed time, else the moment's name.
    init(slotKey: String) {
        self = DoseMoment(rawValue: slotKey) ?? .hora
    }

    /// "después de entrenar" for a logged slot key, or the time it was scheduled at.
    static func label(slotKey: String) -> String {
        let moment = DoseMoment(slotKey: slotKey)
        return moment == .hora ? LocalClock.display(slotKey) : moment.title.lowercased()
    }
}

/// How a training-linked slot resolved. Times are "HH:mm".
struct TrainingSlot: Codable, Equatable {
    enum State: String, Codable { case trained, training, planned, rest }
    var state: State
    /// When the workout ended (trained).
    var workoutEnd: String?
    /// Take it before this (trained): workout end + window.
    var until: String?
    /// When the planned session starts (planned).
    var plannedAt: String?
    /// While waiting: when the rest-day rule takes over. Nil with "No tomar".
    var fallback: String?

    init(state: State, workoutEnd: String? = nil, until: String? = nil, plannedAt: String? = nil, fallback: String? = nil) {
        self.state = state
        self.workoutEnd = workoutEnd
        self.until = until
        self.plannedAt = plannedAt
        self.fallback = fallback
    }

    /// One line in Spanish: "Terminaste a las 19:05 · tómala antes de las 19:50".
    var status: String {
        let show = LocalClock.display
        switch state {
        case .trained:
            guard let end = workoutEnd else { return "Después de entrenar" }
            return until.map { "Terminaste a las \(show(end)) · tómala antes de las \(show($0))" } ?? "Terminaste a las \(show(end))"
        case .training:
            return "Entrenando…"
        case .planned:
            return plannedAt.map { "Al terminar tu sesión de las \(show($0))" } ?? "Al terminar tu sesión"
        case .rest:
            return fallback.map { "Hoy descansas · \(show($0))" } ?? "Hoy descansas"
        }
    }
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
    /// The slot's key, sent back as `DoseLog.scheduledTime`: "HH:mm" or a moment ("entreno", "desayuno"…).
    var slot: String
    var moment: DoseMoment
    /// When it's due; nil while waiting for a workout that is planned or in progress.
    var time: String?
    var training: TrainingSlot?
    var status: DoseStatus
    var eventId: String?
    var takenAt: Double?

    init(medicationId: String, name: String, kind: MedicationKind, dose: Double, unit: String, instructions: String? = nil, date: String,
         slot: String, moment: DoseMoment = .hora, time: String?, training: TrainingSlot? = nil, status: DoseStatus, eventId: String? = nil, takenAt: Double? = nil) {
        self.medicationId = medicationId
        self.name = name
        self.kind = kind
        self.dose = dose
        self.unit = unit
        self.instructions = instructions
        self.date = date
        self.slot = slot
        self.moment = moment
        self.time = time
        self.training = training
        self.status = status
        self.eventId = eventId
        self.takenAt = takenAt
    }

    enum CodingKeys: CodingKey {
        case medicationId, name, kind, dose, unit, instructions, date, slot, moment, time, training, status, eventId, takenAt
    }

    /// An older engine has no `slot`/`moment`: every slot is a fixed time, keyed by it.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        medicationId = try c.decode(String.self, forKey: .medicationId)
        name = try c.decode(String.self, forKey: .name)
        kind = try c.decode(MedicationKind.self, forKey: .kind)
        dose = try c.decode(Double.self, forKey: .dose)
        unit = try c.decode(String.self, forKey: .unit)
        instructions = try c.decodeIfPresent(String.self, forKey: .instructions)
        date = try c.decode(String.self, forKey: .date)
        time = try c.decodeIfPresent(String.self, forKey: .time)
        guard let key = try c.decodeIfPresent(String.self, forKey: .slot) ?? time else {
            throw DecodingError.keyNotFound(CodingKeys.slot, .init(codingPath: c.codingPath, debugDescription: "a slot needs a key or a time"))
        }
        slot = key
        moment = try c.decodeIfPresent(DoseMoment.self, forKey: .moment) ?? .hora
        training = try c.decodeIfPresent(TrainingSlot.self, forKey: .training)
        status = try c.decode(DoseStatus.self, forKey: .status)
        eventId = try c.decodeIfPresent(String.self, forKey: .eventId)
        takenAt = try c.decodeIfPresent(Double.self, forKey: .takenAt)
    }

    var id: String { "\(medicationId)|\(date)|\(slot)" }
    var doseText: String { "\(dose.formatted()) \(unit)" }
    var isPending: Bool { status == .pendiente || status == .pospuesta }

    /// Logs this slot with the given status.
    func log(_ status: DoseStatus, takenAt: Double? = nil) -> DoseLog {
        DoseLog(medicationId: medicationId, date: date, scheduledTime: slot, status: status, takenAt: takenAt)
    }
}

/// `GET /medication/upcoming`: the next days' slots, resolved, for reminders.
struct MedicationUpcoming: Codable, Equatable {
    var from: String
    var slots: [DoseSlot]
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
