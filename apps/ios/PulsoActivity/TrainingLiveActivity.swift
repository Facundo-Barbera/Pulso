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
            Group {
                if let cardio = context.state.cardio {
                    CardioLockScreenView(state: context.state, cardio: cardio)
                } else {
                    LockScreenView(state: context.state, attributes: context.attributes)
                }
            }
                .activityBackgroundTint(Color.black.opacity(0.55))
                .activitySystemActionForegroundColor(training)
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: state.cardio == nil ? "figure.strengthtraining.traditional" : "heart.fill")
                        .font(.title2)
                        .foregroundStyle(state.cardio.map(cardioTint) ?? training)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let cardio = state.cardio {
                        CardioTime(cardio: cardio)
                            .font(.title2.bold().monospacedDigit())
                            .fontDesign(.rounded)
                            .foregroundStyle(cardioTint(cardio))
                            .multilineTextAlignment(.trailing)
                            .frame(maxWidth: 90)
                    } else if let range = state.restRange, state.resting {
                        Text(timerInterval: range, countsDown: true)
                            .font(.title2.bold().monospacedDigit())
                            .fontDesign(.rounded)
                            .foregroundStyle(training)
                            .multilineTextAlignment(.trailing)
                            .frame(maxWidth: 80)
                    } else if let weight = state.weight {
                        VStack(alignment: .trailing, spacing: 0) {
                            Text(weight)
                                .font(.title3.bold().monospacedDigit())
                                .foregroundStyle(training)
                            Text("\(state.setsDone)/\(state.setsTotal) series").font(.caption).foregroundStyle(.secondary)
                        }
                        .fontDesign(.rounded)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
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
                            Text(state.cardio.map { "\($0.phase) · \($0.detail)" } ?? state.setLabel)
                            Spacer(minLength: 8)
                            Text(state.target).fontWeight(.semibold).foregroundStyle(training)
                        }
                        .font(.subheadline)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        if let range = state.cardio?.phaseRange {
                            ProgressView(timerInterval: range, countsDown: true) { EmptyView() } currentValueLabel: { EmptyView() }
                                .tint(state.cardio.map(cardioTint) ?? training)
                        } else if let range = state.restRange, state.resting {
                            ProgressView(timerInterval: range, countsDown: true) { EmptyView() } currentValueLabel: { EmptyView() }
                                .tint(training)
                        }
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Image(systemName: state.cardio != nil ? "heart.fill" : state.resting ? "timer" : "dumbbell.fill")
                    .foregroundStyle(state.cardio.map(cardioTint) ?? training)
            } compactTrailing: {
                if let cardio = state.cardio {
                    CardioTime(cardio: cardio)
                        .monospacedDigit()
                        .foregroundStyle(cardioTint(cardio))
                        .frame(maxWidth: 44)
                } else if let range = state.restRange, state.resting {
                    Text(timerInterval: range, countsDown: true)
                        .monospacedDigit()
                        .foregroundStyle(training)
                        .frame(maxWidth: 44)
                } else if let weight = state.weight {
                    // The load on the machine is what matters between sets: "70 lb".
                    Text(weight)
                        .monospacedDigit()
                        .foregroundStyle(training)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .frame(maxWidth: 64)
                } else {
                    Text("\(state.setsDone)/\(state.setsTotal)").monospacedDigit()
                }
            } minimal: {
                if let cardio = state.cardio {
                    if let range = cardio.phaseRange {
                        ProgressView(timerInterval: range, countsDown: true) { EmptyView() } currentValueLabel: { EmptyView() }
                            .progressViewStyle(.circular)
                            .tint(cardioTint(cardio))
                    } else {
                        Image(systemName: "heart.fill").foregroundStyle(cardioTint(cardio))
                    }
                } else if let range = state.restRange, state.resting {
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

/// Same orange and green as `Theme.energy` / `Theme.body`: work and recovery.
private let work = Color(red: 0.98, green: 0.45, blue: 0.20)
private let recovery = Color(red: 0.20, green: 0.78, blue: 0.62)

private func cardioTint(_ cardio: TrainingActivityAttributes.ContentState.Cardio) -> Color { cardio.work ? work : recovery }

/// The phase counting down when there is one, else the block's time counting up
/// (or standing still while paused). The system ticks both.
private struct CardioTime: View {
    let cardio: TrainingActivityAttributes.ContentState.Cardio

    var body: some View {
        if let range = cardio.phaseRange {
            Text(timerInterval: range, countsDown: true)
        } else if let from = cardio.elapsedFrom {
            Text(from, style: .timer)
        } else {
            Text(Duration.seconds(cardio.elapsedSeconds).formatted(.time(pattern: cardio.elapsedSeconds >= 3600 ? .hourMinuteSecond : .minuteSecond)))
        }
    }
}

/// A cardio block: "Rápido" big with its countdown, the round and zone, and the phase draining.
private struct CardioLockScreenView: View {
    let state: TrainingActivityAttributes.ContentState
    let cardio: TrainingActivityAttributes.ContentState.Cardio

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: cardio.running ? "heart.fill" : "pause.fill")
                    .font(.title2)
                    .foregroundStyle(cardioTint(cardio))
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(cardioTint(cardio).opacity(0.2)))
                VStack(alignment: .leading, spacing: 2) {
                    Text(cardio.phase).font(.headline).foregroundStyle(cardioTint(cardio))
                    Text(state.exerciseName).font(.subheadline).foregroundStyle(.secondary)
                    if !cardio.detail.isEmpty {
                        Text(cardio.detail).font(.subheadline.weight(.semibold))
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                Spacer(minLength: 8)
                CardioTime(cardio: cardio)
                    .font(.system(size: 34, weight: .bold, design: .rounded).monospacedDigit())
                    .foregroundStyle(cardioTint(cardio))
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 110, alignment: .trailing)
            }
            if let range = cardio.phaseRange {
                ProgressView(timerInterval: range, countsDown: true) { EmptyView() } currentValueLabel: { EmptyView() }
                    .tint(cardioTint(cardio))
            }
        }
        .padding(16)
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
                // On a 375 pt lock screen this column gets ~130 pt beside the timer: "Serie 3 de 4 ·
                // 12 × 80 kg" wrapped to three lines and the activity got clipped. Target on its own line.
                VStack(alignment: .leading, spacing: 2) {
                    Text(state.exerciseName).font(.headline).minimumScaleFactor(0.8)
                    Text(state.setLabel).font(.subheadline).foregroundStyle(.secondary)
                    if !state.target.isEmpty {
                        Text(state.target).font(.subheadline.weight(.semibold)).foregroundStyle(training)
                    }
                }
                .lineLimit(1)
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
                        Text("\(state.setsDone)/\(state.setsTotal) series").font(.caption).foregroundStyle(.secondary).lineLimit(1)
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
