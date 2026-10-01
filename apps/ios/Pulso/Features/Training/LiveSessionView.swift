import SwiftUI

/// The session in the gym: elapsed time and progress up top, one card per
/// exercise with big set rows, and a glass rest panel that takes over the
/// bottom while resting.
///
/// Width budget at 375 pt: screen padding 2 × 16 and card padding 2 × 16 leave
/// 311 pt for a card's content; every row below is laid out to fit that.
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
            .navigationDestination(for: ExerciseRoute.self) { ExerciseDetailView(exerciseId: $0.exerciseId, name: $0.name) }
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
            .task {
                let ids = state.exercises.map(\.exerciseId)
                await ExerciseCatalog.shared.prefetch(ids, animations: ids)
            }
        }
    }
}

// MARK: - Header

private struct SessionHeader: View {
    let state: LiveSessionState

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            ZStack {
                Circle().stroke(Theme.training.opacity(0.18), lineWidth: 9)
                Circle()
                    .trim(from: 0, to: state.setsTotal == 0 ? 0 : CGFloat(state.setsDone) / CGFloat(state.setsTotal))
                    .stroke(Theme.training.gradient, style: StrokeStyle(lineWidth: 9, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.snappy, value: state.setsDone)
                VStack(spacing: 0) {
                    Text("\(state.setsDone)")
                        .font(.title2.bold())
                        .contentTransition(.numericText())
                        .animation(.snappy, value: state.setsDone)
                    Text("de \(state.setsTotal)").font(.caption2).foregroundStyle(.secondary)
                }
                .fontDesign(.rounded)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            }
            .frame(width: 76, height: 76)
            .padding(5)

            VStack(alignment: .leading, spacing: 6) {
                Text(state.startedAt, style: .timer)
                    .font(.system(size: 42, weight: .bold, design: .rounded).monospacedDigit())
                    .foregroundStyle(Theme.training)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                HStack(spacing: 12) {
                    Label("\(Int(state.volumeKg).formatted()) kg", systemImage: "scalemass")
                        .contentTransition(.numericText())
                    Label("\(state.exercises.filter(\.done).count)/\(state.exercises.count)", systemImage: "dumbbell")
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 8)
    }
}

// MARK: - Exercise

private struct EditTarget: Identifiable {
    let index: Int
    var id: Int { index }
}

private struct ExerciseCard: View {
    let exercise: LiveExercise
    let index: Int
    let isCurrent: Bool
    let session: LiveSession
    @State private var editing: EditTarget?

    private var detail: ExerciseDetail? { ExerciseCatalog.shared.details[exercise.exerciseId] }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                if isCurrent {
                    NavigationLink(value: route) {
                        ExerciseMediaView(path: detail?.media.animation ?? detail?.media.thumbnail, cornerRadius: 14)
                            .frame(width: 72, height: 72)
                    }
                    .buttonStyle(.plain)
                    .transition(.scale.combined(with: .opacity))
                }
                VStack(alignment: .leading, spacing: 4) {
                    NavigationLink(value: route) {
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text(exercise.name)
                                .font(.title3.bold())
                                .multilineTextAlignment(.leading)
                                .lineLimit(2)
                            Image(systemName: "info.circle")
                                .font(.subheadline)
                                .foregroundStyle(Theme.training)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Abre la guía del ejercicio")
                    Text("\(exercise.prescription) · \(Duration.seconds(exercise.restSeconds).formatted(.time(pattern: .minuteSecond))) descanso")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                    if isCurrent, let muscle = detail?.primaryMuscles.first {
                        GlassChip(muscle.label, systemImage: "figure.arms.open", tint: MuscleMapView.primaryColor)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
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
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let notes = exercise.notes, !notes.isEmpty, !exercise.done {
                Label(notes, systemImage: "text.quote")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(spacing: 6) {
                SetColumns()
                ForEach(Array(exercise.sets.enumerated()), id: \.element.id) { s, set in
                    SetRow(number: s + 1, set: set, step: exercise.weightStep, isNext: isCurrent && session.state.current?.set == s) { action in
                        switch action {
                        case .toggle: session.toggle(exercise: index, set: s)
                        case .weight(let steps): session.adjustWeight(exercise: index, set: s, by: steps)
                        case .edit: editing = EditTarget(index: s)
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
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(Theme.training.opacity(isCurrent ? 0.6 : 0), lineWidth: 1.5)
        }
        .opacity(exercise.done && !isCurrent ? 0.75 : 1)
        .animation(.snappy, value: exercise.done)
        .animation(.snappy, value: isCurrent)
        .sheet(item: $editing) { target in
            SetEditor(session: session, exercise: index, set: target.index)
        }
    }

    private var route: ExerciseRoute { ExerciseRoute(exerciseId: exercise.exerciseId, name: exercise.name) }
}

private enum SetAction {
    case toggle
    case weight(Double)
    case edit
}

/// Column captions over the set rows, aligned with `SetRow`'s columns.
private struct SetColumns: View {
    var body: some View {
        HStack(spacing: SetRow.spacing) {
            Text("Serie").frame(width: SetRow.badge)
            Text("Peso").frame(maxWidth: .infinity)
            Text("Reps").frame(width: SetRow.reps)
            Color.clear.frame(width: SetRow.check, height: 1)
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.tertiary)
        .textCase(.uppercase)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .padding(.horizontal, SetRow.inset)
    }
}

/// One set: badge · weight · reps · check. Weight and reps open the editor;
/// the set up next also gets −/+ for the load right in the row when it fits.
/// Fixed columns: 28 + 64 + 46 + 3 × 8 spacing + 2 × 8 inset = 178 pt, which
/// leaves the weight column ≥ 133 pt of the 311 pt card at 375 pt.
private struct SetRow: View {
    static let badge: CGFloat = 28
    static let reps: CGFloat = 64
    static let check: CGFloat = 46
    static let spacing: CGFloat = 8
    static let inset: CGFloat = 8

    let number: Int
    let set: LiveSet
    let step: Double
    let isNext: Bool
    let act: (SetAction) -> Void

    var body: some View {
        HStack(spacing: Self.spacing) {
            Text("\(number)")
                .font(.subheadline.bold())
                .fontDesign(.rounded)
                .foregroundStyle(isNext ? Theme.training : .secondary)
                .frame(width: Self.badge, height: Self.badge)
                .background(Circle().fill(isNext ? Theme.training.opacity(0.22) : Color.secondary.opacity(0.12)))

            Group {
                if isNext && !set.done {
                    ViewThatFits(in: .horizontal) {
                        // 32 + 4 + 56 + 4 + 32 = 128 pt: fits the 133 pt column at 375 pt.
                        HStack(spacing: 4) {
                            StepButton(systemImage: "minus", size: 32) { act(.weight(-1)) }
                            weight(minWidth: 56)
                            StepButton(systemImage: "plus", size: 32) { act(.weight(1)) }
                        }
                        weight()
                    }
                } else {
                    weight()
                }
            }
            .frame(maxWidth: .infinity)

            Button { act(.edit) } label: {
                ValueText(value: "\(set.reps)", unit: "reps")
                    .frame(width: Self.reps, height: 44)
                    .background(Color.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(set.reps) repeticiones, editar")

            Button {
                withAnimation(.snappy) { act(.toggle) }
            } label: {
                Image(systemName: set.done ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 34, weight: .regular))
                    .foregroundStyle(set.done ? Theme.training : Color.secondary.opacity(0.6))
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: Self.check, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(set.done ? "Desmarcar serie \(number)" : "Marcar serie \(number)")
        }
        .padding(.vertical, 6)
        .padding(.horizontal, Self.inset)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(set.done ? Theme.training.opacity(0.14) : isNext ? Theme.training.opacity(0.06) : Color.clear)
        )
        .sensoryFeedback(.selection, trigger: set.weightKg)
    }

    private func weight(minWidth: CGFloat = 64) -> some View {
        Button { act(.edit) } label: {
            ValueText(value: set.weightKg.formatted(), unit: "kg")
                .frame(minWidth: minWidth, maxWidth: .infinity)
                .frame(height: 44)
                .background(Color.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(set.weightKg.formatted()) kilos, editar")
    }
}

/// A number over its unit, rolling as it changes.
private struct ValueText: View {
    let value: String
    let unit: String

    var body: some View {
        VStack(spacing: -2) {
            Text(value)
                .font(.title3.bold())
                .fontDesign(.rounded)
                .monospacedDigit()
                .contentTransition(.numericText())
                .animation(.snappy, value: value)
            Text(unit).font(.caption2).foregroundStyle(.secondary)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .padding(.horizontal, 4)
    }
}

private struct StepButton: View {
    let systemImage: String
    var size: CGFloat = 36
    let action: () -> Void

    var body: some View {
        Button {
            withAnimation(.snappy) { action() }
        } label: {
            Image(systemName: systemImage)
                .font(.subheadline.bold())
                .frame(width: size, height: size)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
    }
}

/// Weight and reps for one set, big: a compact sheet over the session.
private struct SetEditor: View {
    let session: LiveSession
    let exercise: Int
    let set: Int
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let ex = session.state.exercises[exercise]
        let value = ex.sets[set]
        VStack(spacing: 18) {
            VStack(spacing: 2) {
                Text("Serie \(set + 1)").font(.headline)
                Text(ex.name).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
            EditorRow(label: "Peso", value: value.weightKg.formatted(), unit: "kg", step: "\(ex.weightStep.formatted()) kg") {
                session.adjustWeight(exercise: exercise, set: set, by: $0)
            }
            EditorRow(label: "Repeticiones", value: "\(value.reps)", unit: "reps", step: "1") {
                session.adjustReps(exercise: exercise, set: set, by: Int($0))
            }
            Button {
                dismiss()
            } label: {
                Text("Listo").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 4)
            }
            .buttonStyle(.glassProminent)
            .tint(Theme.training)
        }
        .padding(Theme.padding)
        .padding(.top, 12)
        .presentationDetents([.height(360)])
        .presentationDragIndicator(.visible)
    }
}

private struct EditorRow: View {
    let label: String
    let value: String
    let unit: String
    let step: String
    let change: (Double) -> Void

    var body: some View {
        HStack(spacing: 12) {
            StepButton(systemImage: "minus", size: 56) { change(-1) }
                .accessibilityLabel("Restar \(step)")
            VStack(spacing: 0) {
                Text(label).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(value)
                        .font(.system(size: 44, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .contentTransition(.numericText())
                        .animation(.snappy, value: value)
                    Text(unit).font(.headline).foregroundStyle(.secondary)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            }
            .frame(maxWidth: .infinity)
            StepButton(systemImage: "plus", size: 56) { change(1) }
                .accessibilityLabel("Sumar \(step)")
        }
        .sensoryFeedback(.selection, trigger: value)
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
            .frame(maxWidth: .infinity)
            .animation(.snappy, value: state.resting(at: context.date))
        }
        .padding(.horizontal, Theme.padding)
        .padding(.bottom, 8)
    }
}

/// 58 ring + 2 × 12 spacing + ~76 buttons + 2 × 16 padding leave ≥ 153 pt for the countdown at 375 pt.
private struct RestPanel: View {
    let now: Date
    let start: Date
    let end: Date
    let next: TrainingActivityAttributes.ContentState
    let session: LiveSession

    var body: some View {
        let remaining = max(0, end.timeIntervalSince(now))
        let fraction = remaining / max(1, end.timeIntervalSince(start))
        HStack(spacing: 12) {
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
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text("Luego: \(next.exerciseName)\(next.target.isEmpty ? "" : " · \(next.target)")")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(spacing: 8) {
                Button("+15 s") { session.extendRest(by: 15) }
                    .buttonStyle(.glass)
                Button("Saltar") { session.skipRest() }
                    .buttonStyle(.glassProminent)
                    .tint(Theme.training)
            }
            .font(.subheadline.weight(.semibold))
            .fixedSize()
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
                Text(exercise).font(.headline)
            }
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(target)
                .font(.headline)
                .fontDesign(.rounded)
                .foregroundStyle(Theme.training)
                .lineLimit(1)
                .fixedSize()
        }
        .padding(16)
        .glassEffect(.regular, in: .rect(cornerRadius: 28))
    }
}

#if DEBUG
#Preview("Sesión · 375 pt", traits: .fixedLayout(width: 375, height: 812)) {
    let day = ProgramDay(id: "d1", name: "Torso A", focus: nil, weekday: nil, exercises: [
        ProgramExercise(id: "pe1", exerciseId: "press-banca", exerciseName: "Press de banca con barra y agarre cerrado", equipment: "barbell", sets: 3, repMin: 6, repMax: 8, targetRpe: nil, targetRir: 2, restSeconds: 150, notes: "Pausa de un segundo abajo, codos a 45° y escápulas juntas todo el recorrido"),
        ProgramExercise(id: "pe2", exerciseId: "curl", exerciseName: "Curl con mancuernas", equipment: "dumbbell", sets: 2, repMin: 10, repMax: 12, targetRpe: 8, targetRir: nil, restSeconds: 60, notes: nil),
    ])
    let suggestions = ["pe1": LoadSuggestion(exerciseId: "press-banca", weightKg: 102.5, reps: 7, reason: "Subiste las 3 series a 8: prueba 102,5 kg y vuelve al rango bajo", lastSessionAt: 1)]
    LiveSessionView(session: LiveSession(state: LiveSessionState(day: day, programId: nil, suggestions: suggestions)), store: .shared)
}
#endif
