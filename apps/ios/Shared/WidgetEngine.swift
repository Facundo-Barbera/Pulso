import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

/// A small engine client for code that runs outside the app (widget timelines,
/// widget buttons, the Control Center control). It decodes only the fields the
/// widgets show, so it does not depend on the features' models.
struct WidgetEngine {
    struct Failure: Error, CustomLocalizedStringResourceConvertible, LocalizedError {
        var message: String
        var localizedStringResource: LocalizedStringResource { "\(message)" }
        var errorDescription: String? { message }

        static let unpaired = Failure(message: "Abrí Pulso y emparejalo con tu Mac primero.")
        static let unreachable = Failure(message: "No se pudo llegar a tu Mac. ¿Tailscale está activo?")
    }

    let credentials: SharedCredentials

    /// Shorter than the app's: a widget timeline has a few seconds, not a screen to wait on.
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 6
        config.timeoutIntervalForResource = 12
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    static func current() throws -> WidgetEngine {
        guard let credentials = SharedCredentials.load() else { throw Failure.unpaired }
        return WidgetEngine(credentials: credentials)
    }

    // MARK: Snapshot

    /// Fetches every section at once; whatever fails keeps the last value.
    /// Throws only when nothing at all came back.
    func refreshSnapshot(now: Date = .now) async throws -> WidgetSnapshot {
        async let recovery = attempt { try await recovery() }
        async let macros = attempt { try await macros(now) }
        async let doses = attempt { try await doses(now) }
        async let workout = attempt { try await workout() }
        let update = await WidgetSnapshot.Update(recovery: recovery, macros: macros, doses: doses, workout: workout)
        guard !update.isEmpty else { throw Failure.unreachable }
        let snapshot = WidgetSnapshot.applying(update, to: SnapshotStore.load(), now: now)
        SnapshotStore.save(snapshot)
        return snapshot
    }

    /// The stored snapshot, refreshed first when it is older than `maxAge` (and the engine answers).
    static func snapshot(maxAge: TimeInterval, now: Date = .now) async -> WidgetSnapshot? {
        let stored = SnapshotStore.load()
        if let stored, now.timeIntervalSince(stored.updatedAt) < maxAge { return stored }
        guard let engine = try? current() else { return stored }
        return (try? await engine.refreshSnapshot(now: now)) ?? stored
    }

    static func reloadWidgets() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }

    private func attempt<T>(_ fetch: () async throws -> T) async -> T? {
        try? await fetch()
    }

    // MARK: Sections

    private struct DailyResponse: Decodable {
        struct Readiness: Decodable { var score: Int?; var level: String; var explanation: String }
        var readiness: Readiness
    }

    private struct NutritionDayResponse: Decodable {
        struct Totals: Decodable { var kcal: Double; var protein: Double }
        struct Summary: Decodable { var totals: Totals; var targets: Totals? }
        var summary: Summary
    }

    struct DoseSlot: Decodable {
        var medicationId: String
        var name: String
        var dose: Double
        var unit: String
        var date: String
        /// Null while the dose waits for a workout.
        var time: String?
        /// The key a dose is logged under; older engines have none (the time is the key).
        var slot: String?
        var status: String

        var widgetDose: WidgetSnapshot.Dose? {
            guard let time, let due = WidgetClock.instant(date: date, time: time) else { return nil }
            return WidgetSnapshot.Dose(medicationId: medicationId, name: name, doseText: "\(dose.formatted()) \(unit)", date: date, time: time, due: due, slot: slot)
        }
    }

    struct MedicationDayResponse: Decodable {
        var slots: [DoseSlot]
        var next: DoseSlot?

        var doses: (next: WidgetSnapshot.Dose?, left: Int) {
            (next?.widgetDose, slots.count { $0.status == "pendiente" })
        }
    }

    private struct ProgramResponse: Decodable {
        struct Exercise: Decodable {}
        struct Day: Decodable { var id: String; var name: String; var focus: String?; var exercises: [Exercise] }
        struct Program: Decodable { var name: String; var days: [Day] }
        var program: Program?
        var nextDayId: String?
    }

    private struct Ack: Decodable {}

    func recovery() async throws -> WidgetSnapshot.Recovery {
        let r = try await get("api/mobile/daily", as: DailyResponse.self).readiness
        return WidgetSnapshot.Recovery(score: r.score, level: r.level, explanation: r.explanation)
    }

    func macros(_ now: Date) async throws -> WidgetSnapshot.Macros {
        let summary = try await get("api/mobile/nutrition/day", query: ["date": WidgetClock.date(now)], as: NutritionDayResponse.self).summary
        return WidgetSnapshot.Macros(kcal: summary.totals.kcal, kcalTarget: summary.targets?.kcal, protein: summary.totals.protein, proteinTarget: summary.targets?.protein)
    }

    func medicationDay(_ now: Date) async throws -> MedicationDayResponse {
        try await get("api/mobile/medication/today", query: ["date": WidgetClock.date(now), "time": WidgetClock.time(now)], as: MedicationDayResponse.self)
    }

    func doses(_ now: Date) async throws -> (next: WidgetSnapshot.Dose?, left: Int) {
        try await medicationDay(now).doses
    }

    func workout() async throws -> WidgetSnapshot.Workout? {
        let response = try await get("api/mobile/training/program", as: ProgramResponse.self)
        guard let program = response.program,
              let day = program.days.first(where: { $0.id == response.nextDayId }) ?? program.days.first
        else { return nil }
        return WidgetSnapshot.Workout(programName: program.name, dayName: day.name, focus: day.focus, exercises: day.exercises.count)
    }

    /// Marks a scheduled dose as taken now.
    func takeDose(_ dose: WidgetSnapshot.Dose, at now: Date = .now) async throws {
        // The engine wants whole epoch ms.
        struct DoseLog: Encodable { var medicationId, date, scheduledTime: String; var status = "tomada"; var takenAt: Int64 }
        let body = DoseLog(medicationId: dose.medicationId, date: dose.date, scheduledTime: dose.slot ?? dose.time, takenAt: Int64(now.timeIntervalSince1970 * 1000))
        var request = request("api/mobile/medication/doses", method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(body)
        _ = try await perform(request, as: Ack.self)
    }

    // MARK: HTTP

    private func request(_ path: String, method: String, query: [String: String] = [:]) -> URLRequest {
        var url = credentials.baseURL.appendingPathComponent(path)
        if !query.isEmpty { url = url.appending(queryItems: query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "authorization")
        return request
    }

    private func get<T: Decodable>(_ path: String, query: [String: String] = [:], as type: T.Type) async throws -> T {
        try await perform(request(path, method: "GET", query: query), as: type)
    }

    private func perform<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await Self.session.data(for: request)
        } catch {
            throw Failure.unreachable
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw Failure.unpaired }
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["message"]
            throw Failure(message: message ?? "Tu Mac respondió \(status).")
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw Failure(message: "Tu Mac respondió algo inesperado.")
        }
    }
}
