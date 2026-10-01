import Foundation

/// A workout as the engine stores it (`@pulso/contract` `Workout`). Times are epoch milliseconds.
struct Workout: Codable, Identifiable, Equatable {
    var id: String
    var externalId: String?
    var source: String
    var activity: String
    var startedAt: Double
    var endedAt: Double
    var energy: Double?
    var distance: Double?
}

/// What the phone sends from HealthKit (`WorkoutInput`).
struct WorkoutInput: Codable, Equatable {
    var externalId: String
    var activity: String
    var startedAt: Double
    var endedAt: Double
    var energy: Double?
    var distance: Double?
    var sourceBundle: String?
    var sourceName: String?
}

/// The Mac's `/api/mobile/*` routes. One bearer token, JSON both ways, short
/// timeouts: over the tailnet a request that hangs is worse than one that fails.
struct PulsoAPI {
    struct Failure: Error, LocalizedError, Equatable {
        enum Kind: Equatable { case unpaired, refused(code: String), transport, badResponse(status: Int) }
        var kind: Kind
        var message: String
        var errorDescription: String? { message }
    }

    struct PairResponse: Decodable { var deviceId: String; var name: String; var token: String }
    struct WorkoutsResponse: Decodable { var workouts: [Workout] }
    struct SyncResponse: Decodable { var written: Int }
    private struct ErrorBody: Decodable { var code: String; var message: String }

    let base: URL
    let token: String?

    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        config.timeoutIntervalForResource = 30
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    static func pair(base: URL, code: String, name: String) async throws -> PairResponse {
        try await PulsoAPI(base: base, token: nil).call("api/mobile/pair", method: "POST", body: ["code": code, "name": name])
    }

    func workouts() async throws -> [Workout] {
        let response: WorkoutsResponse = try await call("api/mobile/workouts", method: "GET")
        return response.workouts
    }

    func sync(_ workouts: [WorkoutInput]) async throws -> Int {
        let response: SyncResponse = try await call("api/mobile/workouts", method: "POST", body: ["workouts": workouts])
        return response.written
    }

    func call<Response: Decodable, Body: Encodable>(_ path: String, method: String, body: Body) async throws -> Response {
        var request = makeRequest(path, method: method)
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await perform(request)
    }

    func call<Response: Decodable>(_ path: String, method: String) async throws -> Response {
        try await perform(makeRequest(path, method: method))
    }

    func makeRequest(_ path: String, method: String) -> URLRequest {
        var request = URLRequest(url: base.appendingPathComponent(path))
        request.httpMethod = method
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
        return request
    }

    func perform<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await Self.session.data(for: request)
        } catch {
            throw Failure(kind: .transport, message: "No se pudo llegar a la Mac. ¿Tailscale está activo y `bun run tailnet` corriendo?")
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw Self.failure(status: status, data: data) }
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw Failure(kind: .badResponse(status: status), message: "La Mac respondió algo inesperado.")
        }
    }

    static func failure(status: Int, data: Data) -> Failure {
        let body = try? JSONDecoder().decode(ErrorBody.self, from: data)
        if status == 401 && body?.code == "unauthorized" {
            return Failure(kind: .unpaired, message: body?.message ?? "Este teléfono no está emparejado.")
        }
        if let body { return Failure(kind: .refused(code: body.code), message: body.message) }
        return Failure(kind: .badResponse(status: status), message: "La Mac respondió \(status).")
    }
}
