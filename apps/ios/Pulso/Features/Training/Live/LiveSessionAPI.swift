import Foundation

/// The session in progress, kept on the engine so the Coach can change it.
extension PulsoAPI {
    private struct LiveEnvelope: Decodable { var session: LiveSessionState? }
    private struct LivePut: Encodable { var session: LiveSessionState; var baseVersion: Int }
    /// Any JSON object (or `null`): DELETE's body isn't read.
    private struct Ignored: Decodable {}

    /// `GET api/mobile/training/live` → `{ session }`, null when there is none.
    func liveSession() async throws -> LiveSessionState? {
        let response: LiveEnvelope = try await call("api/mobile/training/live", method: "GET")
        return response.session
    }

    /// `PUT api/mobile/training/live` `{ session, baseVersion }` → `{ session }` with the
    /// engine's new version. A 409 (the Coach moved it past `baseVersion`) throws; see `isConflict`.
    func putLiveSession(_ session: LiveSessionState, baseVersion: Int) async throws -> LiveSessionState {
        let response: LiveEnvelope = try await call("api/mobile/training/live", method: "PUT", body: LivePut(session: session, baseVersion: baseVersion))
        guard let saved = response.session else { throw Failure(kind: .badResponse(status: 200), message: "La Mac no devolvió la sesión.") }
        return saved
    }

    /// `DELETE api/mobile/training/live`: finished or discarded.
    func deleteLiveSession() async throws {
        let _: Ignored? = try await call("api/mobile/training/live", method: "DELETE")
    }
}

extension PulsoAPI.Failure {
    /// The engine's 409 `{ code: "conflict", session }`. `perform` keeps only the code,
    /// so the caller GETs the engine's copy to adopt it.
    var isConflict: Bool {
        switch kind {
        case .refused(let code): code == "conflict"
        case .badResponse(let status): status == 409
        default: false
        }
    }
}
