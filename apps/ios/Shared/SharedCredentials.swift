import Foundation
import Security

/// The pairing, mirrored by the app into a Keychain access group the widget
/// extension shares (`PulsoKeychainGroup` Info key = `<team>.<app bundle id>.shared`).
/// The app's own token stays where pairing put it; this copy only lets the
/// widgets and their buttons reach the engine while the app is closed.
struct SharedCredentials: Codable, Equatable {
    var baseURL: URL
    var token: String

    private static let service = "pulso.shared"
    private static let account = "pairing"
    private static var group: String? {
        (Bundle.main.object(forInfoDictionaryKey: "PulsoKeychainGroup") as? String).flatMap { $0.isEmpty ? nil : $0 }
    }

    private static func query() -> [String: Any]? {
        guard let group else { return nil }
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: group,
        ]
    }

    static func load() -> SharedCredentials? {
        guard var item = query() else { return nil }
        item[kSecReturnData as String] = true
        item[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(item as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(SharedCredentials.self, from: data)
    }

    /// Writes only when it changed; `nil` forgets the pairing.
    static func mirror(_ credentials: SharedCredentials?) {
        guard let base = query() else { return }
        guard let credentials else {
            SecItemDelete(base as CFDictionary)
            return
        }
        guard load() != credentials, let data = try? JSONEncoder().encode(credentials) else { return }
        SecItemDelete(base as CFDictionary)
        var item = base
        item[kSecValueData as String] = data
        // Widgets refresh with the phone locked.
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }
}
