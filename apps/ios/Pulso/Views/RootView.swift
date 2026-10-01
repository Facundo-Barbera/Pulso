import SwiftUI

/// Paired: five tabs, one per feature folder under `Features/`. Not paired:
/// the pairing screen and nothing else.
struct RootView: View {
    let model: PulsoModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if model.credentials == nil {
                NavigationStack { PairView(model: model) }
            } else {
                TabView {
                    Tab("Hoy", systemImage: "sun.max") {
                        NavigationStack { TodayView(model: model) }
                    }
                    Tab("Coach", systemImage: "sparkles") {
                        NavigationStack { CoachView(model: model) }
                    }
                    Tab("Entreno", systemImage: "dumbbell") {
                        NavigationStack { TrainingView(model: model) }
                    }
                    Tab("Dieta", systemImage: "fork.knife") {
                        NavigationStack { NutritionView(model: model) }
                    }
                    Tab("Cuerpo", systemImage: "figure") {
                        NavigationStack { BodyView(model: model) }
                    }
                }
            }
        }
        .task { await model.refresh() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.refresh() } }
        }
    }
}
