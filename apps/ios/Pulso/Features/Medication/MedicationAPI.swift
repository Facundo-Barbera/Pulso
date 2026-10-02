import Foundation

/// `/api/mobile/medication/*`. Day and adherence carry the phone's local date
/// and time so the Mac never has to guess the time zone.
extension PulsoAPI {
    private struct MedicationsResponse: Decodable { var medications: [Medication] }
    private struct Ack: Decodable {}
    private struct DosesResponse: Decodable { var doses: [DoseEvent] }
    private struct NudgesResponse: Decodable { var nudges: [ScheduleNudge] }

    private static func asOf(_ now: Date) -> [URLQueryItem] {
        [URLQueryItem(name: "date", value: LocalClock.date(now)), URLQueryItem(name: "time", value: LocalClock.time(now))]
    }

    /// GET with a query string: `call` appends a path component, which would escape the `?`.
    private func get<Response: Decodable>(_ path: String, query: [URLQueryItem]) async throws -> Response {
        var request = makeRequest(path, method: "GET")
        var components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)
        components?.queryItems = query
        request.url = components?.url ?? request.url
        return try await perform(request)
    }

    func medications(includeInactive: Bool = true) async throws -> [Medication] {
        let query = includeInactive ? [URLQueryItem(name: "all", value: "1")] : []
        let response: MedicationsResponse = try await get("api/mobile/medication", query: query)
        return response.medications
    }

    func addMedication(_ draft: MedicationDraft) async throws -> Medication {
        try await call("api/mobile/medication", method: "POST", body: draft)
    }

    func updateMedication(id: String, _ draft: MedicationDraft) async throws -> Medication {
        try await call("api/mobile/medication/\(id)", method: "PATCH", body: draft)
    }

    func deleteMedication(id: String) async throws {
        let _: Ack = try await call("api/mobile/medication/\(id)", method: "DELETE")
    }

    func medicationDay(at now: Date = .now) async throws -> MedicationDay {
        try await get("api/mobile/medication/today", query: Self.asOf(now))
    }

    /// The next 7 days of slots as the engine resolves them (workouts, meals, bedtime), for reminders.
    func upcomingMedication(at now: Date = .now) async throws -> MedicationUpcoming {
        try await get("api/mobile/medication/upcoming", query: Self.asOf(now))
    }

    func medicationAdherence(at now: Date = .now) async throws -> AdherenceReport {
        try await get("api/mobile/medication/adherence", query: Self.asOf(now))
    }

    /// As-needed meds that look scheduled, with a prefilled schedule to offer.
    func scheduleNudges(at now: Date = .now) async throws -> [ScheduleNudge] {
        let response: NudgesResponse = try await get("api/mobile/medication/nudges", query: Self.asOf(now))
        return response.nudges
    }

    @discardableResult
    func logDose(_ log: DoseLog) async throws -> DoseEvent {
        try await call("api/mobile/medication/doses", method: "POST", body: log)
    }

    /// Every logged dose between two local dates, inclusive.
    func doses(from: String, to: String) async throws -> [DoseEvent] {
        let response: DosesResponse = try await get("api/mobile/medication/doses", query: [URLQueryItem(name: "from", value: from), URLQueryItem(name: "to", value: to)])
        return response.doses
    }

    func undoDose(eventId: String) async throws {
        let _: Ack = try await call("api/mobile/medication/doses/\(eventId)", method: "DELETE")
    }
}
