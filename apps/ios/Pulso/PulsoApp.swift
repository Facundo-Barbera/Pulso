import SwiftUI

@main
struct PulsoApp: App {
    init() {
        // A notification that launches the app (and the dose actions "Tomada", "Posponer") only arrives if the delegate is set at launch.
        NotificationRouter.shared.activate()
        MedicationNotifications.shared.activate()
        // The Watch's workout is mirrored back only to an app listening from launch.
        WatchLink.shared.activate()
        #if DEBUG
        // `-pulsoStartWatch`: starts the Watch for the session in progress (or a new one of
        // the next day), to try the link on simulators, where tapping through is awkward.
        if CommandLine.arguments.contains("-pulsoStartWatch") {
            Task { @MainActor in
                let store = TrainingStore.shared
                if let live = store.live {
                    WatchLink.shared.start(sessionId: live.state.id)
                } else {
                    await store.load()
                    if let day = store.nextDay { store.start(day) }
                }
            }
        }
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView(model: PulsoModel.shared)
        }
    }
}
