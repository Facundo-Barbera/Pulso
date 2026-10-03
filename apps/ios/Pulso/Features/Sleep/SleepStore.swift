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

    // MARK: Nights logged by hand

    /// Counts successful saves, for the success haptic on whichever screen presented the sheet.
    private(set) var saved = 0

    /// Logs a night by hand (`id` nil) or edits one, then shows it. Returns why the Mac refused, to show in the sheet.
    func saveManual(id: String?, start: Date, end: Date, note: String?, model: PulsoModel) async -> String? {
        guard let api = model.api else { return Self.unpaired }
        do {
            let night = if let id {
                try await api.updateManualSleep(id: id, start: start, end: end, note: note)
            } else {
                try await api.addManualSleep(start: start, end: end, note: note)
            }
            selected = night.night
            await reload(api)
            saved += 1
            return nil
        } catch {
            return reason(error, model: model)
        }
    }

    func deleteManual(id: String, model: PulsoModel) async -> String? {
        guard let api = model.api else { return Self.unpaired }
        do {
            let night = try await api.deleteManualSleep(id: id)
            if selected == night.night { selected = nil }
            await reload(api)
            return nil
        } catch {
            return reason(error, model: model)
        }
    }

    private static let unpaired = "Este iPhone no está emparejado con ninguna Mac."

    /// This screen (when it's showing one: Hoy's sheet has its own unloaded store) and Hoy.
    /// A failed reload is left to their own next load.
    private func reload(_ api: PulsoAPI) async {
        if loaded, let fresh = try? await api.sleep() { overview = fresh }
        await TodayStore.shared.load()
    }

    /// The engine's Spanish message for a refusal (overlap with Health, out of range…) stays in the sheet;
    /// anything else (offline, unpaired) also goes to the model, as everywhere else.
    private func reason(_ error: Error, model: PulsoModel) -> String {
        if let failure = error as? PulsoAPI.Failure, case .refused = failure.kind { return failure.message }
        model.handle(error)
        return error.localizedDescription
    }
}
