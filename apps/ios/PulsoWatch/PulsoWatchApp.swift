import HealthKit
import SwiftUI
import WatchKit

@main
struct PulsoWatchApp: App {
    @WKApplicationDelegateAdaptor private var delegate: WatchAppDelegate

    var body: some Scene {
        WindowGroup {
            SessionView(store: .shared, workout: .shared)
        }
    }
}

/// Where the phone's "Iniciar" lands (`startWatchApp`), and where a workout
/// the system kept going after the app was killed comes back.
final class WatchAppDelegate: NSObject, WKApplicationDelegate {
    func applicationDidFinishLaunching() {
        Task { @MainActor in WatchSessionStore.shared.listen() }
    }

    /// The phone started a session: record at once; its copy follows by WatchConnectivity.
    func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
        let stage = WorkoutStage(workoutConfiguration)
        Task { @MainActor in await WorkoutManager.shared.follow(stage) }
    }

    func handleActiveWorkoutRecovery() {
        Task { @MainActor in await WorkoutManager.shared.recover() }
    }
}
