import AppIntents
import SwiftUI

/// "Registrar comida": free text to the Coach, who logs it with its nutrition
/// tools. Waits a while for the confirmation; the engine finishes the turn even
/// if Siri stops listening, so a slow answer still gets logged.
struct LogMealIntent: AppIntent {
    static let title: LocalizedStringResource = "Registrar comida"
    static let description = IntentDescription("Contale al Coach qué comiste y lo anota en tu diario con sus macros.")
    static let waitForReply: Duration = .seconds(25)

    @Parameter(title: "Comida", inputOptions: String.IntentInputOptions(multiline: false), requestValueDialog: "¿Qué comiste?")
    var text: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let meal = try MealText.normalized(text)
        let api = try PulsoAPI.forIntent()
        do {
            let reply = await CoachReply.collect(api.sendConversationMessage(text: MealText.prompt(meal, at: .now)), timeout: Self.waitForReply)
            await WidgetSync.refresh()
            return .result(dialog: "\(reply ?? "Se lo pasé al Coach; en unos segundos lo ves en Dieta.")")
        } catch {
            throw IntentFailure.from(error)
        }
    }
}

enum CoachReply {
    /// The Coach's text once the turn is done, or nil if it takes longer than `timeout` or fails.
    static func collect(_ events: AsyncThrowingStream<AgentStreamEvent, Error>, timeout: Duration) async -> String? {
        await withTaskGroup(of: String?.self) { group in
            group.addTask {
                var text = ""
                do {
                    for try await event in events {
                        switch event {
                        case .text(let delta): text += delta
                        case .done: return text.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
                        case .error: return nil
                        default: break
                        }
                    }
                } catch {}
                return nil
            }
            group.addTask {
                try? await Task.sleep(for: timeout)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

/// "Registrar peso": one weight reading to the engine (the Cuerpo tab's trend and projections).
struct LogWeightIntent: AppIntent {
    static let title: LocalizedStringResource = "Registrar peso"
    static let description = IntentDescription("Anota tu peso de hoy en Pulso.")

    @Parameter(title: "Peso", defaultUnit: .kilograms, supportsNegativeNumbers: false, requestValueDialog: "¿Cuánto pesás?")
    var weight: Measurement<UnitMass>

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let kg = try WeightInput.kilograms(weight)
        let api = try PulsoAPI.forIntent()
        do {
            _ = try await api.syncBodySamples([WeightInput.sample(kg: kg, at: .now)])
        } catch {
            throw IntentFailure.from(error)
        }
        return .result(dialog: "Anotado: \(WeightInput.text(kg)) kg.")
    }
}

/// "¿Cómo está mi recuperación?": today's readiness, said and shown as a ring.
struct ReadinessIntent: AppIntent {
    static let title: LocalizedStringResource = "¿Cómo está mi recuperación?"
    static let description = IntentDescription("Te dice tu recuperación de hoy y por qué.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
        let api = try PulsoAPI.forIntent()
        let readiness: Readiness
        do {
            readiness = try await api.daily().readiness
        } catch {
            throw IntentFailure.from(error)
        }
        return .result(dialog: "\(ReadinessPhrase.text(readiness))", view: ReadinessSnippet(readiness: readiness))
    }
}

enum ReadinessPhrase {
    static func text(_ r: Readiness, at date: Date = .now) -> String {
        guard let score = r.score else {
            return "Todavía no tengo datos suficientes para calcular tu recuperación. \(r.explanation)"
        }
        return "Tu recuperación está en \(score) de 100: \(r.title(at: date).lowercased()). \(r.explanation(at: date))"
    }
}

struct ReadinessSnippet: View {
    let readiness: Readiness

    var body: some View {
        HStack(spacing: 16) {
            Ring(progress: Double(readiness.score ?? 0) / 100, color: readiness.color, lineWidth: 10) {
                Text(readiness.score.map(String.init) ?? "–")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
            }
            .frame(width: 84, height: 84)
            VStack(alignment: .leading, spacing: 4) {
                Label {
                    Text(readiness.title(at: .now)).lineLimit(2)
                } icon: {
                    if readiness.score != nil { Image(systemName: readiness.symbol).foregroundStyle(readiness.color) }
                }
                .font(.headline)
                Text(readiness.explanation(at: .now)).font(.caption).foregroundStyle(.secondary).lineLimit(3)
            }
        }
        .padding()
    }
}

/// "Empezar entreno": opens Pulso and starts the next day of the active program
/// (the Live Activity starts with it; the session waits in Entreno).
struct StartWorkoutIntent: AppIntent {
    static let title: LocalizedStringResource = "Empezar entreno"
    static let description = IntentDescription("Abre Pulso y arranca el siguiente día de tu programa.")
    static let supportedModes: IntentModes = .foreground(.immediate)

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let store = TrainingStore.shared
        if let live = store.live {
            return .result(dialog: "Ya tenés en curso \(live.state.name).")
        }
        _ = try PulsoAPI.forIntent()
        if store.program == nil { await store.load() }
        guard let day = store.nextDay else {
            if store.activeBlock?.weekComplete == true {
                throw IntentFailure(message: "Ya hiciste todos los días de esta semana.")
            }
            throw IntentFailure(message: "No tenés un programa activo. Pedile uno al Coach.")
        }
        store.start(day)
        return .result(dialog: "Arrancamos \(day.name). ¡Vamos!")
    }
}

struct PulsoShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: LogMealIntent(),
            phrases: ["Registrar comida en \(.applicationName)", "Anotar comida en \(.applicationName)", "Registrar lo que comí en \(.applicationName)"],
            shortTitle: "Registrar comida",
            systemImageName: "fork.knife"
        )
        AppShortcut(
            intent: LogWeightIntent(),
            phrases: ["Registrar peso en \(.applicationName)", "Anotar mi peso en \(.applicationName)"],
            shortTitle: "Registrar peso",
            systemImageName: "scalemass"
        )
        AppShortcut(
            intent: TakeNextDoseIntent(),
            phrases: ["Tomé mi medicación en \(.applicationName)", "Ya tomé la medicación en \(.applicationName)", "Marcar medicación tomada en \(.applicationName)"],
            shortTitle: "Tomé mi medicación",
            systemImageName: "pills.fill"
        )
        AppShortcut(
            intent: ReadinessIntent(),
            phrases: ["¿Cómo está mi recuperación en \(.applicationName)?", "Mi recuperación en \(.applicationName)", "¿Cómo me recuperé según \(.applicationName)?"],
            shortTitle: "Recuperación",
            systemImageName: "heart.fill"
        )
        AppShortcut(
            intent: StartWorkoutIntent(),
            phrases: ["Empezar entreno en \(.applicationName)", "Empezar a entrenar con \(.applicationName)"],
            shortTitle: "Empezar entreno",
            systemImageName: "dumbbell.fill"
        )
    }

    static let shortcutTileColor: ShortcutTileColor = .orange
}
