import Foundation

/// The only ways in are the profile button's menu and a row in Ajustes, and both
/// go through here: a fresh Face ID check every time, even with the app unlocked.
enum SubstancesAccess {
    /// Neutral on purpose: it shows in menus and Ajustes.
    static let symbol = SubstanceStyle.symbol

    @MainActor
    static func confirm() async -> Bool {
        await AppLock.shared.authenticate(reason: "Confirma que eres tú para continuar.")
    }
}
