import Foundation
import HealthKit

// What the phone and the Watch say to each other, over the mirrored workout
// session or WatchConnectivity (WatchChannel). Compiled into both apps.

/// The kind of workout the Watch records: strength, or a cardio block's type.
/// The Watch follows the session: a running cardio clock is that block's stage,
/// anything else is strength.
struct WorkoutStage: Codable, Hashable, Sendable {
    /// `HKWorkoutActivityType.rawValue`.
    var activity: UInt
    var indoor: Bool

    static let strength = WorkoutStage(activity: HKWorkoutActivityType.traditionalStrengthTraining.rawValue, indoor: true)

    /// A cardio block's kind, from the contract's `CardioModality`. On the
    /// treadmill ("caminadora"), a walk unless the target is a running pace.
    static func cardio(_ modality: String?, speedKmh: Double?) -> WorkoutStage {
        let (activity, indoor): (HKWorkoutActivityType, Bool) = switch modality {
        case "treadmill": ((speedKmh ?? 0) >= runningKmh ? .running : .walking, true)
        case "elliptical": (.elliptical, true)
        case "bike": (.cycling, true)
        case "rower": (.rowing, true)
        case "stairs": (.stairClimbing, true)
        case "run": (.running, false)
        case "walk": (.walking, false)
        case "jump_rope": (.jumpRope, true)
        case "hiit": (.highIntensityIntervalTraining, true)
        default: (.mixedCardio, true)
        }
        return WorkoutStage(activity: activity.rawValue, indoor: indoor)
    }

    /// From here up a treadmill target is a run.
    static let runningKmh = 7.5

    /// Walking and running: steps and cadence are worth showing.
    var countsSteps: Bool { [.walking, .running, .hiking].contains(activityType) }

    var activityType: HKWorkoutActivityType { HKWorkoutActivityType(rawValue: activity) ?? .traditionalStrengthTraining }

    var configuration: HKWorkoutConfiguration {
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = activityType
        configuration.locationType = indoor ? .indoor : .outdoor
        return configuration
    }

    init(activity: UInt, indoor: Bool) {
        self.activity = activity
        self.indoor = indoor
    }

    init(_ configuration: HKWorkoutConfiguration) {
        self.init(activity: configuration.activityType.rawValue, indoor: configuration.locationType != .outdoor)
    }

    /// "Fuerza", "Caminata", "Carrera"…: what the Watch's screen calls it.
    var title: String {
        switch activityType {
        case .traditionalStrengthTraining, .functionalStrengthTraining: "Fuerza"
        case .walking: "Caminata"
        case .running: "Carrera"
        case .cycling: "Bici"
        case .elliptical: "Elíptica"
        case .rowing: "Remo"
        case .stairClimbing: "Escaladora"
        case .jumpRope: "Comba"
        case .highIntensityIntervalTraining: "HIIT"
        default: "Cardio"
        }
    }

    var symbol: String {
        switch activityType {
        case .traditionalStrengthTraining, .functionalStrengthTraining: "dumbbell.fill"
        case .walking: "figure.walk"
        case .running: "figure.run"
        case .cycling: "figure.indoor.cycle"
        case .elliptical: "figure.elliptical"
        case .rowing: "figure.rower"
        case .stairClimbing: "figure.stair.stepper"
        case .jumpRope: "figure.jumprope"
        default: "figure.mixed.cardio"
        }
    }
}

/// Watch → phone: the live numbers, a few times a second at most.
struct WatchMetrics: Codable, Equatable, Sendable {
    var stage: WorkoutStage
    var heartRate: Double?
    /// This workout's active energy so far, kcal.
    var activeKcal: Double
    /// This stage's distance so far, meters (walking, running, cycling).
    var distanceMeters: Double?
    var paused: Bool
    /// Active plus resting energy, kcal: Fitness's "calorías totales".
    var totalKcal: Double? = nil
    var averageHeartRate: Double? = nil
    /// This stage's steps (walking, running).
    var steps: Double? = nil
    /// This stage's average pace, seconds per km.
    var paceSecondsPerKm: Double? = nil
    /// Steps per minute over this stage.
    var cadence: Double? = nil
}

extension HrZoneRange {
    /// The zone `bpm` falls in, by the person's zones.
    static func zone(of bpm: Double?, in zones: [HrZoneRange]?) -> Int? {
        guard let bpm = bpm.map({ Int($0.rounded()) }) else { return nil }
        return zones?.first { bpm >= $0.minBpm && bpm <= $0.maxBpm }?.zone
    }
}

enum WatchMessage: Codable, Sendable {
    /// Watch → phone: the numbers it measures.
    case metrics(WatchMetrics)
    /// Watch → phone: nothing is recording anymore.
    case stopped
    /// Phone → Watch: the session (see SessionSync.swift).
    case sync(WatchSync)
    /// Watch → phone: what changed on the Watch.
    case edits([WatchEdit])

    func encoded() throws -> Data { try JSONEncoder().encode(self) }

    static func decode(_ data: Data) -> WatchMessage? { try? JSONDecoder().decode(WatchMessage.self, from: data) }
}

extension HKWorkoutActivityType {
    /// Distance recorded for this kind of workout, if any.
    var distanceType: HKQuantityType? {
        switch self {
        case .running, .walking, .hiking: HKQuantityType(.distanceWalkingRunning)
        case .cycling: HKQuantityType(.distanceCycling)
        case .rowing: HKQuantityType(.distanceRowing)
        default: nil
        }
    }
}
