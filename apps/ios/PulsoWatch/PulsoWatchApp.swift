import HealthKit
import SwiftUI
import WatchKit

@main
struct PulsoWatchApp: App {
    @WKApplicationDelegateAdaptor private var delegate: WatchAppDelegate

    var body: some Scene {
        WindowGroup {
            WorkoutView(manager: .shared)
        }
    }
}

/// Where the phone's "Iniciar" lands (`startWatchApp`), and where a workout
/// the system kept going after the app was killed comes back.
final class WatchAppDelegate: NSObject, WKApplicationDelegate {
    func applicationDidFinishLaunching() {
        Task { @MainActor in WorkoutManager.shared.listen() }
    }

    func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
        let stage = WorkoutStage(workoutConfiguration)
        Task { @MainActor in await WorkoutManager.shared.start(stage) }
    }

    func handleActiveWorkoutRecovery() {
        Task { @MainActor in await WorkoutManager.shared.recover() }
    }
}
