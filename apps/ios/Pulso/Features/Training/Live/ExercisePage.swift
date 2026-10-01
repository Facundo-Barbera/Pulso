import SwiftUI

/// One strength exercise, full screen: its demonstration, name and target, last
/// time and the records, then the sets. The set up next is open with big −/+
/// for load and reps (tap the number to type it) and a "Completar serie" button;
/// the others are compact rows with a 56 pt check.
struct ExercisePage: View {
    let session: LiveSession
    let index: Int
    let swap: () -> Void
    @State private var selected: String?
    @FocusState private var field: SetField?

    private var exercise: LiveExercise? {
        session.state.exercises.indices.contains(index) ? session.state.exercises[index] : nil
    }

    var body: some View {
        if let exercise {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ExerciseHeader(exercise: exercise)
                    HistoryCard(exerciseId: exercise.exerciseId, sessions: TrainingStore.shared.sessions)
                    Guidance(exercise: exercise)
                    sets(exercise)
                    actions(exercise)
                }
                .padding(.horizontal, Theme.padding)
                .padding(.top, 4)
                .padding(.bottom, 24)
                .animation(.snappy, value: exercise.sets)
            }
            .scrollDismissesKeyboard(.interactively)
            .toolbar {
                if field != nil {
                    ToolbarItemGroup(placement: .keyboard) {
                        Spacer()
                        Button("Listo") { field = nil }
                            .fontWeight(.semibold)
                    }
                }
            }
        }
    }

    private func expandedId(_ exercise: LiveExercise) -> String? {
        if let selected, exercise.sets.contains(where: { $0.id == selected }) { return selected }
        return exercise.sets.first { !$0.done }?.id
    }

    private func sets(_ exercise: LiveExercise) -> some View {
        let open = expandedId(exercise)
        return VStack(spacing: 8) {
            ForEach(Array(exercise.sets.enumerated()), id: \.element.id) { s, set in
                SetRowView(number: s + 1, total: exercise.sets.count, set: set, step: exercise.weightStep, expanded: set.id == open, field: $field) { action in
                    perform(action, set: s, id: set.id)
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    private func perform(_ action: SetAction, set s: Int, id: String) {
        switch action {
        case .toggle:
            field = nil
            withAnimation(.snappy) {
                session.toggle(exercise: index, set: s)
                selected = nil
            }
        case .select: withAnimation(.snappy) { selected = id }
        case .weight(let steps): withAnimation(.snappy) { session.adjustWeight(exercise: index, set: s, by: steps) }
        case .reps(let delta): withAnimation(.snappy) { session.adjustReps(exercise: index, set: s, by: delta) }
        case .setWeight(let kg): session.setWeight(exercise: index, set: s, to: kg)
        case .setReps(let reps): session.setReps(exercise: index, set: s, to: reps)
        case .rpe(let rpe): session.setRpe(exercise: index, set: s, to: rpe)
        case .remove: withAnimation(.snappy) { session.removeSet(exercise: index, set: s) }
        }
    }

    private func actions(_ exercise: LiveExercise) -> some View {
        VStack(spacing: 10) {
            Button {
                withAnimation(.snappy) { session.addSet(exercise: index) }
            } label: {
                Label("Añadir serie", systemImage: "plus")
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.glass)

            AdaptiveStack(spacing: 10) {
                Button(action: swap) {
                    Label("Cambiar ejercicio", systemImage: "arrow.triangle.2.circlepath")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                Button {
                    withAnimation(.snappy) { session.setSkipped(index, !exercise.skipped) }
                } label: {
                    Label(exercise.skipped ? "Retomar" : "Saltar", systemImage: exercise.skipped ? "arrow.uturn.backward" : "forward")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
            }
            .font(.subheadline.weight(.semibold))
            .buttonStyle(.glass)
        }
        .padding(.top, 4)
    }
}

// MARK: - Header

private struct ExerciseHeader: View {
    let exercise: LiveExercise

    private var detail: ExerciseDetail? { ExerciseCatalog.shared.details[exercise.exerciseId] }
    private var route: ExerciseRoute { ExerciseRoute(exerciseId: exercise.exerciseId, name: exercise.name) }

    private var details: String {
        var parts: [String] = []
        if let rir = exercise.targetRir { parts.append("RIR \(rir)") } else if let rpe = exercise.targetRpe { parts.append("RPE \(rpe.formatted())") }
        if exercise.restSeconds > 0 {
            parts.append("\(Duration.seconds(exercise.restSeconds).formatted(.time(pattern: .minuteSecond))) de descanso")
        }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            NavigationLink(value: route) {
                ExerciseMediaView(path: detail?.media.animation ?? detail?.media.thumbnail, cornerRadius: 24)
                    .frame(maxWidth: 220, maxHeight: 220)
                    .frame(maxWidth: .infinity)
                    .saturation(exercise.skipped ? 0 : 1)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Ver la guía de \(exercise.name)")

            VStack(alignment: .leading, spacing: 6) {
                NavigationLink(value: route) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(exercise.name)
                            .font(.title2.bold())
                            .fontDesign(.rounded)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                        Image(systemName: "info.circle")
                            .font(.subheadline)
                            .foregroundStyle(Theme.training)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityHint("Abre la guía del ejercicio")

                Text(exercise.target)
                    .font(.headline)
                    .fontDesign(.rounded)
                    .foregroundStyle(Theme.training)
                    .contentTransition(.numericText())
                if !details.isEmpty {
                    Text(details).font(.subheadline).foregroundStyle(.secondary)
                }
                if exercise.skipped {
                    GlassChip("Saltado hoy", systemImage: "forward")
                }
            }
        }
    }
}

/// Last time's sets and the records on this exercise, from the recent sessions.
private struct HistoryCard: View {
    let exerciseId: String
    let sessions: [TrainingSession]

    var body: some View {
        let last = LiveHistory.last(exerciseId, in: sessions)
        let best = LiveHistory.best(exerciseId, in: sessions)
        if last != nil || best != nil {
            VStack(alignment: .leading, spacing: 10) {
                if let last {
                    row(title: "Última vez · \(last.date.formatted(.dateTime.day().month()))", value: LiveHistory.line(last.sets), systemImage: "clock.arrow.circlepath")
                }
                if let best {
                    row(title: "Récord", value: "1RM \(best.e1rm.rounded().formatted()) kg · máx. \(best.heaviestKg.formatted()) kg", systemImage: "trophy")
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background.secondary, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
        }
    }

    private func row(title: String, value: String, systemImage: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: systemImage)
                .foregroundStyle(systemImage == "trophy" ? Theme.carbs : Theme.training)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Text(value).font(.subheadline.weight(.medium)).fontDesign(.rounded)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// The engine's progression hint and the program's notes.
private struct Guidance: View {
    let exercise: LiveExercise

    var body: some View {
        let hint = exercise.done ? nil : exercise.hint.flatMap { $0.isEmpty ? nil : $0 }
        let notes = exercise.notes.flatMap { $0.isEmpty ? nil : $0 }
        if hint != nil || notes != nil {
            VStack(alignment: .leading, spacing: 8) {
                if let hint { Label(hint, systemImage: "sparkles") }
                if let notes { Label(notes, systemImage: "text.quote") }
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Sets

enum SetField: Hashable {
    case weight(String)
    case reps(String)
}

enum SetAction {
    case toggle
    case select
    case weight(Double)
    case reps(Int)
    case setWeight(Double)
    case setReps(Int)
    case rpe(Double?)
    case remove
}

/// A set: open (steppers, RPE, "Completar serie") or a compact 64 pt row.
struct SetRowView: View {
    let number: Int
    let total: Int
    let set: LiveSet
    let step: Double
    let expanded: Bool
    let field: FocusState<SetField?>.Binding
    let act: (SetAction) -> Void

    static let rpeOptions: [Double] = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]

    var body: some View {
        Group {
            if expanded { open } else { compact }
        }
        .contextMenu {
            if !set.done {
                Button("Eliminar serie", systemImage: "trash", role: .destructive) { act(.remove) }
            }
        }
        .sensoryFeedback(.selection, trigger: set.weightKg)
        .sensoryFeedback(.selection, trigger: set.reps)
    }

    private var badge: some View {
        Text("\(number)")
            .font(.subheadline.bold())
            .fontDesign(.rounded)
            .foregroundStyle(set.done || expanded ? Theme.training : .secondary)
            .frame(width: 32, height: 32)
            .background(Circle().fill(set.done || expanded ? Theme.training.opacity(0.2) : Color.secondary.opacity(0.12)))
    }

    private var compact: some View {
        HStack(spacing: 12) {
            badge
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(set.weightKg.formatted())
                    .font(.title3.bold())
                    .contentTransition(.numericText())
                Text("kg").font(.caption).foregroundStyle(.secondary)
                Text("×").font(.subheadline).foregroundStyle(.tertiary).padding(.horizontal, 2)
                Text("\(set.reps)")
                    .font(.title3.bold())
                    .contentTransition(.numericText())
                Text("reps").font(.caption).foregroundStyle(.secondary)
            }
            .fontDesign(.rounded)
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            if let rpe = set.rpe {
                Text("RPE \(rpe.formatted())").font(.caption.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1).fixedSize()
            }
            Spacer(minLength: 0)
            Button {
                act(.toggle)
            } label: {
                Image(systemName: set.done ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 32))
                    .foregroundStyle(set.done ? Theme.training : Color.secondary.opacity(0.6))
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 56, height: 56)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(set.done ? "Desmarcar serie \(number)" : "Marcar serie \(number)")
        }
        .padding(.leading, 12)
        .padding(.trailing, 4)
        .frame(minHeight: 64)
        .background(
            set.done ? Theme.training.opacity(0.14) : Color.secondary.opacity(0.08),
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
        .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .onTapGesture { act(.select) }
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Abre la serie para cambiar peso y repeticiones")
    }

    private var open: some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                badge
                Text("Serie \(number) de \(total)")
                    .font(.headline)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 4)
                rpeMenu
            }
            ValueStepper(label: "Peso", unit: "kg", value: set.weightKg, text: { $0.formatted() }, field: .weight(set.id), focus: field, keyboard: .decimalPad,
                         stepLabel: "\(step.formatted()) kg", step: { act(.weight($0)) }, commit: { act(.setWeight($0)) })
            ValueStepper(label: "Repeticiones", unit: "reps", value: Double(set.reps), text: { "\(Int($0))" }, field: .reps(set.id), focus: field, keyboard: .numberPad,
                         stepLabel: "1", step: { act(.reps(Int($0))) }, commit: { act(.setReps(Int($0))) })
            if set.done {
                Button { act(.toggle) } label: {
                    Label("Desmarcar serie", systemImage: "arrow.uturn.backward")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.glass)
            } else {
                Button { act(.toggle) } label: {
                    Label("Completar serie", systemImage: "checkmark")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.glassProminent)
                .tint(Theme.training)
            }
        }
        .padding(12)
        .background(Theme.training.opacity(set.done ? 0.14 : 0.07), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Theme.training.opacity(0.35), lineWidth: 1)
        }
    }

    private var rpeMenu: some View {
        Menu {
            Button("Sin RPE") { act(.rpe(nil)) }
            ForEach(Self.rpeOptions, id: \.self) { value in
                Button("RPE \(value.formatted())") { act(.rpe(value)) }
            }
        } label: {
            Text(set.rpe.map { "RPE \($0.formatted())" } ?? "RPE")
                .font(.subheadline.weight(.semibold))
                .fontDesign(.rounded)
                .foregroundStyle(set.rpe == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(Theme.training))
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .glassEffect(.regular.interactive(), in: .capsule)
                .frame(minHeight: 56)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(set.rpe.map { "Esfuerzo percibido \($0.formatted())" } ?? "Añadir esfuerzo percibido")
    }
}

/// −  80 kg  +  with 56 pt buttons. Tapping the number types it in.
private struct ValueStepper: View {
    let label: String
    let unit: String
    let value: Double
    let text: (Double) -> String
    let field: SetField
    let focus: FocusState<SetField?>.Binding
    let keyboard: UIKeyboardType
    let stepLabel: String
    let step: (Double) -> Void
    let commit: (Double) -> Void
    @State private var typed = ""

    private var editing: Bool { focus.wrappedValue == field }

    var body: some View {
        HStack(spacing: 8) {
            RoundStepButton(systemImage: "minus") { step(-1) }
                .accessibilityLabel("Restar \(stepLabel)")
            VStack(spacing: 0) {
                Text(label).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                ZStack {
                    TextField("", text: $typed)
                        .keyboardType(keyboard)
                        .multilineTextAlignment(.center)
                        .focused(focus, equals: field)
                        .opacity(editing ? 1 : 0)
                    if !editing {
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text(text(value))
                                .contentTransition(.numericText())
                            Text(unit).font(.headline).foregroundStyle(.secondary)
                        }
                        .allowsHitTesting(false)
                    }
                }
                .font(.system(.largeTitle, design: .rounded, weight: .bold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            }
            .frame(maxWidth: .infinity, minHeight: 56)
            .contentShape(Rectangle())
            .onTapGesture { focus.wrappedValue = field }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
            .accessibilityValue("\(text(value)) \(unit)")
            .accessibilityAdjustableAction { direction in
                step(direction == .increment ? 1 : -1)
            }
            RoundStepButton(systemImage: "plus") { step(1) }
                .accessibilityLabel("Sumar \(stepLabel)")
        }
        .onChange(of: editing) { _, now in
            if now { typed = text(value) }
        }
        // Applied as typed, so "Completar serie" right after typing keeps the number.
        .onChange(of: typed) { _, new in
            guard editing, let parsed = NumberEntry.parse(new) else { return }
            commit(parsed)
        }
    }
}

/// A number typed on the decimal pad: "5,2" or "5.2". Nil when empty, not a number or negative.
enum NumberEntry {
    static func parse(_ text: String) -> Double? {
        let cleaned = text.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)
        return Double(cleaned).flatMap { $0 >= 0 ? $0 : nil }
    }
}

struct RoundStepButton: View {
    let systemImage: String
    var size: CGFloat = 56
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.title3.bold())
                .frame(width: size, height: size)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
        .buttonRepeatBehavior(.enabled)
    }
}
