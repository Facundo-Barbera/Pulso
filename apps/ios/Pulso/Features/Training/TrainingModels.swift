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
    /// A load set by hand for the next session, kg; nil = the engine suggests it.
    var weightKg: Double? = nil
    /// Consecutive exercises sharing it are a superset, done alternating.
    var supersetId: String? = nil

    var isCardio: Bool { kind == "cardio" }

    /// "3 series de 6 a 8 repeticiones", or the cardio target ("20 min · zona 2").
    var prescription: String {
        isCardio ? cardio?.summary ?? "Cardio" : TrainingText.target(sets: sets, repMin: repMin, repMax: repMax)
    }

    /// The same prescription as an edit input, keeping this exercise's id.
    var input: DayExerciseInput {
        DayExerciseInput(id: id, exerciseId: exerciseId, sets: sets, repMin: repMin, repMax: repMax, targetRpe: targetRpe, targetRir: targetRir, restSeconds: restSeconds, notes: notes, cardio: cardio, weightKg: weightKg, supersetId: supersetId)
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

    /// "8 rondas de 30 s y 90 s de pausa"
    var summary: String { "\(rounds) \(rounds == 1 ? "ronda" : "rondas") de \(workSeconds) s y \(restSeconds) s de pausa" }
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

    /// "20 min · zona 2", "8 rondas de 30 s y 90 s de pausa · zona 4", "5 km".
    var summary: String {
        var parts: [String] = []
        if let intervals { parts.append(intervals.summary) } else if let durationMinutes { parts.append("\(durationMinutes.formatted()) min") }
        if let distanceKm { parts.append("\(distanceKm.formatted()) km") }
        if let zone { parts.append("zona \(zone)") }
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
    /// For exercises without their own unit, and for totals such as a session's volume.
    var defaultUnit: WeightUnit = .kg
    /// Library exercise id → the unit its machine or plates use.
    var exerciseUnits: [String: WeightUnit] = [:]

    /// The unit `exerciseId` (a library id) is shown, typed and stepped in.
    func unit(for exerciseId: String) -> WeightUnit { exerciseUnits[exerciseId] ?? defaultUnit }

    init(preferredEquipment: [String], defaultUnit: WeightUnit = .kg, exerciseUnits: [String: WeightUnit] = [:]) {
        self.preferredEquipment = preferredEquipment
        self.defaultUnit = defaultUnit
        self.exerciseUnits = exerciseUnits
    }

    private enum CodingKeys: String, CodingKey { case preferredEquipment, defaultUnit, exerciseUnits }

    /// Lenient: an older engine sends neither unit field, and an unknown unit is skipped.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        preferredEquipment = try c.decodeIfPresent([String].self, forKey: .preferredEquipment) ?? []
        defaultUnit = (try? c.decodeIfPresent(String.self, forKey: .defaultUnit)).flatMap(WeightUnit.init(rawValue:)) ?? .kg
        let units = try? c.decodeIfPresent([String: String].self, forKey: .exerciseUnits)
        exerciseUnits = units?.compactMapValues(WeightUnit.init(rawValue:)) ?? [:]
    }
}

/// `PUT /api/mobile/training/settings`: only the fields given change.
struct TrainingSettingsUpdate: Encodable {
    var preferredEquipment: [String]? = nil
    var defaultUnit: WeightUnit? = nil
}

/// `PUT /api/mobile/training/exercises/:id/unit`; a nil unit is sent as null (follow the default).
struct ExerciseUnitBody: Encodable {
    var unit: WeightUnit?

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(["unit": unit])
    }
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
    var weightKg: Double?
    var supersetId: String? = nil
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

    /// The record in the exercise's unit: "102,5 kg", "225 lb", "12 repeticiones".
    func valueText(_ unit: WeightUnit) -> String { text(value, unit) }
    func previousText(_ unit: WeightUnit) -> String? { previous.map { kind == "reps" ? "\(Int($0))" : unit.format($0) } }

    private func text(_ value: Double, _ unit: WeightUnit) -> String {
        kind == "reps" ? TrainingText.repetitions(Int(value)) : unit.format(value)
    }
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

    func saveTrainingSettings(_ update: TrainingSettingsUpdate) async throws -> TrainingSettings {
        try await call("api/mobile/training/settings", method: "PUT", body: update)
    }

    /// Pins an exercise (library id) to kg or lb; nil follows the default unit again.
    func setExerciseUnit(_ exerciseId: String, unit: WeightUnit?) async throws -> TrainingSettings {
        try await call("api/mobile/training/exercises/\(exerciseId)/unit", method: "PUT", body: ExerciseUnitBody(unit: unit))
    }
}
