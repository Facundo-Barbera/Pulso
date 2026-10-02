import Foundation
import LocalAuthentication
import Observation

/// The app-wide Face ID lock. While `locked`, `LockCover` puts `LockScreen` in a
/// window above everything; the app underneath stays mounted (tabs, navigation,
/// sheets, the live workout's full-screen view), so unlocking returns the person
/// exactly where they were, and Coach replies, the Live Activity and reminders go on.
/// Also the authenticator for screens that ask again even when unlocked (Sustancias).
@MainActor
@Observable
final class AppLock {
    static let shared = AppLock()

    static let enabledKey = "pulso.lock.enabled"
    static let intervalKey = "pulso.lock.interval"

    private(set) var locked: Bool
    /// True while the system's Face ID or passcode sheet is up (the scene goes inactive meanwhile).
    private(set) var authenticating = false
    @ObservationIgnored private var backgroundedAt: Date?

    private init() {
        locked = Self.policy.shouldLock(coldLaunch: true, backgroundedAt: nil, now: .now) && Self.canLock
    }

    /// The person's choice in Ajustes: on, after 5 minutes, unless changed.
    static var policy: LockPolicy {
        let defaults = UserDefaults.standard
        let interval = (defaults.object(forKey: intervalKey) as? Int).flatMap(LockPolicy.Interval.init) ?? .default
        return LockPolicy(enabled: defaults.object(forKey: enabledKey) as? Bool ?? true, interval: interval)
    }

    /// Whether the device can authenticate the owner at all (it has a passcode).
    static var available: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    /// "Face ID", "Touch ID" or "código", for labels.
    static var methodName: String {
        switch biometry {
        case .touchID: "Touch ID"
        case .faceID: "Face ID"
        case .opticID: "Optic ID"
        default: "código"
        }
    }

    static var methodSymbol: String {
        switch biometry {
        case .touchID: "touchid"
        case .faceID: "faceid"
        case .opticID: "opticid"
        default: "lock.fill"
        }
    }

    private static var biometry: LABiometryType {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        return context.biometryType
    }

    /// Nothing to protect before pairing; and without a passcode a lock could never open.
    private static var canLock: Bool { PulsoModel.shared.credentials != nil && available }

    // MARK: Scene phases

    func enteredBackground(at now: Date = .now) {
        if backgroundedAt == nil { backgroundedAt = now }
    }

    /// Locks if the app was away long enough. Returns whether it just locked.
    @discardableResult
    func becameActive(at now: Date = .now, liveSession: Bool = false) -> Bool {
        defer { backgroundedAt = nil }
        guard !locked, Self.canLock,
              Self.policy.shouldLock(coldLaunch: false, backgroundedAt: backgroundedAt, now: now, liveSession: liveSession)
        else { return false }
        locked = true
        return true
    }

    // MARK: Authentication

    func unlock() async {
        guard locked, !authenticating else { return }
        if await authenticate(reason: "Desbloquea Pulso para ver tus datos.") { locked = false }
    }

    /// Face ID / Touch ID with the passcode as fallback. False when cancelled or failed.
    /// A device without a passcode can't prove anything, so it is let through.
    func authenticate(reason: String) async -> Bool {
        guard !authenticating else { return false }
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            return error?.code == LAError.Code.passcodeNotSet.rawValue
        }
        authenticating = true
        defer { authenticating = false }
        do {
            return try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
        } catch {
            return false
        }
    }
}
