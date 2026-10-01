import Foundation

/// What the person types or pastes on the pairing step, cleaned up before it reaches the Mac.
enum Pairing {
    static let codeLength = 8

    /// Keeps the first eight digits of whatever was typed or pasted: "1234 5678",
    /// "1234-5678" and "Código: 12345678" all become "12345678". Digits from other
    /// scripts (e.g. "١٢") count as their Western value.
    static func normalizeCode(_ raw: String) -> String {
        String(raw.compactMap { char in
            char.wholeNumberValue.flatMap { (0...9).contains($0) ? Character(String($0)) : nil }
        }.prefix(codeLength))
    }

    /// The Mac's address as a base URL. Accepts "100.1.2.3:8090" without a scheme and
    /// drops a trailing slash; nil when it can't be an http(s) host.
    static func baseURL(from raw: String) -> URL? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.contains("://") { text = "http://" + text }
        while text.hasSuffix("/") && !text.hasSuffix("://") { text.removeLast() }
        guard let url = URL(string: text),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host(), !host.isEmpty
        else { return nil }
        return url
    }
}
