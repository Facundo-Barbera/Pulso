import Foundation

/// The engine's `/api/mobile/body/*` routes.
extension PulsoAPI {
    private struct ScanResponse: Decodable { var scan: BodyScan }
    private struct GoalResponse: Decodable { var projection: BodyProjection }
    private struct Written: Decodable { var written: Int }
    private struct Deleted: Decodable { var deleted: String }

    func bodyDashboard() async throws -> BodyDashboard {
        try await call("api/mobile/body", method: "GET")
    }

    /// Parses a QR without saving. Unreadable payloads fail with `.refused(code: "unknown_inbody_format" | "unmapped_ibdata")`.
    func parseInBody(_ payload: String) async throws -> BodyScan {
        let response: ScanResponse = try await call("api/mobile/body/inbody", method: "POST", body: ["payload": payload])
        return response.scan
    }

    func saveBodyScan(_ scan: BodyScan) async throws -> BodyScan {
        let response: ScanResponse = try await call("api/mobile/body/scans", method: "POST", body: scan)
        return response.scan
    }

    func deleteBodyScan(id: String) async throws {
        let _: Deleted = try await call("api/mobile/body/scans/\(id)", method: "DELETE")
    }

    /// Sends an InBody CSV export as-is; the engine parses and dedupes by test time.
    func importBodyCSV(_ csv: Data) async throws -> BodyImport {
        var request = makeRequest("api/mobile/body/import", method: "POST")
        request.setValue("text/csv; charset=utf-8", forHTTPHeaderField: "content-type")
        request.httpBody = csv
        return try await perform(request)
    }

    func syncBodySamples(_ samples: [BodySample]) async throws -> Int {
        let response: Written = try await call("api/mobile/body/samples", method: "POST", body: ["samples": samples])
        return response.written
    }

    /// `nil` clears the goal. Returns the metric's fresh projection.
    func setBodyGoal(_ metric: BodyMetric, target: Double?) async throws -> BodyProjection {
        struct Body: Encodable {
            var metric: BodyMetric
            var target: Double?
            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(metric, forKey: .metric)
                try c.encode(target, forKey: .target) // explicit null clears
            }
            enum CodingKeys: String, CodingKey { case metric, target }
        }
        let response: GoalResponse = try await call("api/mobile/body/goals", method: "PUT", body: Body(metric: metric, target: target))
        return response.projection
    }
}
