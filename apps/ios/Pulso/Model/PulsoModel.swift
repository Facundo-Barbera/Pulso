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

    private var api: PulsoAPI? { credentials.map { PulsoAPI(base: $0.baseURL, token: $0.token) } }

    func pair(address: String, code: String) async {
        let trimmed = address.trimmingCharacters(in: .whitespaces)
        guard let base = URL(string: trimmed), base.scheme == "http" || base.scheme == "https" else {
            pairingError = "La dirección debe ser como http://100.x.x.x:8090"
            return
        }
        pairing = true
        pairingError = nil
        defer { pairing = false }
        do {
            let name = UIDevice.current.name
            let paired = try await PulsoAPI.pair(base: base, code: code, name: name)
            let saved = Credentials(baseURL: base, deviceId: paired.deviceId, name: paired.name, token: paired.token)
            CredentialStore.save(saved)
            credentials = saved
            await refresh()
        } catch {
            CredentialStore.address = trimmed
            pairingError = error.localizedDescription
        }
    }

    func unpair() {
        CredentialStore.clear()
        credentials = nil
        workouts = []
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

    private func handle(_ error: Error) {
        if let failure = error as? PulsoAPI.Failure, failure.kind == .unpaired {
            unpair()
            pairingError = failure.message
            return
        }
        self.error = error.localizedDescription
    }
}
