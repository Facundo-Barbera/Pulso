import AppIntents
import Foundation

/// "Tomé mi medicación": marks the next pending dose of today as taken. Compiled
/// into the app (Siri, Shortcuts, Action button) and PulsoWidgets (Control
/// Center), so it talks to the engine through `WidgetEngine`.
struct TakeNextDoseIntent: AppIntent {
    static let title: LocalizedStringResource = "Tomé mi medicación"
    static let description = IntentDescription("Marca como tomada la próxima dosis pendiente de hoy.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let engine = try WidgetEngine.current()
        let now = Date.now
        guard let dose = try await engine.medicationDay(now).doses.next else {
            return .result(dialog: "No tenés dosis pendientes por ahora.")
        }
        try await engine.takeDose(dose, at: now)
        await DoseRefresh.afterLogging(engine, now: now)
        return .result(dialog: "\(DosePhrase.taken(dose))")
    }
}

/// The widget's "Tomada" button: one specific dose, the one the widget is showing,
/// so a stale widget never marks a different dose than the one on screen.
struct TakeDoseIntent: AppIntent {
    static let title: LocalizedStringResource = "Marcar dosis como tomada"
    static let isDiscoverable = false

    @Parameter(title: "Medicamento") var medicationId: String
    @Parameter(title: "Nombre") var name: String
    @Parameter(title: "Dosis") var doseText: String
    @Parameter(title: "Fecha") var date: String
    @Parameter(title: "Hora") var time: String

    init() {}

    init(_ dose: WidgetSnapshot.Dose) {
        medicationId = dose.medicationId
        name = dose.name
        doseText = dose.doseText
        date = dose.date
        time = dose.time
    }

    /// The dose these parameters name, or nil when the widget handed over something unusable.
    var dose: WidgetSnapshot.Dose? {
        guard !medicationId.isEmpty, let due = WidgetClock.instant(date: date, time: time) else { return nil }
        return WidgetSnapshot.Dose(medicationId: medicationId, name: name, doseText: doseText, date: date, time: time, due: due)
    }

    func perform() async throws -> some IntentResult {
        guard let dose else { return .result() }
        let engine = try WidgetEngine.current()
        try await engine.takeDose(dose)
        await DoseRefresh.afterLogging(engine, now: .now)
        return .result()
    }
}

enum DosePhrase {
    static func taken(_ dose: WidgetSnapshot.Dose) -> String { "Listo, anoté \(dose.name) (\(dose.doseText)) como tomada." }
}

enum DoseRefresh {
    /// The next dose changed: refresh the snapshot so every widget shows it.
    static func afterLogging(_ engine: WidgetEngine, now: Date) async {
        _ = try? await engine.refreshSnapshot(now: now)
        WidgetEngine.reloadWidgets()
    }
}
