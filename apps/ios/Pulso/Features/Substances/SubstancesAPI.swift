import Foundation

/// `/api/mobile/substances/*`. The overview carries the phone's local date and
/// time so "today" and "this week" are the person's, not the Mac's.
extension PulsoAPI {
    private struct Deleted: Decodable {}

    func substanceOverview(_ substance: Substance, at now: Date = .now) async throws -> SubstanceOverview {
        var request = makeRequest("api/mobile/substances", method: "GET")
        request.url = request.url?.appending(queryItems: [
            URLQueryItem(name: "substance", value: substance.rawValue),
            URLQueryItem(name: "date", value: LocalClock.date(now)),
            URLQueryItem(name: "time", value: LocalClock.time(now)),
        ])
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

    /// `nil` clears the goal.
    func updateSubstanceSettings(maxDaysPerWeek: Int?) async throws -> SubstanceSettings {
        try await call("api/mobile/substances/settings", method: "PATCH", body: SubstanceSettings(maxDaysPerWeek: maxDaysPerWeek))
    }
}
