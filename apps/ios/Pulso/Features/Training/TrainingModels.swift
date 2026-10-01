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

    /// "3 × 6–8 · RIR 2"
    var prescription: String {
        var text = "\(sets) × " + (repMin == repMax ? "\(repMin)" : "\(repMin)–\(repMax)")
        if let targetRir { text += " · RIR \(targetRir)" } else if let targetRpe { text += " · RPE \(targetRpe.formatted())" }
        return text
    }

    /// Stepper jump: dumbbells and bodyweight load move by 1 kg, plates and stacks by 2.5.
    var weightStep: Double { equipment == "dumbbell" || equipment == "bodyweight" ? 1 : 2.5 }
}

struct ProgramDay: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var focus: String?
    var weekday: Int?
    var exercises: [ProgramExercise]
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

struct LibraryExercise: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var muscle: String
    var secondary: [String]
    var equipment: String
    var kind: String
}

struct ExerciseHistoryPoint: Codable, Identifiable, Hashable {
    var sessionId: String
    var date: Double
    var topWeightKg: Double
    var bestE1rm: Double
    var totalReps: Int
    var volumeKg: Double
    var sets: [SetLog]

    var id: String { sessionId }
    var day: Date { Date(timeIntervalSince1970: date / 1000) }
}

struct ExerciseHistory: Codable {
    var exercise: LibraryExercise
    var points: [ExerciseHistoryPoint]
    var bestE1rm: Double?
    var heaviestKg: Double?
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

    func exerciseHistory(_ exerciseId: String) async throws -> ExerciseHistory {
        try await call("api/mobile/training/exercises/\(exerciseId)/history", method: "GET")
    }
}
