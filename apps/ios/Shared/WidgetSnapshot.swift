import Foundation

/// What the widgets show, written to the App Group by whoever last talked to
/// the engine (the app after a sync, or the widget extension itself). Compiled
/// into the app and PulsoWidgets.
struct WidgetSnapshot: Codable, Equatable {
    struct Recovery: Codable, Equatable {
        var score: Int?
        /// high | medium | low | unknown
        var level: String
        var explanation: String
    }

    /// kcal and grams eaten on `date`, against the targets if any.
    struct Macros: Codable, Equatable {
        var kcal: Double
        var kcalTarget: Double?
        var protein: Double
        var proteinTarget: Double?

        var kcalLeft: Double? { kcalTarget.map { max($0 - kcal, 0) } }
        var proteinLeft: Double? { proteinTarget.map { max($0 - protein, 0) } }
        var kcalProgress: Double { progress(kcal, kcalTarget) }
        var proteinProgress: Double { progress(protein, proteinTarget) }

        private func progress(_ value: Double, _ target: Double?) -> Double {
            guard let target, target > 0 else { return 0 }
            return min(value / target, 1)
        }
    }

    /// The next pending scheduled dose. `date`/`time` are the engine's local "yyyy-MM-dd"/"HH:mm".
    struct Dose: Codable, Equatable, Hashable {
        var medicationId: String
        var name: String
        var doseText: String
        var date: String
        var time: String
        var due: Date
    }

    struct Workout: Codable, Equatable {
        var programName: String
        var dayName: String
        var focus: String?
        var exercises: Int
    }

    var updatedAt: Date
    /// The local day the snapshot describes, so yesterday's macros never read as today's.
    var date: String
    var recovery: Recovery?
    var macros: Macros?
    var nextDose: Dose?
    /// Scheduled doses still pending today, `nextDose` included.
    var dosesLeft: Int
    var workout: Workout?

    /// Today's macros; on a day the snapshot has not caught up with, nothing eaten yet.
    func macros(on day: String) -> Macros? {
        guard let macros else { return nil }
        return day == date ? macros : Macros(kcal: 0, kcalTarget: macros.kcalTarget, protein: 0, proteinTarget: macros.proteinTarget)
    }

    /// What one refresh managed to fetch; nil = that request failed. `workout` is
    /// `.some(nil)` when the engine answered that there is no active program.
    struct Update {
        var recovery: Recovery?
        var macros: Macros?
        var doses: (next: Dose?, left: Int)?
        var workout: Workout??

        var isEmpty: Bool { recovery == nil && macros == nil && doses == nil && workout == nil }
    }

    /// Applies a refresh over the last snapshot: a section whose request failed keeps
    /// its old value, except the day-bound ones (macros, doses) once the day changed.
    static func applying(_ update: Update, to old: WidgetSnapshot?, now: Date) -> WidgetSnapshot {
        let today = WidgetClock.date(now)
        let sameDay = old?.date == today
        return WidgetSnapshot(
            updatedAt: now,
            date: today,
            recovery: update.recovery ?? old?.recovery,
            macros: update.macros ?? (sameDay ? old?.macros : nil),
            nextDose: update.doses.map(\.next) ?? (sameDay ? old?.nextDose : nil),
            dosesLeft: update.doses?.left ?? (sameDay ? old?.dosesLeft ?? 0 : 0),
            workout: update.workout ?? old?.workout
        )
    }
}

extension WidgetSnapshot.Recovery {
    var levelLabel: String {
        switch level {
        case "high": "Alta"
        case "medium": "Normal"
        case "low": "Baja"
        default: "Sin datos"
        }
    }
}

/// Widget kinds, shared so the app can reload exactly these.
enum WidgetKind {
    static let recovery = "PulsoRecovery"
    static let macros = "PulsoMacros"
    static let nextDose = "PulsoNextDose"
    static let nextWorkout = "PulsoNextWorkout"
    static let takeDoseControl = "PulsoTakeDoseControl"
}

/// The App Group (`group.<app bundle id>`, from the `PulsoAppGroup` Info key so
/// Dev and Release never share data) and the snapshot file inside it.
enum SnapshotStore {
    static var appGroup: String? { Bundle.main.object(forInfoDictionaryKey: "PulsoAppGroup") as? String }

    static var defaultURL: URL? {
        guard let appGroup, let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return nil }
        return dir.appendingPathComponent("widget-snapshot.json")
    }

    static func encode(_ snapshot: WidgetSnapshot) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        return try encoder.encode(snapshot)
    }

    static func decode(_ data: Data) throws -> WidgetSnapshot {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return try decoder.decode(WidgetSnapshot.self, from: data)
    }

    static func load(from url: URL? = defaultURL) -> WidgetSnapshot? {
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        return try? decode(data)
    }

    static func save(_ snapshot: WidgetSnapshot, to url: URL? = defaultURL) {
        guard let url, let data = try? encode(snapshot) else { return }
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func clear(at url: URL? = defaultURL) {
        guard let url else { return }
        try? FileManager.default.removeItem(at: url)
    }
}

/// "yyyy-MM-dd" / "HH:mm" in the phone's calendar, as the engine speaks them.
enum WidgetClock {
    private static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = format
        return f
    }
    private static let day = formatter("yyyy-MM-dd")
    private static let clock = formatter("HH:mm")
    private static let instant = formatter("yyyy-MM-dd HH:mm")

    static func date(_ d: Date) -> String { day.string(from: d) }
    static func time(_ d: Date) -> String { clock.string(from: d) }
    static func instant(date: String, time: String) -> Date? { instant.date(from: "\(date) \(time)") }
}
