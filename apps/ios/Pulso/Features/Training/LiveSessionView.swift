import SwiftUI

/// The session in the gym: elapsed time and progress up top, one card per
/// exercise with big set rows, and a glass rest panel that takes over the
/// bottom while resting.
struct LiveSessionView: View {
    let session: LiveSession
    let store: TrainingStore
    @Environment(\.dismiss) private var dismiss
    @State private var confirmEnd = false

    private var state: LiveSessionState { session.state }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 18) {
                        SessionHeader(state: state)
                        ForEach(Array(state.exercises.enumerated()), id: \.element.id) { e, exercise in
                            ExerciseCard(exercise: exercise, index: e, isCurrent: state.current?.exercise == e, session: session)
                                .id(exercise.id)
                        }
                    }
                    .padding(.horizontal, Theme.padding)
                    .padding(.bottom, 24)
                }
                .onChange(of: state.current?.exercise) { _, current in
                    guard let current else { return }
                    withAnimation(.snappy) { proxy.scrollTo(state.exercises[current].id, anchor: .top) }
                }
            }
            .safeAreaInset(edge: .bottom) {
                BottomPanel(session: session) { confirmEnd = true }
            }
            .navigationTitle(state.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cerrar", systemImage: "chevron.down") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Terminar") { confirmEnd = true }
                        .buttonStyle(.glassProminent)
                        .tint(Theme.training)
                }
            }
            .confirmationDialog("¿Terminar la sesión?", isPresented: $confirmEnd, titleVisibility: .visible) {
                if state.setsDone > 0 {
                    Button("Terminar y guardar") {
                        store.finishRequested = true
                        dismiss()
                    }
                }
                Button("Descartar sesión", role: .destructive) {
                    dismiss()
                    Task { await store.discard() }
                }
                Button("Seguir entrenando", role: .cancel) {}
            } message: {
                Text(state.setsDone > 0 ? "\(state.setsDone) de \(state.setsTotal) series hechas." : "Aún no has hecho ninguna serie.")
            }
            .sensoryFeedback(trigger: state.setsDone) { old, new in new > old ? .success : nil }
        }
    }
}

// MARK: - Header

private struct SessionHeader: View {
    let state: LiveSessionState

    var body: some View {
        HStack(alignment: .center, spacing: 20) {
            ZStack {
                Circle().stroke(Theme.training.opacity(0.18), lineWidth: 10)
                Circle()
                    .trim(from: 0, to: state.setsTotal == 0 ? 0 : CGFloat(state.setsDone) / CGFloat(state.setsTotal))
                    .stroke(Theme.training.gradient, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.snappy, value: state.setsDone)
                VStack(spacing: 0) {
                    Text("\(state.setsDone)")
                        .font(.title.bold())
                        .contentTransition(.numericText())
                        .animation(.snappy, value: state.setsDone)
                    Text("de \(state.setsTotal)").font(.caption2).foregroundStyle(.secondary)
                }
                .fontDesign(.rounded)
            }
            .frame(width: 84, height: 84)

            VStack(alignment: .leading, spacing: 6) {
                Text(state.startedAt, style: .timer)
                    .font(.system(size: 44, weight: .bold, design: .rounded).monospacedDigit())
                    .foregroundStyle(Theme.training)
                HStack(spacing: 14) {
                    Label("\(Int(state.volumeKg).formatted()) kg", systemImage: "scalemass")
                        .contentTransition(.numericText())
                    Label("\(state.exercises.filter(\.done).count)/\(state.exercises.count)", systemImage: "dumbbell")
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
    }
}

// MARK: - Exercise

private struct ExerciseCard: View {
    let exercise: LiveExercise
    let index: Int
    let isCurrent: Bool
    let session: LiveSession

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(exercise.name).font(.title3.bold())
                    Text("\(exercise.prescription) · \(Duration.seconds(exercise.restSeconds).formatted(.time(pattern: .minuteSecond))) descanso")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if exercise.done {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.title2)
                        .foregroundStyle(Theme.training)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            if let hint = exercise.hint, !exercise.done {
                Label(hint, systemImage: "sparkles")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let notes = exercise.notes, !notes.isEmpty, !exercise.done {
                Label(notes, systemImage: "text.quote")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 8) {
                ForEach(Array(exercise.sets.enumerated()), id: \.element.id) { s, set in
                    SetRow(number: s + 1, set: set, step: exercise.weightStep, isNext: isCurrent && session.state.current?.set == s) { action in
                        switch action {
                        case .toggle: session.toggle(exercise: index, set: s)
                        case .weight(let steps): session.adjustWeight(exercise: index, set: s, by: steps)
                        case .reps(let delta): session.adjustReps(exercise: index, set: s, by: delta)
                        }
                    }
                }
            }

            Button {
                withAnimation(.snappy) { session.addSet(exercise: index) }
            } label: {
                Label("Añadir serie", systemImage: "plus")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glass)
        }
        .padding(Theme.padding)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(Theme.training.opacity(isCurrent ? 0.6 : 0), lineWidth: 1.5)
        }
        .opacity(exercise.done && !isCurrent ? 0.75 : 1)
        .animation(.snappy, value: exercise.done)
        .animation(.snappy, value: isCurrent)
    }
}

private enum SetAction {
    case toggle
    case weight(Double)
    case reps(Int)
}

/// One set, big enough to hit between sets with chalky hands.
private struct SetRow: View {
    let number: Int
    let set: LiveSet
    let step: Double
    let isNext: Bool
    let act: (SetAction) -> Void

    var body: some View {
        HStack(spacing: 10) {
            Text("\(number)")
                .font(.headline)
                .fontDesign(.rounded)
                .frame(width: 30, height: 30)
                .background(Circle().fill(isNext ? Theme.training.opacity(0.25) : Color.secondary.opacity(0.12)))

            ValueStepper(value: set.weightKg.formatted(), unit: "kg", minus: { act(.weight(-1)) }, plus: { act(.weight(1)) })
            ValueStepper(value: "\(set.reps)", unit: "reps", minus: { act(.reps(-1)) }, plus: { act(.reps(1)) })

            Button {
                withAnimation(.snappy) { act(.toggle) }
            } label: {
                Image(systemName: set.done ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 38, weight: .regular))
                    .foregroundStyle(set.done ? Theme.training : Color.secondary.opacity(0.6))
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(set.done ? "Desmarcar serie \(number)" : "Marcar serie \(number)")
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 10)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(set.done ? Theme.training.opacity(0.14) : Color.clear)
        )
    }
}

/// − value +, with the number rolling as it changes.
private struct ValueStepper: View {
    let value: String
    let unit: String
    let minus: () -> Void
    let plus: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            StepButton(systemImage: "minus", action: minus)
            VStack(spacing: -2) {
                Text(value)
                    .font(.title3.bold())
                    .fontDesign(.rounded)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(unit).font(.caption2).foregroundStyle(.secondary)
            }
            .frame(minWidth: 46)
            StepButton(systemImage: "plus", action: plus)
        }
        .frame(maxWidth: .infinity)
        .sensoryFeedback(.selection, trigger: value)
    }
}

private struct StepButton: View {
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button {
            withAnimation(.snappy) { action() }
        } label: {
            Image(systemName: systemImage)
                .font(.footnote.bold())
                .frame(width: 30, height: 30)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
    }
}

// MARK: - Bottom panel

/// Resting: a big countdown with a draining ring, +15 s and skip.
/// Otherwise: what comes next.
private struct BottomPanel: View {
    let session: LiveSession
    let finish: () -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.25)) { context in
            let state = session.state
            Group {
                if state.resting(at: context.date), let start = state.restStartedAt, let end = state.restEndsAt {
                    RestPanel(now: context.date, start: start, end: end, next: state.activityState(now: end), session: session)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                } else if let (e, s) = state.current {
                    NextUp(exercise: state.exercises[e].name, target: LiveSessionState.target(state.exercises[e].sets[s]), set: s + 1, of: state.exercises[e].sets.count)
                        .transition(.opacity)
                } else {
                    Button(action: finish) {
                        Label("Terminar sesión", systemImage: "flag.checkered")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(Theme.training)
                }
            }
            .animation(.snappy, value: state.resting(at: context.date))
        }
        .padding(.horizontal, Theme.padding)
        .padding(.bottom, 8)
    }
}

private struct RestPanel: View {
    let now: Date
    let start: Date
    let end: Date
    let next: TrainingActivityAttributes.ContentState
    let session: LiveSession

    var body: some View {
        let remaining = max(0, end.timeIntervalSince(now))
        let fraction = remaining / max(1, end.timeIntervalSince(start))
        HStack(spacing: 16) {
            ZStack {
                Circle().stroke(Theme.training.opacity(0.2), lineWidth: 7)
                Circle()
                    .trim(from: 0, to: fraction)
                    .stroke(Theme.training, style: StrokeStyle(lineWidth: 7, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Image(systemName: "timer").font(.title3.weight(.semibold)).foregroundStyle(Theme.training)
            }
            .frame(width: 58, height: 58)

            VStack(alignment: .leading, spacing: 2) {
                Text(Duration.seconds(remaining.rounded(.up)).formatted(.time(pattern: .minuteSecond)))
                    .font(.system(size: 40, weight: .bold, design: .rounded).monospacedDigit())
                    .contentTransition(.numericText(countsDown: true))
                Text("Luego: \(next.exerciseName)\(next.target.isEmpty ? "" : " · \(next.target)")")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            VStack(spacing: 8) {
                Button("+15 s") { session.extendRest(by: 15) }
                    .buttonStyle(.glass)
                Button("Saltar") { session.skipRest() }
                    .buttonStyle(.glassProminent)
                    .tint(Theme.training)
            }
            .font(.subheadline.weight(.semibold))
        }
        .padding(16)
        .glassEffect(.regular, in: .rect(cornerRadius: 28))
    }
}

private struct NextUp: View {
    let exercise: String
    let target: String
    let set: Int
    let of: Int

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "figure.strengthtraining.traditional")
                .font(.title2)
                .foregroundStyle(Theme.training)
            VStack(alignment: .leading, spacing: 2) {
                Text("Siguiente · serie \(set) de \(of)").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Text(exercise).font(.headline).lineLimit(1)
            }
            Spacer()
            Text(target).font(.headline).fontDesign(.rounded).foregroundStyle(Theme.training)
        }
        .padding(16)
        .glassEffect(.regular, in: .rect(cornerRadius: 28))
    }
}
