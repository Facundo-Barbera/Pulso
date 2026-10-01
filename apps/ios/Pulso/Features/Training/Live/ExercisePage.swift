import Charts
import SwiftUI

/// One strength exercise: a compact header (thumbnail and name open the guide,
/// the machine's unit, the target on one line), then the sets. The set up next
/// is a full row (load and repetitions big, "Hecho" on the right); done and
/// upcoming sets are compact lines that expand when tapped. Tapping the load or
/// the repetitions opens −/+ for just that value, in the exercise's unit. Below:
/// the best mark, the optional effort rating and the exercise's actions.
struct ExercisePage: View {
    let session: LiveSession
    let index: Int
    /// The sessions to read history from; the store's when nil.
    var history: [TrainingSession]? = nil
    let swap: () -> Void
    @State private var editing: SetEditing?
    @State private var info = false
    @FocusState private var field: SetField?

    private var exercise: LiveExercise? {
        session.state.exercises.indices.contains(index) ? session.state.exercises[index] : nil
    }

    /// The effort advice shows once a session: on the first exercise that has one (and always in the guide).
    private var showsAdvice: Bool {
        session.state.exercises.firstIndex { $0.effortAdvice != nil } == index
    }

    var body: some View {
        if let exercise {
            let sessions = history ?? TrainingStore.shared.sessions
            let last = LiveHistory.last(exercise.exerciseId, in: sessions)
            let unit = TrainingStore.shared.unit(for: exercise.exerciseId)
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ExerciseHeader(exercise: exercise, unit: unit, advice: showsAdvice ? exercise.effortAdvice : nil, info: { info = true }) {
                        withAnimation(.snappy) { session.setSkipped(index, false) }
                    }
                    .padding(.bottom, 2)
                    sets(exercise, last: last, unit: unit)
                    if exercise.done && exercise.hasDoneWork {
                        EffortCard(value: exercise.effort) { session.setEffort(exercise: index, to: $0) }
                            .transition(.opacity.combined(with: .scale(scale: 0.96)))
                    }
                    actions(exercise)
                    BestCard(exercise: exercise, sessions: sessions, unit: unit)
                        .padding(.top, 4)
                }
                .padding(.horizontal, Theme.padding)
                .padding(.top, 2)
                .padding(.bottom, 24)
                .animation(.snappy, value: exercise.sets)
                .animation(.snappy, value: editing)
                .animation(.snappy, value: exercise.skipped)
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
            .sheet(isPresented: $info) {
                NavigationStack {
                    ExerciseDetailView(exerciseId: exercise.exerciseId, name: exercise.name, today: exercise)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Cerrar", systemImage: "xmark") { info = false }
                            }
                        }
                }
            }
        }
    }

    private func sets(_ exercise: LiveExercise, last: LiveHistory.Last?, unit: WeightUnit) -> some View {
        let current = exercise.skipped ? nil : exercise.sets.firstIndex { !$0.done }
        return VStack(spacing: 6) {
            ForEach(Array(exercise.sets.enumerated()), id: \.element.id) { s, set in
                SetRowView(
                    number: s + 1, set: set, previous: LiveHistory.set(s, of: last), unit: unit, exerciseId: exercise.exerciseId,
                    needsLoad: Equipment.needsLoad(exercise.equipment), current: s == current,
                    expanded: s == current || editing?.id == set.id, editing: editing?.id == set.id ? editing?.value : nil, field: $field
                ) { action in
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
                editing = nil
            }
        case .expand: withAnimation(.snappy) { editing = SetEditing(id: id) }
        case .edit(let value):
            field = nil
            withAnimation(.snappy) { editing = SetEditing(id: id, value: editing == SetEditing(id: id, value: value) ? nil : value) }
        case .close:
            field = nil
            withAnimation(.snappy) { editing = nil }
        case .step(.weight, let up): withAnimation(.snappy) { session.stepWeight(exercise: index, set: s, up: up) }
        case .step(.reps, let up): withAnimation(.snappy) { session.adjustReps(exercise: index, set: s, by: up ? 1 : -1) }
        case .setWeight(let value): session.setWeight(exercise: index, set: s, to: value)
        case .setReps(let reps): session.setReps(exercise: index, set: s, to: reps)
        case .remove: withAnimation(.snappy) { session.removeSet(exercise: index, set: s) }
        }
    }

    private func actions(_ exercise: LiveExercise) -> some View {
        let left = exercise.sets.count { !$0.done }
        return VStack(spacing: 10) {
            AdaptiveStack(spacing: 10) {
                if left > 1 && !exercise.skipped {
                    Button {
                        field = nil
                        editing = nil
                        withAnimation(.snappy) { session.completeAll(exercise: index) }
                    } label: {
                        Label("Registrar todas", systemImage: "checkmark.circle")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .accessibilityHint("Marca las \(left) series que faltan tal como están")
                }
                Button {
                    withAnimation(.snappy) { session.addSet(exercise: index) }
                } label: {
                    Label("Añadir serie", systemImage: "plus")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
            }
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
        }
        .font(.subheadline.weight(.semibold))
        .buttonStyle(.glass)
        .padding(.top, 4)
    }
}

extension Equipment {
    /// Whether a set asks for a load: bodyweight and bands go by repetitions.
    static func needsLoad(_ id: String) -> Bool { !["bodyweight", "band"].contains(id) }
}

// MARK: - Header

/// Thumbnail and name (tapping them opens the guide), the muscle as small text,
/// the machine's unit, and the target on one line. Skipped, a banner says so
/// with the way back.
private struct ExerciseHeader: View {
    let exercise: LiveExercise
    let unit: WeightUnit
    /// The effort advice, when this is the exercise that shows it.
    let advice: String?
    let info: () -> Void
    let resume: () -> Void

    private var detail: ExerciseDetail? { ExerciseCatalog.shared.details[exercise.exerciseId] }

    /// "Espalda alta · Superserie"
    private var meta: String? {
        let parts = [detail?.primaryMuscles.first?.label, exercise.supersetId != nil ? "Superserie" : nil].compactMap(\.self)
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                Button(action: info) {
                    HStack(spacing: 12) {
                        ExerciseMediaView(path: detail?.media.thumbnail ?? detail?.media.animation, cornerRadius: 11)
                            .frame(width: 44, height: 44)
                            .saturation(exercise.skipped ? 0 : 1)
                            .opacity(exercise.skipped ? 0.6 : 1)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(exercise.name)
                                .font(.headline)
                                .fontDesign(.rounded)
                                .strikethrough(exercise.skipped, color: .secondary)
                                .foregroundStyle(exercise.skipped ? .secondary : .primary)
                                .lineLimit(2)
                                .fixedSize(horizontal: false, vertical: true)
                            if let meta {
                                Text(meta).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(exercise.name)
                .accessibilityHint("Abre la guía y los objetivos de hoy")

                if Equipment.needsLoad(exercise.equipment) {
                    UnitBadge(exerciseId: exercise.exerciseId, unit: unit)
                }
            }

            if exercise.skipped {
                SkippedBanner(resume: resume)
                    .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .top)))
            } else {
                Text(exercise.targetLine)
                    .font(.subheadline.weight(.semibold))
                    .fontDesign(.rounded)
                    .foregroundStyle(Theme.training)
                    .contentTransition(.numericText())
                if let advice {
                    Text(advice).font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }
}

/// "Saltado hoy" with "Retomar": a skipped exercise must not look like one waiting.
private struct SkippedBanner: View {
    let resume: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "forward.fill")
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 1) {
                Text("Saltado hoy").font(.subheadline.weight(.semibold))
                Text("No cuenta en la sesión.").font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button("Retomar", systemImage: "arrow.uturn.backward", action: resume)
                .font(.subheadline.weight(.semibold))
                .buttonStyle(.glassProminent)
                .tint(Theme.training)
        }
        .padding(.leading, 14)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .contain)
    }
}

/// The machine's unit as a small capsule; a menu switches it (for every session, at once).
private struct UnitBadge: View {
    let exerciseId: String
    let unit: WeightUnit

    var body: some View {
        Menu {
            Picker("Unidad de esta máquina", selection: Binding(get: { unit }, set: { TrainingStore.shared.setUnit($0, for: exerciseId) })) {
                ForEach(WeightUnit.allCases) { Text($0 == .kg ? "Kilos (kg)" : "Libras (lb)").tag($0) }
            }
        } label: {
            Text(unit.rawValue)
                .font(.subheadline.weight(.bold))
                .fontDesign(.rounded)
                .foregroundStyle(Theme.training)
                .frame(minWidth: 44, minHeight: 32)
                .contentTransition(.interpolate)
        }
        .glassEffect(.regular.interactive(), in: .capsule)
        .sensoryFeedback(.selection, trigger: unit)
        .accessibilityLabel("Unidad de esta máquina")
        .accessibilityValue(unit == .kg ? "kilos" : "libras")
    }
}

// MARK: - Best mark

/// "Mejor marca": the heaviest load on this exercise, its trend per session and
/// the next goal, in the exercise's unit. Hidden without history.
private struct BestCard: View {
    let exercise: LiveExercise
    let sessions: [TrainingSession]
    let unit: WeightUnit
    @State private var selected: Date?

    private struct Point: Identifiable {
        var day: Date
        /// In the unit.
        var value: Double
        var id: Date { day }
    }

    private var points: [Point] {
        sessions
            .compactMap { session in
                let top = session.sets.filter { $0.exerciseId == exercise.exerciseId && $0.reps > 0 }.map(\.weightKg).max()
                return top.flatMap { $0 > 0 ? Point(day: session.start, value: unit.shown($0)) : nil }
            }
            .sorted { $0.day < $1.day }
    }

    /// The heaviest set and its repetitions.
    private var best: SetLog? {
        sessions.flatMap(\.sets)
            .filter { $0.exerciseId == exercise.exerciseId && $0.weightKg > 0 && $0.reps > 0 }
            .max { ($0.weightKg, $0.reps) < ($1.weightKg, $1.reps) }
    }

    /// The engine's reason for today's load, else the next step up from the best.
    private func goal(_ best: SetLog) -> String {
        if let hint = exercise.hint, !hint.isEmpty, !exercise.done { return hint }
        return "Siguiente meta: \(unit.format(unit.fromUnit(unit.stepUp(unit.snap(best.weightKg)))))"
    }

    var body: some View {
        if let best {
            let points = points
            let shown = selected.flatMap { date in points.min { abs($0.day.timeIntervalSince(date)) < abs($1.day.timeIntervalSince(date)) } }
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .center, spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Label {
                            Text(shown.map { $0.day.formatted(.dateTime.day().month()) } ?? "Mejor marca")
                        } icon: {
                            Image(systemName: "trophy.fill").foregroundStyle(Theme.carbs)
                        }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        HStack(alignment: .firstTextBaseline, spacing: 3) {
                            Text(WeightUnit.number(shown?.value ?? unit.shown(best.weightKg)))
                                .font(.title2.bold())
                                .contentTransition(.numericText())
                            Text(unit.rawValue).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                        }
                        .fontDesign(.rounded)
                        if shown == nil {
                            Text("con \(TrainingText.repetitions(best.reps))").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .animation(.snappy, value: shown?.value)

                    if points.count > 1 {
                        trend(points)
                            .frame(maxWidth: .infinity)
                            .frame(height: 56)
                    } else {
                        Spacer(minLength: 0)
                    }
                }
                Text(goal(best))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background.secondary, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
            .accessibilityElement(children: .combine)
        }
    }

    private func trend(_ points: [Point]) -> some View {
        let low = (points.map(\.value).min() ?? 0) * 0.9
        return Chart {
            ForEach(points) { point in
                AreaMark(x: .value("Fecha", point.day), yStart: .value("Base", low), yEnd: .value("Peso", point.value))
                    .foregroundStyle(LinearGradient(colors: [Theme.training.opacity(0.35), Theme.training.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                    .interpolationMethod(.monotone)
                LineMark(x: .value("Fecha", point.day), y: .value("Peso", point.value))
                    .foregroundStyle(Theme.training)
                    .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
                    .interpolationMethod(.monotone)
            }
            if let selected, let point = points.min(by: { abs($0.day.timeIntervalSince(selected)) < abs($1.day.timeIntervalSince(selected)) }) {
                PointMark(x: .value("Fecha", point.day), y: .value("Peso", point.value))
                    .foregroundStyle(Theme.training)
                    .symbolSize(50)
            }
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartYScale(domain: .automatic(includesZero: false))
        .chartXSelection(value: $selected)
        .sensoryFeedback(.selection, trigger: selected)
    }
}

// MARK: - Sets

enum SetField: Hashable {
    case weight(String)
    case reps(String)
}

/// The value of a set being changed.
enum SetValue: Hashable {
    case weight
    case reps
}

/// A row opened for editing (any but the current one, which is always open), and the value whose −/+ shows.
struct SetEditing: Equatable {
    var id: String
    var value: SetValue? = nil
}

enum SetAction {
    case toggle
    case expand
    case edit(SetValue)
    case close
    case step(SetValue, up: Bool)
    /// In the exercise's unit.
    case setWeight(Double)
    case setReps(Int)
    case remove
}

/// A set. Open (the current one, or one tapped): one horizontal row with the
/// load and repetitions big, last time's small under them and a tall square
/// action on the right ("Hecho", a check to undo, or a quiet one to log it).
/// Otherwise a compact, muted line: what was done with a small check, or the
/// suggestion with a small circle.
struct SetRowView: View {
    let number: Int
    let set: LiveSet
    let previous: SetLog?
    let unit: WeightUnit
    let exerciseId: String
    let needsLoad: Bool
    let current: Bool
    let expanded: Bool
    /// The value whose −/+ is open in this row.
    let editing: SetValue?
    let field: FocusState<SetField?>.Binding
    let act: (SetAction) -> Void

    /// The load in kg: what a done set lifted; an open one on the unit's steps, as "Hecho" will log it.
    private var kg: Double { self.set.done ? self.set.weightKg : unit.snapKg(self.set.weightKg) }
    /// `kg` in the unit, as read.
    private var weight: Double { unit.shown(kg) }
    private var weightText: String { weight > 0 ? "\(WeightUnit.number(weight)) \(unit.rawValue)" : needsLoad ? "Sin peso" : "Peso corporal" }

    var body: some View {
        Group {
            if expanded { full } else { compact }
        }
        .contextMenu {
            if !set.done {
                Button("Eliminar serie", systemImage: "trash", role: .destructive) { act(.remove) }
            }
        }
        .sensoryFeedback(.selection, trigger: set.weightKg)
        .sensoryFeedback(.selection, trigger: set.reps)
    }

    // MARK: Compact

    private var compact: some View {
        Button { act(.expand) } label: {
            HStack(spacing: 10) {
                Text("\(number)")
                    .font(.footnote.bold())
                    .frame(width: 18)
                    .foregroundStyle(.tertiary)
                Text(weightText)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(set.done ? .primary : .secondary)
                Text(TrainingText.repetitions(set.reps))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 4)
                Image(systemName: set.done ? "checkmark.circle.fill" : "circle")
                    .font(.body)
                    .foregroundStyle(set.done ? AnyShapeStyle(Theme.training) : AnyShapeStyle(.tertiary))
                    .contentTransition(.symbolEffect(.replace))
            }
            .fontDesign(.rounded)
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .padding(.horizontal, 12)
            .frame(minHeight: 40)
            .background(set.done ? Theme.training.opacity(0.07) : Color.secondary.opacity(0.05), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Serie \(number): \(TrainingText.load(set.weightKg, reps: set.reps, unit: unit))")
        .accessibilityValue(set.done ? "Hecha" : "Pendiente")
        .accessibilityHint("Abre la serie para cambiarla")
    }

    // MARK: Full

    private var full: some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 18) {
                        valueButton(.weight) { weightLabel }
                        valueButton(.reps) { repsLabel }
                    }
                    .fontDesign(.rounded)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(caption)
                        if weight > 0 {
                            Text(unit.formatBoth(kg)).foregroundStyle(.tertiary)
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
                // A row opened by hand closes with a tap off its numbers.
                .onTapGesture { if !current { act(.close) } }
                action
            }
            if let editing {
                editor(editing)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(12)
        .background(background, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay {
            if current && !set.done {
                RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Theme.training.opacity(0.4), lineWidth: 1)
            }
        }
    }

    /// "Serie 2 · anterior: 70 lb · 8"
    private var caption: String {
        guard let previous else { return "Serie \(number)" }
        return "Serie \(number) · anterior: \(TrainingText.previous(previous.weightKg, reps: previous.reps, unit: unit))"
    }

    private var background: Color {
        if set.done { return Theme.training.opacity(0.12) }
        return current ? Theme.training.opacity(0.08) : Color.secondary.opacity(0.08)
    }

    private func valueButton(_ value: SetValue, @ViewBuilder label: () -> some View) -> some View {
        Button { act(.edit(value)) } label: {
            label()
                .padding(.vertical, 2)
                .overlay(alignment: .bottom) {
                    if editing == value {
                        Capsule().fill(Theme.training).frame(height: 2).offset(y: 3)
                    }
                }
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityHint(editing == value ? "Cierra el ajuste" : "Cambia este valor")
    }

    @ViewBuilder private var weightLabel: some View {
        if weight > 0 {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(WeightUnit.number(weight))
                    .font(.title.bold())
                    .contentTransition(.numericText())
                Text(unit.rawValue).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Peso: \(unit.format(kg))")
        } else if needsLoad {
            Label("Peso", systemImage: "pencil")
                .font(.headline)
                .foregroundStyle(Theme.training)
                .accessibilityLabel("Elige tu peso")
        } else {
            Text("Sin lastre")
                .font(.headline)
                .foregroundStyle(.secondary)
        }
    }

    private var repsLabel: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text("\(set.reps)")
                .font(.title.bold())
                .contentTransition(.numericText())
            Text(set.reps == 1 ? "repetición" : "repeticiones").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    /// The current set's filled "Hecho"; a done set's check (tap to undo); an upcoming one's quiet button.
    @ViewBuilder private var action: some View {
        if current && !set.done {
            Button { act(.toggle) } label: {
                VStack(spacing: 2) {
                    Image(systemName: "checkmark").font(.title3.bold())
                    Text("Hecho").font(.caption.bold())
                }
                .frame(width: 44, height: 48)
            }
            .buttonStyle(.glassProminent)
            .buttonBorderShape(.roundedRectangle(radius: 16))
            .tint(Theme.training)
            .accessibilityLabel("Hecho, serie \(number)")
        } else {
            Button { act(.toggle) } label: {
                Image(systemName: "checkmark")
                    .font(.title3.weight(set.done ? .bold : .semibold))
                    .foregroundStyle(set.done ? AnyShapeStyle(Theme.training) : AnyShapeStyle(.tertiary))
                    .frame(width: 60, height: 60)
                    .background(set.done ? Theme.training.opacity(0.18) : Color.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(set.done ? "Desmarcar serie \(number)" : "Marcar serie \(number) como hecha")
        }
    }

    /// −/+ for one value, typed by tapping the number; the load in the exercise's unit, with kg/lb.
    private func editor(_ value: SetValue) -> some View {
        VStack(spacing: 8) {
            switch value {
            case .weight:
                ValueStepper(label: "Peso", unit: unit.rawValue, value: weight, text: WeightUnit.number, field: .weight(set.id), focus: field, keyboard: .decimalPad,
                             stepLabel: "un disco", step: { act(.step(.weight, up: $0 > 0)) }, commit: { act(.setWeight($0)) })
            case .reps:
                ValueStepper(label: "Repeticiones", unit: "", value: Double(set.reps), text: { "\(Int($0))" }, field: .reps(set.id), focus: field, keyboard: .numberPad,
                             stepLabel: "1", step: { act(.step(.reps, up: $0 > 0)) }, commit: { act(.setReps(Int($0))) })
            }
            HStack {
                if value == .weight { UnitPicker(exerciseId: exerciseId) }
                Spacer(minLength: 8)
                Button("Listo") { act(.close) }
                    .font(.subheadline.weight(.semibold))
                    .buttonStyle(.glass)
            }
        }
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
                            if !unit.isEmpty { Text(unit).font(.headline).foregroundStyle(.secondary) }
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
        // Applied as typed, so "Hecho" right after typing keeps the number.
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

// MARK: - Effort

/// "¿Cuánto te ha costado?" with Apple's 1–10 effort bar. Optional.
private struct EffortCard: View {
    let value: Int?
    let set: (Int?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("¿Cuánto te ha costado?").font(.headline)
                Spacer(minLength: 8)
                if value != nil {
                    Button("Quitar") { set(nil) }
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(value.map(EffortLevel.word) ?? "Toca o desliza")
                    .font(value == nil ? .title3.weight(.semibold) : .title.bold())
                    .fontDesign(.rounded)
                    .foregroundStyle(value.map { AnyShapeStyle(EffortBar.color($0)) } ?? AnyShapeStyle(.secondary))
                    .contentTransition(.interpolate)
                if let value {
                    Text("\(value) de 10").font(.subheadline).foregroundStyle(.secondary).contentTransition(.numericText())
                }
            }
            .animation(.snappy, value: value)
            EffortBar(value: value, set: set)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
    }
}

/// Ten segments filling green → yellow → orange → red, tapped or dragged, with
/// the band names under them.
struct EffortBar: View {
    let value: Int?
    let set: (Int?) -> Void
    @State private var width: CGFloat = 0

    private static let spacing: CGFloat = 4

    static func color(_ level: Int) -> Color {
        Color(hue: 0.33 * (1 - Double(level - 1) / 9), saturation: 0.78, brightness: 0.92)
    }

    private var segment: CGFloat { max(0, (width - Self.spacing * 9) / 10) }

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: Self.spacing) {
                ForEach(EffortLevel.range, id: \.self) { level in
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(level <= (value ?? 0) ? AnyShapeStyle(Self.color(level).gradient) : AnyShapeStyle(Color.secondary.opacity(0.15)))
                        .frame(height: level == value ? 48 : 40)
                }
            }
            .frame(height: 48)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { drag in
                        guard width > 0 else { return }
                        let level = min(max(Int(drag.location.x / width * 10) + 1, EffortLevel.range.lowerBound), EffortLevel.range.upperBound)
                        if level != value { set(level) }
                    }
            )
            .animation(.snappy, value: value)

            HStack(spacing: Self.spacing) {
                ForEach(EffortLevel.bands, id: \.word) { band in
                    Text(band.word)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .frame(width: segment * CGFloat(band.span) + Self.spacing * CGFloat(band.span - 1))
                }
            }
            .accessibilityHidden(true)
        }
        .sensoryFeedback(.selection, trigger: value)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Esfuerzo")
        .accessibilityValue(value.map { "\(EffortLevel.word($0)), \($0) de 10" } ?? "Sin valorar")
        .accessibilityAdjustableAction { direction in
            let next = direction == .increment ? (value ?? 0) + 1 : (value ?? 2) - 1
            set(min(max(next, EffortLevel.range.lowerBound), EffortLevel.range.upperBound))
        }
    }
}

// MARK: - Previews

#if DEBUG
extension TrainingSession {
    /// Five weeks of bench press, rising.
    static var previewHistory: [TrainingSession] {
        let day = 86_400_000.0
        let start = Date.now.timeIntervalSince1970 * 1000 - 35 * day
        return [90, 92.5, 95, 95, 100].enumerated().map { i, kg in
            let at = start + Double(i) * 7 * day
            return TrainingSession(id: "h\(i)", programId: nil, dayId: nil, name: "Torso A", startedAt: at, endedAt: at + 3_600_000, notes: nil,
                                   sets: (0..<4).map { SetLog(exerciseId: "press-banca", setIndex: $0, weightKg: kg, reps: 8 - $0 % 2, rpe: nil, doneAt: at + Double($0) * 200_000) })
        }
    }
}

private struct ExercisePagePreview: View {
    let history: [TrainingSession]
    @State private var session = LiveSession(state: .preview)

    var body: some View {
        NavigationStack {
            ExercisePage(session: session, index: 0, history: history) {}
                .navigationTitle("Torso A")
                .navigationBarTitleDisplayMode(.inline)
        }
    }
}

#Preview("Con historial · 375 pt", traits: .fixedLayout(width: 375, height: 812)) {
    ExercisePagePreview(history: TrainingSession.previewHistory)
}

#Preview("Sin historial · 440 pt, claro", traits: .fixedLayout(width: 440, height: 956)) {
    ExercisePagePreview(history: [])
        .preferredColorScheme(.light)
}

#Preview("Con historial · 375 pt, XXL", traits: .fixedLayout(width: 375, height: 812)) {
    ExercisePagePreview(history: TrainingSession.previewHistory)
        .dynamicTypeSize(.xxLarge)
}

#Preview("Esfuerzo") {
    @Previewable @State var value: Int? = 7
    EffortBar(value: value) { value = $0 }
        .padding()
}
#endif
