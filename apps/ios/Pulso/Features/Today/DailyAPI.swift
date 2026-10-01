import Foundation

/// One day of Apple Health signals (`@pulso/contract` `DailyMetrics`). The phone
/// sends it without `updatedAt`; the engine returns it with. Sleep is the night
/// that ended on `date`.
struct DailyMetrics: Codable, Identifiable, Equatable {
    var date: String
    var steps: Double?
    /// kcal
    var activeEnergy: Double?
    var exerciseMinutes: Double?
    /// Summed from workouts because Health had no Apple exercise time.
    var exerciseMinutesEstimated: Bool?
    /// bpm
    var restingHeartRate: Double?
    /// Estimated from heart-rate samples because Health had no resting heart rate.
    var restingHeartRateEstimated: Bool?
    /// SDNN, ms
    var hrv: Double?
    var sleepMinutes: Double?
    var sleepDeep: Double?
    var sleepCore: Double?
    var sleepRem: Double?
    var sleepAwake: Double?
    /// mL/kg/min
    var vo2max: Double?
    /// breaths/min
    var respiratoryRate: Double?
    var updatedAt: Double?

    var id: String { date }
}

struct ReadinessFactor: Codable, Identifiable, Equatable {
    var key: String
    var label: String
    var value: Double?
    var baseline: Double?
    var score: Int?
    var detail: String
    /// Today's value is an estimate and counts for a little less.
    var estimated: Bool?

    var id: String { key }
}

struct Readiness: Codable, Equatable {
    var date: String
    var score: Int?
    /// high | medium | low | unknown
    var level: String
    var factors: [ReadinessFactor]
    var explanation: String
    var baselineDays: Int
}

extension PulsoAPI {
    struct DailyResponse: Decodable { var days: [DailyMetrics]; var readiness: Readiness }

    /// The last 30 days, oldest first, and today's readiness.
    func daily() async throws -> DailyResponse {
        try await call("api/mobile/daily", method: "GET")
    }

    func syncDaily(_ days: [DailyMetrics]) async throws -> Int {
        let response: SyncResponse = try await call("api/mobile/daily", method: "POST", body: ["days": days])
        return response.written
    }
}
