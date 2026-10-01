import SwiftUI

@main
struct PulsoApp: App {
    var body: some Scene {
        WindowGroup {
            RootView(model: PulsoModel.shared)
        }
    }
}
