import Foundation
import Observation

/// The Cuerpo tab's state: scans, goals and projections from the Mac, plus
/// every way a measurement gets there (QR, manual entry, CSV, Apple Health).
@MainActor
@Observable
final class BodyStore {
    private(set) var scans: [BodyScan] = []
    private(set) var goals: [BodyGoal] = []
    private(set) var projections: [BodyMetric: BodyProjection] = [:]
    private(set) var loaded = false
    private(set) var busy = false
    /// A one-line confirmation for the person ("3 mediciones importadas").
    var notice: String?

    private var model: PulsoModel { .shared }

    var latest: BodyScan? { scans.first }
    /// The scan before `latest`, to show what changed.
    var previous: BodyScan? { scans.dropFirst().first }

    func goal(_ metric: BodyMetric) -> BodyGoal? { goals.first { $0.metric == metric } }

    func refresh() async {
        guard let api = model.api else { return }
        do {
            apply(try await api.bodyDashboard())
        } catch {
            model.handle(error)
        }
        loaded = true
    }

    /// QR text → parsed values for the confirmation screen. Throws the engine's Spanish message when it cannot read it.
    func parse(qr payload: String) async throws -> BodyScan {
        guard let api = model.api else { throw PulsoAPI.Failure(kind: .unpaired, message: "Este teléfono no está emparejado.") }
        return try await api.parseInBody(payload)
    }

    func save(_ scan: BodyScan) async -> Bool {
        await run { api in
            _ = try await api.saveBodyScan(scan)
            self.notice = "Medición guardada"
        }
    }

    func delete(_ scan: BodyScan) async {
        guard let id = scan.id else { return }
        _ = await run { api in try await api.deleteBodyScan(id: id) }
    }

    func importCSV(from url: URL) async {
        _ = await run { api in
            let accessing = url.startAccessingSecurityScopedResource()
            defer { if accessing { url.stopAccessingSecurityScopedResource() } }
            let result = try await api.importBodyCSV(try Data(contentsOf: url))
            let skipped = result.skipped.isEmpty ? "" : " · \(result.skipped.count) filas omitidas"
            self.notice = "\(result.imported) mediciones importadas\(skipped)"
        }
    }

    /// Apple Health weight and body-fat → Mac. The engine dedupes by HealthKit UUID, so re-sending is harmless.
    func syncHealth(quiet: Bool = false) async {
        guard HealthSync.available else { return }
        _ = await run(quiet: quiet) { api in
            try await BodyHealth.requestAccess()
            let written = try await api.syncBodySamples(try await BodyHealth.recentSamples())
            if !quiet { self.notice = "\(written) registros de Salud sincronizados" }
        }
    }

    func setGoal(_ metric: BodyMetric, target: Double?) async {
        _ = await run { api in _ = try await api.setBodyGoal(metric, target: target) }
    }

    /// Runs one write, then reloads the dashboard. Errors go to the app-wide handler unless `quiet`.
    private func run(quiet: Bool = false, _ work: (PulsoAPI) async throws -> Void) async -> Bool {
        guard let api = model.api else { return false }
        busy = true
        defer { busy = false }
        do {
            try await work(api)
            apply(try await api.bodyDashboard())
            return true
        } catch {
            if !quiet { model.handle(error) }
            return false
        }
    }

    private func apply(_ dashboard: BodyDashboard) {
        scans = dashboard.scans
        goals = dashboard.goals
        projections = Dictionary(uniqueKeysWithValues: dashboard.projections.map { ($0.metric, $0) })
    }
}
