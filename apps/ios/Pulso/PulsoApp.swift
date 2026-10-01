import SwiftUI

@main
struct PulsoApp: App {
    init() {
        // Dose reminder actions ("Tomada", "Posponer") tapped while the app is closed only arrive if the delegate is set at launch.
        MedicationNotifications.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            RootView(model: PulsoModel.shared)
        }
    }
}
