import Foundation

// The training routes. Apart from the models, which the Watch app shares.

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
        try await call("api/mobile/training/sessions", method: "POST", body: session.sanitized)
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

    /// One logged session, for a week's done day.
    func trainingSession(_ id: String) async throws -> TrainingSession {
        try await call("api/mobile/training/sessions/\(id)", method: "GET")
    }

    /// "Empezar la semana ya", once this one is complete.
    func startNextWeek() async throws -> ActiveProgramResponse {
        try await call("api/mobile/training/program/weeks/next", method: "POST")
    }

    /// "Retomar": a new block with an earlier block's days.
    func resumeBlock(_ programId: String) async throws -> ActiveProgramResponse {
        try await call("api/mobile/training/program/blocks/\(programId)/resume", method: "POST")
    }

    private struct DismissBody: Encodable { var dismissed: Bool }
    private struct ThreadResponse: Decodable { var threadId: String }

    /// "Entrenar normal" (true) or back to the Coach's plan (false).
    func setAdjustmentDismissed(_ id: String, _ dismissed: Bool) async throws -> ActiveProgramResponse {
        try await call("api/mobile/training/program/adjustment/\(id)", method: "PUT", body: DismissBody(dismissed: dismissed))
    }

    /// "Ver por qué": the Coach thread about the adjustment.
    func adjustmentThread(_ id: String) async throws -> String {
        let response: ThreadResponse = try await call("api/mobile/training/program/adjustment/\(id)/thread", method: "POST")
        return response.threadId
    }

    /// Pins an exercise (library id) to kg or lb; nil follows the default unit again.
    func setExerciseUnit(_ exerciseId: String, unit: WeightUnit?) async throws -> TrainingSettings {
        try await call("api/mobile/training/exercises/\(exerciseId)/unit", method: "PUT", body: ExerciseUnitBody(unit: unit))
    }
}
