import Foundation

/// `/api/mobile/calendar/*`. Writes answer with the re-plan they caused.
extension PulsoAPI {
    struct BusySaved: Decodable { var block: BusyBlock; var replan: Replan }
    struct HealthSaved: Decodable { var event: HealthEvent; var replan: Replan }
    struct Removed: Decodable { var replan: Replan }
    struct AppleSynced: Decodable { var written: Int; var replan: Replan }
    private struct BlocksResponse: Decodable { var blocks: [BusyBlock] }
    private struct EventsResponse: Decodable { var events: [HealthEvent] }

    /// GET with a query string: `call` appends a path component, which would escape the `?`.
    private func calendarGet<Response: Decodable>(_ path: String, query: [URLQueryItem]) async throws -> Response {
        var request = makeRequest(path, method: "GET")
        var components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)
        components?.queryItems = query
        request.url = components?.url ?? request.url
        return try await perform(request)
    }

    /// Every feature's items between two local dates, inclusive (at most 125 days).
    func calendar(from: String, to: String) async throws -> CalendarRange {
        try await calendarGet("api/mobile/calendar", query: [URLQueryItem(name: "from", value: from), URLQueryItem(name: "to", value: to)])
    }

    func busyBlocks() async throws -> [BusyBlock] {
        let response: BlocksResponse = try await call("api/mobile/calendar/busy", method: "GET")
        return response.blocks
    }

    func addBusyBlock(_ draft: BusyBlockDraft) async throws -> BusySaved {
        try await call("api/mobile/calendar/busy", method: "POST", body: draft)
    }

    func updateBusyBlock(id: String, _ draft: BusyBlockDraft) async throws -> BusySaved {
        try await call("api/mobile/calendar/busy/\(id)", method: "PATCH", body: draft)
    }

    func deleteBusyBlock(id: String) async throws -> Removed {
        try await call("api/mobile/calendar/busy/\(id)", method: "DELETE")
    }

    func syncAppleCalendar(_ sync: AppleCalendarBusy.Sync) async throws -> AppleSynced {
        try await call("api/mobile/calendar/busy/apple", method: "POST", body: sync)
    }

    func healthEvents() async throws -> [HealthEvent] {
        let response: EventsResponse = try await call("api/mobile/calendar/health", method: "GET")
        return response.events
    }

    func addHealthEvent(_ draft: HealthEventDraft) async throws -> HealthSaved {
        try await call("api/mobile/calendar/health", method: "POST", body: draft)
    }

    func updateHealthEvent(id: String, _ draft: HealthEventDraft) async throws -> HealthSaved {
        try await call("api/mobile/calendar/health/\(id)", method: "PATCH", body: draft)
    }

    func deleteHealthEvent(id: String) async throws -> Removed {
        try await call("api/mobile/calendar/health/\(id)", method: "DELETE")
    }
}
