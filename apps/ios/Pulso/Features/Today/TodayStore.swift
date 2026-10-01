import Foundation
import Observation

/// The Hoy tab's state: the last 30 days from the engine and today's readiness.
@MainActor
@Observable
final class TodayStore {
    static let shared = TodayStore()

    /// Daily goals the activity rings fill towards.
    static let stepGoal = 8_000.0
    static let energyGoal = 500.0
    static let exerciseGoal = 30.0

    private(set) var days: [DailyMetrics] = []
    private(set) var readiness: Readiness?
    private(set) var syncing = false

    var today: DailyMetrics? { days.last { $0.date == (readiness?.date ?? DayKey.string(.now)) } }

    /// The last `count` days ending today, oldest first, keeping only those with `value`.
    func trend(_ count: Int, _ value: (DailyMetrics) -> Double?) -> [(date: Date, value: Double)] {
        days.suffix(count).compactMap { day in
            guard let v = value(day), let date = DayKey.date(day.date) else { return nil }
            return (date, v)
        }
    }

    func load() async {
        guard let api = PulsoModel.shared.api else { return }
        do {
            let response = try await api.daily()
            days = response.days
            readiness = response.readiness
        } catch {
            PulsoModel.shared.handle(error)
        }
    }

    /// HealthKit → Mac (daily signals, then workouts), then reload. Runs on open and on pull-to-refresh.
    func sync() async {
        guard !syncing else { return }
        syncing = true
        defer { syncing = false }
        let model = PulsoModel.shared
        if let api = model.api, HealthSync.available {
            do {
                try await HealthMetrics.requestAccess()
                let days = await HealthMetrics.recentDays()
                if !days.isEmpty { _ = try await api.syncDaily(days) }
            } catch {
                model.handle(error)
            }
            await model.syncHealth()
        } else {
            await model.refresh()
        }
        await load()
    }
}
