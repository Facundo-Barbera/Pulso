import AppIntents
import SwiftUI
import WidgetKit

@main
struct PulsoWidgetsBundle: WidgetBundle {
    var body: some Widget {
        RecoveryWidget()
        MacrosWidget()
        NextDoseWidget()
        NextWorkoutWidget()
        TakeDoseControl()
    }
}

/// Control Center / Lock Screen / Action button: "Tomé mi medicación".
struct TakeDoseControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: WidgetKind.takeDoseControl) {
            ControlWidgetButton(action: TakeNextDoseIntent()) {
                Label("Tomé mi medicación", systemImage: "pills.fill")
            }
        }
        .displayName("Tomé mi medicación")
        .description("Marca como tomada tu próxima dosis pendiente.")
    }
}
