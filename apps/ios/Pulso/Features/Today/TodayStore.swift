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
    /// When the engine last answered, for the "actualizado hace…" line.
    private(set) var updatedAt: Date?

    /// Workouts with duplicates from two recording apps merged.
    var workouts: [Workout] { WorkoutMerge.merged(PulsoModel.shared.workouts) }

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
            updatedAt = .now
        } catch {
            PulsoModel.shared.handle(error)
        }
    }

    /// HealthKit → Mac (daily signals, then workouts), then reload. Silent: runs on open, on
    /// foreground and on pull-to-refresh.
    func sync() async {
        guard !syncing else { return }
        syncing = true
        defer { syncing = false }
        let model = PulsoModel.shared
        if let api = model.api, HealthSync.available {
            do {
                try await HealthMetrics.requestAccess()
                #if DEBUG
                await HealthDiagnostics.logReport()
                #endif
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
        await WidgetSync.refresh()
    }
}
