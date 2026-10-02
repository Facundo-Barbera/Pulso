import Foundation

/// `/api/mobile/substances/*`. The overview carries the phone's local date and
/// time so "today" and "this week" are the person's, not the Mac's.
extension PulsoAPI {
    private struct Deleted: Decodable {}
    private struct Order: Encodable { var ids: [String] }

    /// `scope` nil lets the engine pick (the first active substance).
    func substanceOverview(_ scope: SubstanceScope?, at now: Date = .now) async throws -> SubstanceOverview {
        var request = makeRequest("api/mobile/substances", method: "GET")
        var query = [
            URLQueryItem(name: "date", value: LocalClock.date(now)),
            URLQueryItem(name: "time", value: LocalClock.time(now)),
        ]
        if let scope { query.insert(URLQueryItem(name: "substance", value: scope.query), at: 0) }
        request.url = request.url?.appending(queryItems: query)
        return try await perform(request)
    }

    func addSubstanceEntry(_ draft: SubstanceDraft) async throws -> SubstanceEntry {
        try await call("api/mobile/substances", method: "POST", body: draft)
    }

    func updateSubstanceEntry(id: String, _ draft: SubstanceDraft) async throws -> SubstanceEntry {
        try await call("api/mobile/substances/\(id)", method: "PATCH", body: draft)
    }

    func deleteSubstanceEntry(id: String) async throws {
        let _: Deleted = try await call("api/mobile/substances/\(id)", method: "DELETE")
    }

    func substanceTypes() async throws -> [Substance] {
        let list: SubstanceList = try await call("api/mobile/substances/types", method: "GET")
        return list.substances
    }

    /// `patch.name` is required here.
    func createSubstance(_ patch: SubstancePatch) async throws -> Substance {
        try await call("api/mobile/substances/types", method: "POST", body: patch)
    }

    func updateSubstance(id: String, _ patch: SubstancePatch) async throws -> Substance {
        try await call("api/mobile/substances/types/\(id)", method: "PATCH", body: patch)
    }

    /// Every active id, in the new order.
    func reorderSubstances(_ ids: [String]) async throws -> [Substance] {
        let list: SubstanceList = try await call("api/mobile/substances/types/order", method: "PUT", body: Order(ids: ids))
        return list.substances
    }
}
