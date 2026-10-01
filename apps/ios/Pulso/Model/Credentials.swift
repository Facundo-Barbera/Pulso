import Foundation

/// What pairing left on this phone: the token in the Keychain, the address and
/// ids in UserDefaults (not secrets, and the pairing screen shows the last address).
struct Credentials: Equatable {
    var baseURL: URL
    var deviceId: String
    var name: String
    var token: String
}

enum CredentialStore {
    private static let defaults = UserDefaults.standard
    private static let addressKey = "pulso.address"
    private static let deviceKey = "pulso.deviceId"
    private static let nameKey = "pulso.deviceName"
    private static let tokenAccount = "token"

    /// The Mac's tailnet proxy. Editable on the pairing screen.
    static let defaultAddress = "http://100.110.136.102:8090"

    static var address: String {
        get { defaults.string(forKey: addressKey) ?? defaultAddress }
        set { defaults.set(newValue, forKey: addressKey) }
    }

    static func load() -> Credentials? {
        guard let base = URL(string: address),
              let deviceId = defaults.string(forKey: deviceKey),
              let token = Keychain.readString(tokenAccount)
        else { return nil }
        return Credentials(baseURL: base, deviceId: deviceId, name: defaults.string(forKey: nameKey) ?? "iPhone", token: token)
    }

    static func save(_ credentials: Credentials) {
        address = credentials.baseURL.absoluteString
        defaults.set(credentials.deviceId, forKey: deviceKey)
        defaults.set(credentials.name, forKey: nameKey)
        Keychain.write(credentials.token, account: tokenAccount)
    }

    /// Forgets the pairing but keeps the address: the next pairing is to the same Mac.
    static func clear() {
        defaults.removeObject(forKey: deviceKey)
        defaults.removeObject(forKey: nameKey)
        Keychain.delete(tokenAccount)
    }
}
