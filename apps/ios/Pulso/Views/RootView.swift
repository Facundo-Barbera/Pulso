import SwiftUI

/// Paired: the workouts. Not paired: the pairing screen and nothing else.
struct RootView: View {
    let model: PulsoModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            if model.credentials == nil {
                PairView(model: model)
            } else {
                WorkoutsView(model: model)
            }
        }
        .task { await model.refresh() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.refresh() } }
        }
    }
}
