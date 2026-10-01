import Foundation

// Mirrors of `@pulso/contract` training types. Weights kg, times epoch ms.

struct ProgramExercise: Codable, Identifiable, Hashable {
    var id: String
    var exerciseId: String
    var exerciseName: String
    var equipment: String
    var sets: Int
    var repMin: Int
    var repMax: Int
    var targetRpe: Double?
    var targetRir: Int?
    var restSeconds: Int
    var notes: String?
    /// "compound", "isolation" or "cardio". Optional so an older engine still decodes.
    var kind: String? = nil
    var modality: String? = nil
    var cardio: CardioTarget? = nil

    var isCardio: Bool { kind == "cardio" }

    /// "3 × 6–8 · RIR 2", or the cardio target ("20 min · Z2").
    var prescription: String {
        if isCardio { return cardio?.summary ?? "Cardio" }
        var text = "\(sets) × " + (repMin == repMax ? "\(repMin)" : "\(repMin)–\(repMax)")
        if let targetRir { text += " · RIR \(targetRir)" } else if let targetRpe { text += " · RPE \(targetRpe.formatted())" }
        return text
    }

    /// Stepper jump: dumbbells, bodyweight and bands move by 1 kg, plates and stacks by 2.5.
    var weightStep: Double { Equipment.weightStep(equipment) }

    /// The same prescription as an edit input, keeping this exercise's id.
    var input: DayExerciseInput {
        DayExerciseInput(id: id, exerciseId: exerciseId, sets: sets, repMin: repMin, repMax: repMax, targetRpe: targetRpe, targetRir: targetRir, restSeconds: restSeconds, notes: notes, cardio: cardio)
    }
}

struct ProgramDay: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var focus: String?
    var weekday: Int?
    var exercises: [ProgramExercise]
    /// True when `exercises` are today's one-off changes ("solo hoy").
    var overridden: Bool? = nil
}

// MARK: - Cardio

struct CardioIntervals: Codable, Hashable {
    var rounds: Int
    var workSeconds: Int
    var restSeconds: Int
    var workLabel: String? = nil
    var restLabel: String? = nil

    /// "8 × 30 s / 90 s"
    var summary: String { "\(rounds) × \(workSeconds) s / \(restSeconds) s" }
}

/// What a cardio block asks for; every field optional. `zone` is 1–5.
struct CardioTarget: Codable, Hashable {
    var durationMinutes: Double? = nil
    var distanceKm: Double? = nil
    var speedKmh: Double? = nil
    var paceMinPerKm: Double? = nil
    var inclinePercent: Double? = nil
    var level: Double? = nil
    var zone: Int? = nil
    var intervals: CardioIntervals? = nil

    /// "20 min · Z2", "8 × 30 s / 90 s · Z4", "5 km".
    var summary: String {
        var parts: [String] = []
        if let intervals { parts.append(intervals.summary) } else if let durationMinutes { parts.append("\(durationMinutes.formatted()) min") }
        if let distanceKm { parts.append("\(distanceKm.formatted()) km") }
        if let zone { parts.append("Z\(zone)") }
        return parts.isEmpty ? "Cardio" : parts.joined(separator: " · ")
    }
}

/// What was done in a cardio block. Times epoch ms.
struct CardioLog: Codable, Hashable {
    var exerciseId: String
    var durationSeconds: Double
    var distanceKm: Double? = nil
    var level: Double? = nil
    var inclinePercent: Double? = nil
    var avgHr: Double? = nil
    var kcal: Double? = nil
    var doneAt: Double
}

struct HrZoneRange: Codable, Hashable {
    var zone: Int
    var minBpm: Int
    var maxBpm: Int
}

// MARK: - Library, alternatives, preferences

/// Library equipment ids ↔ Spanish labels and symbols. Order = filter chips' order.
enum Equipment {
    static let all = ["machine", "cable", "dumbbell", "barbell", "bodyweight", "band", "kettlebell"]

    static func label(_ id: String) -> String {
        switch id {
        case "machine": "Máquina"
        case "cable": "Polea"
        case "dumbbell": "Mancuernas"
        case "barbell": "Barra"
        case "bodyweight": "Peso corporal"
        case "band": "Bandas"
        case "kettlebell": "Kettlebell"
        default: id.capitalized
        }
    }

    static func symbol(_ id: String) -> String {
        switch id {
        case "machine", "cable": "gearshape.2"
        case "bodyweight": "figure.strengthtraining.functional"
        case "band": "lasso"
        case "kettlebell": "dumbbell.fill"
        default: "dumbbell"
        }
    }

    static func weightStep(_ id: String) -> Double { ["dumbbell", "bodyweight", "band"].contains(id) ? 1 : 2.5 }
}

/// A library row (`GET /api/mobile/training/exercises`).
struct LibraryExercise: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var muscle: String
    var secondary: [String]
    var equipment: String
    var kind: String
    var modality: String? = nil
    var thumbnail: String? = nil
    var animation: String? = nil

    var isCardio: Bool { kind == "cardio" }
}

/// An alternative to an exercise, best first. `score` 0–100.
struct SimilarExercise: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var muscle: String
    var secondary: [String]
    var equipment: String
    var kind: String
    var modality: String? = nil
    var thumbnail: String? = nil
    var animation: String? = nil
    var score: Double
    var reasons: [String]
    var preferred: Bool

    var library: LibraryExercise {
        LibraryExercise(id: id, name: name, muscle: muscle, secondary: secondary, equipment: equipment, kind: kind, modality: modality, thumbnail: thumbnail, animation: animation)
    }
}

struct TrainingSettings: Codable, Hashable {
    /// Most preferred first, e.g. ["machine", "cable"].
    var preferredEquipment: [String]
}

/// "today" (solo hoy) or "always" (para siempre).
enum EditScope: String, Codable, CaseIterable {
    case today
    case always

    var label: String { self == .today ? "Solo hoy" : "Para siempre" }
}

/// One exercise of a day being rewritten; `id` keeps an existing program exercise.
struct DayExerciseInput: Codable, Hashable {
    var id: String?
    var exerciseId: String
    var sets: Int?
    var repMin: Int?
    var repMax: Int?
    var targetRpe: Double?
    var targetRir: Int?
    var restSeconds: Int?
    var notes: String?
    var cardio: CardioTarget?
}

struct DayEdit: Codable {
    var scope: EditScope
    var exercises: [DayExerciseInput]
}

struct TrainingProgram: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var goal: String
    var weeks: Int
    var notes: String?
    var active: Bool
    var createdAt: Double
    var days: [ProgramDay]
}

struct LoadSuggestion: Codable, Hashable {
    var exerciseId: String
    var weightKg: Double?
    var reps: Int
    var reason: String
    var lastSessionAt: Double?
}

struct ActiveProgramResponse: Codable {
    var program: TrainingProgram?
    var nextDayId: String?
    /// Keyed by `ProgramExercise.id`.
    var suggestions: [String: LoadSuggestion]
    /// Nil when the engine knows neither age nor max heart rate.
    var hrZones: [HrZoneRange]? = nil
    var settings: TrainingSettings? = nil
}

struct SetLog: Codable, Hashable {
    var exerciseId: String
    var setIndex: Int
    var weightKg: Double
    var reps: Int
    var rpe: Double?
    var doneAt: Double
}

struct TrainingSession: Codable, Identifiable, Hashable {
    var id: String
    var programId: String?
    var dayId: String?
    var name: String
    var startedAt: Double
    var endedAt: Double
    var notes: String?
    var sets: [SetLog]
    var cardio: [CardioLog]? = nil
    var cardioMinutes: Double? = nil

    var start: Date { Date(timeIntervalSince1970: startedAt / 1000) }
    var duration: TimeInterval { (endedAt - startedAt) / 1000 }
    var volumeKg: Double { sets.reduce(0) { $0 + $1.weightKg * Double($1.reps) } }
}

struct TrainingRecord: Codable, Hashable {
    var exerciseId: String
    var exerciseName: String
    /// "e1rm", "weight" or "reps".
    var kind: String
    var value: Double
    var previous: Double?

    var label: String {
        switch kind {
        case "e1rm": "1RM estimado"
        case "weight": "Peso máximo"
        default: "Más repeticiones"
        }
    }

    var valueText: String { kind == "reps" ? "\(Int(value)) reps" : "\(value.formatted()) kg" }
}

struct TrainingSessionSaved: Codable {
    var session: TrainingSession
    var prs: [TrainingRecord]
}

extension PulsoAPI {
    private struct SessionsResponse: Decodable { var sessions: [TrainingSession] }

    func trainingProgram() async throws -> ActiveProgramResponse {
        try await call("api/mobile/training/program", method: "GET")
    }

    func trainingSessions() async throws -> [TrainingSession] {
        let response: SessionsResponse = try await call("api/mobile/training/sessions", method: "GET")
        return response.sessions
    }

    /// Upserts by the session's client-made id, so retrying after a failure is safe.
    func saveTrainingSession(_ session: TrainingSession) async throws -> TrainingSessionSaved {
        try await call("api/mobile/training/sessions", method: "POST", body: session)
    }

    // MARK: Editing and alternatives

    private struct ExercisesResponse<Item: Decodable>: Decodable { var exercises: [Item] }

    /// Rewrites a day's exercise list, today only or in the program. Returns the program as the tab shows it.
    func saveProgramDay(_ dayId: String, edit: DayEdit) async throws -> ActiveProgramResponse {
        try await call("api/mobile/training/program/days/\(dayId)", method: "PUT", body: edit)
    }

    /// Drops today's one-off changes to a day.
    func resetProgramDay(_ dayId: String) async throws -> ActiveProgramResponse {
        try await call("api/mobile/training/program/days/\(dayId)", method: "DELETE")
    }

    func libraryExercises() async throws -> [LibraryExercise] {
        let response: ExercisesResponse<LibraryExercise> = try await call("api/mobile/training/exercises", method: "GET")
        return response.exercises
    }

    /// Alternatives ranked by similarity and the person's equipment preference; `equipment` filters.
    func similarExercises(_ id: String, equipment: [String] = [], limit: Int = 20) async throws -> [SimilarExercise] {
        var request = makeRequest("api/mobile/training/exercises/\(id)/similar", method: "GET")
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if !equipment.isEmpty { query.append(URLQueryItem(name: "equipment", value: equipment.joined(separator: ","))) }
        request.url = request.url?.appending(queryItems: query)
        let response: ExercisesResponse<SimilarExercise> = try await perform(request)
        return response.exercises
    }

    func trainingSettings() async throws -> TrainingSettings {
        try await call("api/mobile/training/settings", method: "GET")
    }

    func saveTrainingSettings(_ settings: TrainingSettings) async throws -> TrainingSettings {
        try await call("api/mobile/training/settings", method: "PUT", body: settings)
    }
}
