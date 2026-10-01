import ActivityKit
import Foundation

/// The live strength session on the lock screen and in the Dynamic Island.
/// Compiled into both the app and the PulsoActivity extension.
struct TrainingActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var exerciseName: String
        /// "Serie 2 de 4"
        var setLabel: String
        /// "80 kg × 8"
        var target: String
        var setsDone: Int
        var setsTotal: Int
        /// Set while resting; the countdown runs from `restStartedAt` to `restEndsAt`.
        var restStartedAt: Date?
        var restEndsAt: Date?

        var resting: Bool { restEndsAt.map { $0 > .now } ?? false }
        var restRange: ClosedRange<Date>? {
            guard let restStartedAt, let restEndsAt, restEndsAt > restStartedAt else { return nil }
            return restStartedAt...restEndsAt
        }
    }

    var sessionName: String
    var startedAt: Date
}
