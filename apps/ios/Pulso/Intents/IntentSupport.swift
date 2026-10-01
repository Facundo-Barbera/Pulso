import AppIntents
import Foundation

/// A failure Siri reads out in Spanish.
struct IntentFailure: Error, CustomLocalizedStringResourceConvertible {
    var message: String
    var localizedStringResource: LocalizedStringResource { "\(message)" }

    static let unpaired = IntentFailure(message: "Abrí Pulso y emparejalo con tu Mac primero.")

    /// The engine's Spanish message for API failures, as is.
    static func from(_ error: Error) -> IntentFailure {
        (error as? IntentFailure) ?? IntentFailure(message: error.localizedDescription)
    }
}

extension PulsoAPI {
    /// The paired client, or the failure Siri should say.
    @MainActor static func forIntent() throws -> PulsoAPI {
        guard let api = PulsoModel.shared.api else { throw IntentFailure.unpaired }
        return api
    }
}

/// "Registrar peso": what Siri hands over, checked and in kilograms.
enum WeightInput {
    static let range = 20.0...300.0

    /// Kilograms rounded to 0.1, or a failure that says why not.
    static func kilograms(_ weight: Measurement<UnitMass>) throws -> Double {
        let kg = (weight.converted(to: .kilograms).value * 10).rounded() / 10
        guard range.contains(kg) else {
            throw IntentFailure(message: "\(text(kg)) kg no parece un peso. Probá de nuevo.")
        }
        return kg
    }

    static func text(_ kg: Double) -> String { kg.formatted(.number.precision(.fractionLength(0...1))) }

    /// A one-off reading from Siri; HealthKit samples use their own UUIDs.
    static func sample(kg: Double, at now: Date, id: UUID = UUID()) -> BodySample {
        BodySample(externalId: "pulso-intent-\(id.uuidString)", metric: "weight", value: kg, measuredAt: (now.timeIntervalSince1970 * 1000).rounded())
    }
}

/// "Registrar comida": free text goes to the Coach, who logs it with its nutrition tools.
enum MealText {
    static let maxLength = 500

    /// Trimmed text, or a failure when there is nothing (or too much) to log.
    static func normalized(_ text: String) throws -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw IntentFailure(message: "Decime qué comiste.") }
        guard trimmed.count <= maxLength else { throw IntentFailure(message: "Es mucho texto; contámelo más corto.") }
        return trimmed
    }

    static func prompt(_ text: String, at now: Date) -> String {
        let time = now.formatted(date: .omitted, time: .shortened)
        return """
        Registrá en mi diario de comidas de hoy (\(time)) lo siguiente, estimando cantidades y macros si no las digo: \(text)
        Después confirmá en una sola oración qué anotaste y las kcal totales.
        """
    }
}
