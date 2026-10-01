import ActivityKit
import Foundation

/// The live strength session on the lock screen and in the Dynamic Island.
/// Compiled into both the app and the PulsoActivity extension.
struct TrainingActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var exerciseName: String
        /// "Serie 2 de 4"
        var setLabel: String
        /// "80 kg, 8 repeticiones", "70 lb, 8 repeticiones": the load in the exercise's unit.
        var target: String
        var setsDone: Int
        var setsTotal: Int
        /// Set while resting; the countdown runs from `restStartedAt` to `restEndsAt`.
        var restStartedAt: Date?
        var restEndsAt: Date?
        /// Set while a cardio block is on screen. Optional so either side of an update decodes the other.
        var cardio: Cardio? = nil
        /// The next set's load in its exercise's unit, "70 lb"; nil without one. Optional for older builds.
        var weight: String? = nil

        var resting: Bool { restEndsAt.map { $0 > .now } ?? false }
        var restRange: ClosedRange<Date>? {
            guard let restStartedAt, let restEndsAt, restEndsAt > restStartedAt else { return nil }
            return restStartedAt...restEndsAt
        }

        /// A cardio block: the interval phase counting down, else the block's time counting up.
        struct Cardio: Codable, Hashable {
            /// "Rápido", "Suave" or the block's name.
            var phase: String
            /// "Ronda 3 de 8", "Z2 · 118–137 ppm"
            var detail: String
            /// Running: the block's elapsed time counts up from here. Nil while paused.
            var elapsedFrom: Date?
            /// Elapsed seconds, shown as is while paused.
            var elapsedSeconds: Double
            var phaseStartedAt: Date?
            var phaseEndsAt: Date?
            /// True in the work part of an interval.
            var work: Bool

            var running: Bool { elapsedFrom != nil }
            var phaseRange: ClosedRange<Date>? {
                guard running, let phaseStartedAt, let phaseEndsAt, phaseEndsAt > phaseStartedAt, phaseEndsAt > .now else { return nil }
                return phaseStartedAt...phaseEndsAt
            }
        }
    }

    var sessionName: String
    var startedAt: Date
}
