import Foundation

/// When Pulso asks for Face ID: on a cold launch, and on coming back after
/// being in the background for at least the chosen interval. Pure, so the
/// rules are tested without LocalAuthentication.
struct LockPolicy: Equatable {
    enum Interval: Int, CaseIterable, Identifiable {
        case immediately = 0
        case oneMinute = 60
        case fiveMinutes = 300
        case fifteenMinutes = 900

        static let `default` = Interval.fiveMinutes

        var id: Int { rawValue }
        var seconds: TimeInterval { TimeInterval(rawValue) }

        var label: String {
            switch self {
            case .immediately: "Inmediatamente"
            case .oneMinute: "Después de 1 minuto"
            case .fiveMinutes: "Después de 5 minutos"
            case .fifteenMinutes: "Después de 15 minutos"
            }
        }
    }

    var enabled: Bool
    var interval: Interval

    /// `backgroundedAt` is when the app last went to the background (nil if it
    /// only went inactive: Control Center, a system alert, the Face ID sheet).
    func shouldLock(coldLaunch: Bool, backgroundedAt: Date?, now: Date) -> Bool {
        guard enabled else { return false }
        if coldLaunch { return true }
        guard let backgroundedAt else { return false }
        let away = now.timeIntervalSince(backgroundedAt)
        // A clock that went backwards can't be trusted to measure the interval.
        if away < 0 { return true }
        return away >= interval.seconds
    }
}
