import Foundation
import Observation

/// The sleep screen's state: the engine's overview, which night is shown, and syncing from Salud.
@MainActor
@Observable
final class SleepStore {
    private(set) var overview: SleepOverview?
    private(set) var loaded = false
    private(set) var syncing = false
    /// The night being shown; nil means the most recent.
    var selected: String?

    private var lastSync: Date?

    var nights: [SleepNight] { overview?.nights ?? [] }
    var night: SleepNight? { nights.first { $0.night == selected } ?? nights.first }
    var targetMin: Double { overview?.targetMin ?? 480 }

    private var index: Int? { night.flatMap { n in nights.firstIndex { $0.night == n.night } } }
    var hasOlder: Bool { (index ?? nights.count) < nights.count - 1 }
    var hasNewer: Bool { (index ?? 0) > 0 }
    func older() { if let i = index, hasOlder { selected = nights[i + 1].night } }
    func newer() { if let i = index, hasNewer { selected = nights[i - 1].night } }

    func load(_ model: PulsoModel) async {
        guard let api = model.api else { return }
        do {
            overview = try await api.sleep()
        } catch {
            model.handle(error)
        }
        loaded = true
    }

    /// Salud → Mac → screen. Skipped when it ran in the last 15 minutes unless `force`.
    func sync(_ model: PulsoModel, force: Bool = false) async {
        guard let api = model.api, HealthSync.available, !syncing else { return }
        if !force, let lastSync, lastSync.timeIntervalSinceNow > -15 * 60 { return }
        syncing = true
        defer { syncing = false }
        do {
            try await SleepHealth.requestAccess()
            let segments = try await SleepHealth.recentSegments()
            if !segments.isEmpty { _ = try await api.syncSleep(segments) }
            lastSync = .now
            overview = try await api.sleep()
        } catch {
            model.handle(error)
        }
    }

    func setTarget(_ minutes: Double, model: PulsoModel) async {
        guard let api = model.api else { return }
        do {
            _ = try await api.setSleepTarget(minutes: minutes)
            overview = try await api.sleep()
        } catch {
            model.handle(error)
        }
    }
}
