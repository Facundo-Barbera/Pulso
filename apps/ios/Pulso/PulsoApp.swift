import SwiftUI

@main
struct PulsoApp: App {
    init() {
        // A notification that launches the app (and the dose actions "Tomada", "Posponer") only arrives if the delegate is set at launch.
        NotificationRouter.shared.activate()
        MedicationNotifications.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            RootView(model: PulsoModel.shared)
        }
    }
}
