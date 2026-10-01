import ActivityKit
import SwiftUI
import WidgetKit

@main
struct PulsoActivityBundle: WidgetBundle {
    var body: some Widget {
        TrainingLiveActivity()
    }
}

/// Same purple as `Theme.training` in the app.
private let training = Color(red: 0.55, green: 0.42, blue: 0.98)

/// The strength session on the lock screen and in the Dynamic Island: the
/// exercise and set coming up, and while resting a countdown that the system
/// ticks on its own (no app updates needed).
struct TrainingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TrainingActivityAttributes.self) { context in
            LockScreenView(state: context.state, attributes: context.attributes)
                .activityBackgroundTint(Color.black.opacity(0.55))
                .activitySystemActionForegroundColor(training)
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "figure.strengthtraining.traditional")
                        .font(.title2)
                        .foregroundStyle(training)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let range = state.restRange, state.resting {
                        Text(timerInterval: range, countsDown: true)
                            .font(.title2.bold().monospacedDigit())
                            .fontDesign(.rounded)
                            .foregroundStyle(training)
                            .multilineTextAlignment(.trailing)
                            .frame(maxWidth: 80)
                    } else {
                        Text("\(state.setsDone)/\(state.setsTotal)")
                            .font(.title3.bold().monospacedDigit())
                            .fontDesign(.rounded)
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(state.exerciseName).font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 8) {
                        HStack {
                            Text(state.setLabel)
                            Spacer()
                            Text(state.target).fontWeight(.semibold).foregroundStyle(training)
                        }
                        .font(.subheadline)
                        if let range = state.restRange, state.resting {
                            ProgressView(timerInterval: range, countsDown: true) { EmptyView() } currentValueLabel: { EmptyView() }
                                .tint(training)
                        }
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Image(systemName: state.resting ? "timer" : "dumbbell.fill")
                    .foregroundStyle(training)
            } compactTrailing: {
                if let range = state.restRange, state.resting {
                    Text(timerInterval: range, countsDown: true)
                        .monospacedDigit()
                        .foregroundStyle(training)
                        .frame(maxWidth: 44)
                } else {
                    Text("\(state.setsDone)/\(state.setsTotal)").monospacedDigit()
                }
            } minimal: {
                if let range = state.restRange, state.resting {
                    ProgressView(timerInterval: range, countsDown: true) { EmptyView() } currentValueLabel: { EmptyView() }
                        .progressViewStyle(.circular)
                        .tint(training)
                } else {
                    Image(systemName: "dumbbell.fill").foregroundStyle(training)
                }
            }
            .keylineTint(training)
        }
    }
}

private struct LockScreenView: View {
    let state: TrainingActivityAttributes.ContentState
    let attributes: TrainingActivityAttributes

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: "figure.strengthtraining.traditional")
                    .font(.title2)
                    .foregroundStyle(training)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(training.opacity(0.2)))
                VStack(alignment: .leading, spacing: 2) {
                    Text(state.exerciseName).font(.headline).lineLimit(1)
                    HStack(spacing: 6) {
                        Text(state.setLabel)
                        if !state.target.isEmpty {
                            Text("·")
                            Text(state.target).fontWeight(.semibold).foregroundStyle(training)
                        }
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                if let range = state.restRange, state.resting {
                    VStack(alignment: .trailing, spacing: 0) {
                        Text("Descanso").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                        Text(timerInterval: range, countsDown: true)
                            .font(.system(size: 34, weight: .bold, design: .rounded).monospacedDigit())
                            .foregroundStyle(training)
                            .multilineTextAlignment(.trailing)
                            .frame(maxWidth: 110, alignment: .trailing)
                    }
                } else {
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(attributes.startedAt, style: .timer)
                            .font(.title3.bold().monospacedDigit())
                            .fontDesign(.rounded)
                            .multilineTextAlignment(.trailing)
                            .frame(maxWidth: 90, alignment: .trailing)
                        Text("\(state.setsDone)/\(state.setsTotal) series").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if let range = state.restRange, state.resting {
                ProgressView(timerInterval: range, countsDown: true) { EmptyView() } currentValueLabel: { EmptyView() }
                    .tint(training)
            } else {
                ProgressView(value: Double(state.setsDone), total: Double(max(1, state.setsTotal)))
                    .tint(training)
            }
        }
        .padding(16)
    }
}
