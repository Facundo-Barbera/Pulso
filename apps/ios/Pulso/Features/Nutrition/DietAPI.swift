import Foundation

/// The dated plan: `/api/mobile/nutrition/{horizon,plan/ops,plan/revisions,recipes}`.
extension PulsoAPI {
    private struct HorizonResponse: Decodable { var horizon: DietHorizon? }
    private struct RevisionsResponse: Decodable { var revisions: [PlanRevision] }
    private struct RecipeResponse: Decodable { var recipe: Recipe }
    private struct Undo: Encodable { var id: String? }

    /// From `from` (default today on the Mac) over `days` (default the plan's horizon). Nil without an active plan.
    func dietHorizon(from: String? = nil, days: Int? = nil) async throws -> DietHorizon? {
        var request = makeRequest("api/mobile/nutrition/horizon", method: "GET")
        let query = [from.map { URLQueryItem(name: "from", value: $0) }, days.map { URLQueryItem(name: "days", value: String($0)) }]
            .compactMap { $0 }
        if !query.isEmpty { request.url = request.url?.appending(queryItems: query) }
        let response: HorizonResponse = try await perform(request)
        return response.horizon
    }

    func applyPlanOp(_ op: PlanOp) async throws -> PlanChange {
        try await call("api/mobile/nutrition/plan/ops", method: "POST", body: op)
    }

    /// Newest first.
    func planRevisions(limit: Int = 30) async throws -> [PlanRevision] {
        var request = makeRequest("api/mobile/nutrition/plan/revisions", method: "GET")
        request.url = request.url?.appending(queryItems: [URLQueryItem(name: "limit", value: String(limit))])
        let response: RevisionsResponse = try await perform(request)
        return response.revisions
    }

    /// Undoes that change, or the latest one.
    func undoPlanRevision(_ id: String? = nil) async throws -> PlanChange {
        try await call("api/mobile/nutrition/plan/revisions/undo", method: "POST", body: Undo(id: id))
    }

    func recipe(_ id: String) async throws -> Recipe {
        let response: RecipeResponse = try await call("api/mobile/nutrition/recipes/\(id)", method: "GET")
        return response.recipe
    }
}
