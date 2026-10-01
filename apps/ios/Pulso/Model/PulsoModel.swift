import Foundation
import Observation
import UIKit

@MainActor
@Observable
final class PulsoModel {
    static let shared = PulsoModel()

    private(set) var credentials: Credentials? = CredentialStore.load()
    private(set) var workouts: [Workout] = []
    private(set) var pairing = false
    private(set) var syncing = false
    var pairingError: String?
    var error: String?
    var lastSync: String?

    /// Whether the Mac answered the last request. `unknown` until the first one.
    enum Reachability { case unknown, online, offline }
    private(set) var reachability: Reachability = .unknown
    private(set) var lastContact: Date?
    private(set) var latency: Duration?
    private(set) var checking = false

    var offline: Bool { credentials != nil && reachability == .offline }

    var api: PulsoAPI? { credentials.map { PulsoAPI(base: $0.baseURL, token: $0.token) } }

    func pair(address: String, code: String) async {
        let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let base = Pairing.baseURL(from: trimmed) else {
            pairingError = "La dirección debe ser como http://100.x.x.x:8090"
            return
        }
        guard Pairing.normalizeCode(code).count == Pairing.codeLength else {
            pairingError = "El código tiene ocho dígitos."
            return
        }
        pairing = true
        pairingError = nil
        defer { pairing = false }
        do {
            let name = UIDevice.current.name
            let paired = try await PulsoAPI.pair(base: base, code: Pairing.normalizeCode(code), name: name)
            let saved = Credentials(baseURL: base, deviceId: paired.deviceId, name: paired.name, token: paired.token)
            CredentialStore.save(saved)
            credentials = saved
            await refresh()
        } catch {
            CredentialStore.address = base.absoluteString
            pairingError = error.localizedDescription
        }
    }

    func unpair() {
        CredentialStore.clear()
        credentials = nil
        workouts = []
        reachability = .unknown
        lastContact = nil
        latency = nil
    }

    /// Every request through `PulsoAPI.perform` lands here: any HTTP answer is contact.
    func recordContact(latency: Duration) {
        reachability = .online
        lastContact = .now
        self.latency = latency
    }

    func recordUnreachable() {
        reachability = .offline
    }

    /// Pings the Mac (the offline banner's "Reintentar", Ajustes) and, if it is back, reloads.
    func checkConnection() async {
        guard let api, !checking else { return }
        checking = true
        defer { checking = false }
        do {
            _ = try await api.status()
            error = nil
            await refresh()
        } catch {
            handle(error)
        }
    }

    func refresh() async {
        guard let api else { return }
        do {
            workouts = try await api.workouts()
            error = nil
        } catch {
            handle(error)
        }
    }

    /// HealthKit → Mac. Sends the last 30 days; the engine dedupes by HealthKit UUID.
    func syncHealth() async {
        guard let api, HealthSync.available else {
            error = "Salud no está disponible en este dispositivo."
            return
        }
        syncing = true
        defer { syncing = false }
        do {
            try await HealthSync.requestAccess()
            let inputs = try await HealthSync.recentWorkouts()
            let written = try await api.sync(inputs)
            lastSync = "\(written) entrenamientos sincronizados"
            await refresh()
        } catch {
            handle(error)
        }
    }

    func handle(_ error: Error) {
        if let failure = error as? PulsoAPI.Failure, failure.kind == .unpaired {
            unpair()
            pairingError = failure.message
            return
        }
        self.error = error.localizedDescription
    }
}
