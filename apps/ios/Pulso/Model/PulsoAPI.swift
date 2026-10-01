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
    struct StatusResponse: Decodable { var at: Double }
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

    /// A cheap authenticated round trip: is the Mac there, and does it still know this phone.
    func status() async throws -> StatusResponse {
        try await call("api/mobile/status", method: "GET")
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

    /// Sends `request`, retrying an idempotent one once if the Mac was not reached, and
    /// tells the model whether it answered (that drives the offline banner and Ajustes).
    func perform<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        let (data, response) = try await Self.retrying(method: request.httpMethod ?? "GET") {
            let clock = ContinuousClock()
            let start = clock.now
            do {
                let result = try await Self.session.data(for: request)
                await PulsoModel.shared.recordContact(latency: clock.now - start)
                return result
            } catch {
                await PulsoModel.shared.recordUnreachable()
                throw Self.transportFailure(error)
            }
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw Self.failure(status: status, data: data) }
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw Failure(kind: .badResponse(status: status), message: "La Mac respondió algo inesperado.")
        }
    }

    /// Runs `attempt`, and once more after a short pause if it failed in transport and
    /// `method` is safe to repeat. Writes are never retried: the first may have landed.
    static func retrying<T>(method: String, pause: Duration = .milliseconds(400), _ attempt: () async throws -> T) async throws -> T {
        do {
            return try await attempt()
        } catch let failure as Failure where failure.kind == .transport && ["GET", "HEAD"].contains(method.uppercased()) {
            try await Task.sleep(for: pause)
            return try await attempt()
        }
    }

    /// Why the request never got an HTTP answer, in words the person can act on.
    static func transportFailure(_ error: Error) -> Failure {
        let code = (error as? URLError)?.code
        let message = switch code {
        case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed:
            "El iPhone no tiene conexión. Revisa el Wi‑Fi o los datos móviles."
        case .timedOut:
            "La Mac no respondió a tiempo. ¿Está despierta y con Tailscale activo?"
        case .cannotFindHost, .dnsLookupFailed, .badURL, .unsupportedURL:
            "Esa dirección no lleva a ninguna Mac. Revísala: es la que muestra Pulso en la Mac."
        case .cancelled:
            "Se canceló la conexión con la Mac."
        default:
            "No se pudo llegar a la Mac. ¿Tailscale está activo en los dos equipos y `bun run tailnet` corriendo?"
        }
        return Failure(kind: .transport, message: message)
    }

    static func failure(status: Int, data: Data) -> Failure {
        let body = try? JSONDecoder().decode(ErrorBody.self, from: data)
        if status == 401 && body?.code == "unauthorized" {
            return Failure(kind: .unpaired, message: "Esta Mac ya no reconoce este iPhone. Vuelve a emparejarlo.")
        }
        if let body { return Failure(kind: .refused(code: body.code), message: refusalMessage(code: body.code) ?? body.message) }
        return Failure(kind: .badResponse(status: status), message: "La Mac respondió \(status).")
    }

    /// The engine speaks English; the codes the person can hit while pairing read in Spanish.
    static func refusalMessage(code: String) -> String? {
        switch code {
        case "invalid_code": "Ese código no es válido. Genera uno nuevo en la Mac."
        case "expired_code": "Ese código venció. Genera uno nuevo en la Mac (dura cinco minutos)."
        case "tailnet_closed": "La Mac rechazó el pedido: esa ruta sólo responde en la propia Mac."
        default: nil
        }
    }
}
