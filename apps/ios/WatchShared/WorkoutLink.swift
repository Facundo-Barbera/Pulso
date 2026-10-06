import Foundation
import HealthKit

// What the phone and the Watch say to each other over the mirrored workout
// session (`sendToRemoteWorkoutSession(data:)`). Compiled into both apps.

/// The kind of workout the Watch records: strength, or a cardio block's type.
/// A stage change ends the Watch's workout and starts the next one, so Fitness
/// shows each as its own workout ("Fuerza tradicional", "Caminata en interior").
struct WorkoutStage: Codable, Hashable, Sendable {
    /// `HKWorkoutActivityType.rawValue`.
    var activity: UInt
    var indoor: Bool

    static let strength = WorkoutStage(activity: HKWorkoutActivityType.traditionalStrengthTraining.rawValue, indoor: true)

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

/// Phone → Watch.
enum WatchCommand: Codable, Sendable {
    case pause
    case resume
    /// End the workout in progress and start one of this kind.
    case stage(WorkoutStage)
    /// End and save (the session finished), or end and throw away (discarded).
    case end(save: Bool)
}

/// Watch → phone: the live numbers, a few times a second at most.
struct WatchMetrics: Codable, Equatable, Sendable {
    var stage: WorkoutStage
    var heartRate: Double?
    /// This workout's active energy so far, kcal.
    var activeKcal: Double
    /// This workout's distance so far, meters (walking, running, cycling).
    var distanceMeters: Double?
    var paused: Bool
}

enum WatchMessage: Codable, Sendable {
    case command(WatchCommand)
    case metrics(WatchMetrics)
    /// Watch → phone: nothing is recording anymore.
    case stopped

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
