import SwiftUI
import WidgetKit

/// Siguiente entreno: the program day that comes next. Tapping opens the app.
struct NextWorkoutWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKind.nextWorkout, provider: SnapshotProvider()) { entry in
            NextWorkoutWidgetView(entry: entry)
        }
        .configurationDisplayName("Siguiente entreno")
        .description("El día de tu programa que te toca ahora.")
        .supportedFamilies([.systemSmall, .accessoryRectangular, .accessoryInline])
    }
}

struct NextWorkoutWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    private var workout: WidgetSnapshot.Workout? { entry.snapshot?.workout }

    var body: some View {
        switch family {
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Label("Siguiente entreno", systemImage: "dumbbell.fill").font(.caption.weight(.semibold))
                Text(workout?.dayName ?? "Sin programa").font(.headline).lineLimit(1).widgetAccentable()
                if let workout { Text(exercisesText(workout)).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .containerBackground(for: .widget) {}
        case .accessoryInline:
            Label(workout.map { "Entreno: \($0.dayName)" } ?? "Sin programa activo", systemImage: "dumbbell.fill")
                .containerBackground(for: .widget) {}
        default:
            small.pulsoBackground(Theme.training)
        }
    }

    @ViewBuilder private var small: some View {
        if let workout {
            // A small widget is ~123 pt tall inside on a 375 pt phone; header, a title-size icon, a
            // two-line name, focus and count stacked needed ~140 and clipped. The icon moves to the count line.
            VStack(alignment: .leading, spacing: 4) {
                WidgetHeader(title: "Siguiente entreno", systemImage: "dumbbell.fill", color: Theme.training)
                Spacer(minLength: 0)
                Text(workout.dayName).font(.title3.weight(.bold)).fontDesign(.rounded).lineLimit(2).minimumScaleFactor(0.7)
                if let focus = workout.focus, !focus.isEmpty {
                    Text(focus).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
                Label(exercisesText(workout), systemImage: "figure.strengthtraining.traditional")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Theme.training)
                    .lineLimit(1)
            }
        } else {
            WidgetEmpty(
                systemImage: "dumbbell",
                text: entry.paired ? "Pedile un programa al Coach" : WidgetStyle.unpaired,
                color: Theme.training
            )
        }
    }

    private func exercisesText(_ workout: WidgetSnapshot.Workout) -> String {
        workout.exercises == 1 ? "1 ejercicio" : "\(workout.exercises) ejercicios"
    }
}

#Preview(as: .systemSmall) {
    NextWorkoutWidget()
} timeline: {
    SnapshotEntry(date: .now, snapshot: .preview, paired: true)
}

#Preview(as: .accessoryRectangular) {
    NextWorkoutWidget()
} timeline: {
    SnapshotEntry(date: .now, snapshot: .preview, paired: true)
}
