import SwiftUI

/// `@pulso/contract` calendar types. Dates are local "yyyy-MM-dd", times "HH:mm",
/// datetimes "yyyy-MM-ddTHH:mm" (the person's own clock).

struct CalendarLink: Codable, Equatable, Hashable {
    var tab: String
    var id: String?
}

struct CalendarItem: Codable, Identifiable, Equatable, Hashable {
    enum Kind: String, Codable {
        case training, workout, meal, meal_time, dose, sleep, busy, health, body_scan
    }

    var id: String
    var kind: Kind
    var title: String
    var subtitle: String?
    var date: String
    var start: String?
    var end: String?
    var allDay: Bool
    var color: String
    var status: String?
    var link: CalendarLink

    var tint: Color { CalendarStyle.tint(color) }

    var symbol: String {
        switch kind {
        case .training: status == "done" ? "dumbbell.fill" : "dumbbell"
        case .workout: "figure.run"
        case .meal: "fork.knife"
        case .meal_time: "fork.knife.circle"
        case .dose: status == "tomada" ? "pills.fill" : "pills"
        case .sleep: "bed.double.fill"
        case .busy: status == "apple_calendar" ? "calendar" : "briefcase.fill"
        case .health: "cross.case.fill"
        case .body_scan: "figure"
        }
    }

    /// Spanish label for planned-training states.
    var statusLabel: String? {
        guard kind == .training, let status else { return nil }
        return switch status {
        case "planned": "Planificada"
        case "moved": "Movida"
        case "done": "Hecha"
        case "skipped": "Saltada"
        case "missed": "No hecha"
        default: nil
        }
    }

    /// Something to fix: the Coach could not move it out of a clash.
    var hasConflict: Bool { subtitle?.hasPrefix("Conflicto") == true }
}

struct CalendarRange: Codable, Equatable {
    var from: String
    var to: String
    var items: [CalendarItem]
}

struct BusyBlock: Codable, Identifiable, Equatable {
    var id: String
    var title: String
    var allDay: Bool
    var date: String
    var endDate: String?
    var start: String?
    var end: String?
    var weekdays: [Int]
    var until: String?
    var source: String
    var notes: String?
}

/// What the busy editor sends. Every field is encoded (nil as null) so clearing one clears it on the Mac.
struct BusyBlockDraft: Encodable, Equatable {
    var title = ""
    var allDay = false
    var date = LocalClock.date(.now)
    var endDate: String?
    var start: String? = "09:00"
    var end: String? = "10:00"
    var weekdays: [Int] = []
    var until: String?
    var notes: String?

    init() {}

    init(_ block: BusyBlock) {
        title = block.title
        allDay = block.allDay
        date = block.date
        endDate = block.endDate
        start = block.start ?? "09:00"
        end = block.end ?? "10:00"
        weekdays = block.weekdays
        until = block.until
        notes = block.notes
    }

    enum CodingKeys: CodingKey { case title, allDay, date, endDate, start, end, weekdays, until, notes }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(title.trimmingCharacters(in: .whitespaces), forKey: .title)
        try c.encode(allDay, forKey: .allDay)
        try c.encode(date, forKey: .date)
        try c.encode(allDay && weekdays.isEmpty ? endDate : nil, forKey: .endDate)
        try c.encode(allDay ? nil : start, forKey: .start)
        try c.encode(allDay ? nil : end, forKey: .end)
        try c.encode(weekdays, forKey: .weekdays)
        try c.encode(weekdays.isEmpty ? nil : until, forKey: .until)
        try c.encode(notes, forKey: .notes)
    }
}

enum HealthEventKind: String, Codable, CaseIterable, Identifiable {
    case lesion, enfermedad, sintoma, cirugia, otro
    var id: String { rawValue }

    var label: String {
        switch self {
        case .lesion: "Lesión"
        case .enfermedad: "Enfermedad"
        case .sintoma: "Síntoma"
        case .cirugia: "Cirugía"
        case .otro: "Otro"
        }
    }

    var symbol: String {
        switch self {
        case .lesion: "bandage.fill"
        case .enfermedad: "thermometer.medium"
        case .sintoma: "waveform.path.ecg"
        case .cirugia: "cross.case.fill"
        case .otro: "heart.text.square.fill"
        }
    }
}

enum HealthEventStatus: String, Codable, CaseIterable, Identifiable {
    case activa, recuperandose, resuelta
    var id: String { rawValue }

    var label: String {
        switch self {
        case .activa: "Activa"
        case .recuperandose: "Recuperándome"
        case .resuelta: "Resuelta"
        }
    }

    /// State colours (never green against red); rows always print `label` beside them.
    var tint: Color {
        switch self {
        case .activa: Theme.caution
        case .recuperandose: Theme.fair
        case .resuelta: Theme.good
        }
    }
}

/// Body areas the engine knows: joints, the body map's muscles, or the whole body.
enum BodyArea {
    static let joints: [(String, String)] = [
        ("knee", "Rodilla"), ("shoulder", "Hombro"), ("lower_back", "Espalda baja"), ("ankle", "Tobillo"),
        ("wrist", "Muñeca"), ("elbow", "Codo"), ("hip", "Cadera"), ("neck", "Cuello"),
    ]
    static let muscles: [(String, String)] = [
        ("chest", "Pecho"), ("front_delts", "Deltoides anterior"), ("side_delts", "Deltoides lateral"), ("rear_delts", "Deltoides posterior"),
        ("traps", "Trapecio"), ("upper_back", "Espalda alta"), ("lats", "Dorsales"), ("biceps", "Bíceps"), ("triceps", "Tríceps"),
        ("forearms", "Antebrazos"), ("abs", "Abdomen"), ("obliques", "Oblicuos"), ("glutes", "Glúteos"), ("quads", "Cuádriceps"),
        ("hamstrings", "Isquiotibiales"), ("adductors", "Aductores"), ("abductors", "Abductores"), ("calves", "Gemelos"),
    ]

    static func name(_ id: String?) -> String? {
        guard let id else { return nil }
        if id == "general" { return "Todo el cuerpo" }
        return (joints + muscles).first { $0.0 == id }?.1
    }
}

struct HealthEvent: Codable, Identifiable, Equatable {
    var id: String
    var kind: HealthEventKind
    var title: String
    var bodyArea: String?
    var severity: Int
    var startDate: String
    var endDate: String?
    var status: HealthEventStatus
    var notes: String?
    var affectedTraining: String?

    var isActive: Bool { status != .resuelta }

    /// "desde el 28 sept" or "28 sept – 3 oct".
    var period: String {
        let start = CalendarMath.shortDate(startDate)
        guard let endDate else { return "desde el \(start)" }
        return endDate == startDate ? start : "\(start) – \(CalendarMath.shortDate(endDate))"
    }
}

struct HealthEventDraft: Encodable, Equatable {
    var kind = HealthEventKind.lesion
    var title = ""
    var bodyArea: String?
    var severity = 2
    var startDate = LocalClock.date(.now)
    var endDate: String?
    var status = HealthEventStatus.activa
    var notes: String?
    var affectedTraining: String?

    init() {}

    init(_ event: HealthEvent) {
        kind = event.kind
        title = event.title
        bodyArea = event.bodyArea
        severity = event.severity
        startDate = event.startDate
        endDate = event.endDate
        status = event.status
        notes = event.notes
        affectedTraining = event.affectedTraining
    }

    enum CodingKeys: CodingKey { case kind, title, bodyArea, severity, startDate, endDate, status, notes, affectedTraining }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(kind, forKey: .kind)
        try c.encode(title.trimmingCharacters(in: .whitespaces), forKey: .title)
        try c.encode(bodyArea, forKey: .bodyArea)
        try c.encode(severity, forKey: .severity)
        try c.encode(startDate, forKey: .startDate)
        try c.encode(endDate, forKey: .endDate)
        try c.encode(status, forKey: .status)
        try c.encode(notes, forKey: .notes)
        try c.encode(affectedTraining, forKey: .affectedTraining)
    }
}

/// What happened to planned training after a busy block or health event changed.
struct Replan: Codable, Equatable {
    struct Move: Codable, Equatable { var id: String; var name: String; var from: String; var to: String; var time: String }
    struct Unresolved: Codable, Equatable { var id: String; var name: String; var date: String; var conflict: String }
    var moved: [Move]
    var unresolved: [Unresolved]

    var isEmpty: Bool { moved.isEmpty && unresolved.isEmpty }
}

/// Domain colors per timeline colour key.
enum CalendarStyle {
    static func tint(_ key: String) -> Color {
        switch key {
        case "training": Theme.training
        case "workout": Theme.energy
        case "nutrition": Theme.carbs
        case "medication": .accentColor
        case "sleep": Theme.fat
        case "health": Theme.protein
        case "body": Theme.body
        default: .secondary
        }
    }

    /// Order the week strip draws its dots in.
    static let dotOrder = ["training", "workout", "health", "busy", "medication", "nutrition", "sleep", "body"]
}

// MARK: - Date math

/// Pure calendar arithmetic on Monday-first weeks. Takes a `Calendar` so tests pin the time zone.
enum CalendarMath {
    static func calendar(_ base: Calendar = .current) -> Calendar {
        var c = base
        c.firstWeekday = 2
        return c
    }

    /// Monday 00:00 of the week holding `date`.
    static func weekStart(_ date: Date, calendar base: Calendar = .current) -> Date {
        let cal = calendar(base)
        let day = cal.startOfDay(for: date)
        let offset = (cal.component(.weekday, from: day) + 5) % 7 // Monday → 0 … Sunday → 6
        return cal.date(byAdding: .day, value: -offset, to: day)!
    }

    static func days(from start: Date, count: Int, calendar: Calendar = .current) -> [Date] {
        (0..<count).map { calendar.date(byAdding: .day, value: $0, to: start)! }
    }

    static func week(of date: Date, calendar: Calendar = .current) -> [Date] {
        days(from: weekStart(date, calendar: calendar), count: 7, calendar: calendar)
    }

    /// The month's grid: whole Monday-first weeks covering the first to the last day (4–6 rows).
    static func monthGrid(_ month: Date, calendar: Calendar = .current) -> [Date] {
        let first = calendar.date(from: calendar.dateComponents([.year, .month], from: month))!
        let last = calendar.date(byAdding: DateComponents(month: 1, day: -1), to: first)!
        let start = weekStart(first, calendar: calendar)
        let end = calendar.date(byAdding: .day, value: 6, to: weekStart(last, calendar: calendar))!
        let count = (calendar.dateComponents([.day], from: start, to: end).day ?? 0) + 1
        return days(from: start, count: count, calendar: calendar)
    }

    /// Whole weeks between the weeks of `a` and `b` (positive when `b` is later).
    static func weeksBetween(_ a: Date, _ b: Date, calendar: Calendar = .current) -> Int {
        let days = calendar.dateComponents([.day], from: weekStart(a, calendar: calendar), to: weekStart(b, calendar: calendar)).day ?? 0
        return Int((Double(days) / 7).rounded())
    }

    private static let dateTimeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return f
    }()

    /// "yyyy-MM-ddTHH:mm" in `calendar`'s time zone.
    static func parse(_ value: String, calendar: Calendar = .current) -> Date? {
        dateTimeFormatter.timeZone = calendar.timeZone
        return dateTimeFormatter.date(from: value)
    }

    /// Minutes after midnight of `day` ("yyyy-MM-dd") for a datetime; earlier days clamp to 0, later to 1440.
    static func minute(_ value: String, on day: String) -> Int {
        let date = String(value.prefix(10))
        if date < day { return 0 }
        if date > day { return 24 * 60 }
        let time = value.dropFirst(11)
        let parts = time.split(separator: ":").compactMap { Int($0) }
        return parts.count == 2 ? parts[0] * 60 + parts[1] : 0
    }

    /// Where a timed item sits on `day`, in minutes: point items (no end) get `pointMinutes`.
    static func span(of item: CalendarItem, on day: String, pointMinutes: Int = 30) -> (start: Int, end: Int)? {
        guard !item.allDay, let start = item.start else { return nil }
        let s = minute(start, on: day)
        let e = item.end.map { minute($0, on: day) } ?? s + pointMinutes
        return (s, max(e, s + 15))
    }

    /// Side-by-side columns for overlapping spans: each span's column and how many columns its cluster uses.
    static func columns(_ spans: [(start: Int, end: Int)]) -> [(column: Int, of: Int)] {
        let order = spans.indices.sorted { (spans[$0].start, spans[$0].end) < (spans[$1].start, spans[$1].end) }
        var result = Array(repeating: (column: 0, of: 1), count: spans.count)
        var cluster: [Int] = []
        var columnEnds: [Int] = []
        var clusterEnd = Int.min
        func close() {
            for i in cluster { result[i].of = columnEnds.count }
            cluster = []
            columnEnds = []
        }
        for i in order {
            let span = spans[i]
            if span.start >= clusterEnd { close() }
            if let free = columnEnds.firstIndex(where: { $0 <= span.start }) {
                columnEnds[free] = span.end
                result[i].column = free
            } else {
                columnEnds.append(span.end)
                result[i].column = columnEnds.count - 1
            }
            cluster.append(i)
            clusterEnd = max(clusterEnd == Int.min ? span.end : clusterEnd, span.end)
        }
        close()
        return result
    }

    /// "28 sept" in the person's locale.
    static func shortDate(_ day: String) -> String {
        LocalClock.day(day)?.formatted(.dateTime.day().month(.abbreviated)) ?? day
    }
}
