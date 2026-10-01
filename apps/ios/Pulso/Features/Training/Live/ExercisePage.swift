import Charts
import SwiftUI

/// One strength exercise: a compact header (thumbnail, name, muscle, notes and
/// guide), the target in words, the best mark with its trend, then every set as
/// a row with the suggested load big and last time's small. The set up next has
/// a big "Hecho"; tapping a row's numbers opens −/+ for load and repetitions.
/// Once the exercise is done it asks, optionally, how hard it felt.
struct ExercisePage: View {
    let session: LiveSession
    let index: Int
    /// The sessions to read history from; the store's when nil.
    var history: [TrainingSession]? = nil
    let swap: () -> Void
    @State private var editing: String?
    @FocusState private var field: SetField?

    private var exercise: LiveExercise? {
        session.state.exercises.indices.contains(index) ? session.state.exercises[index] : nil
    }

    var body: some View {
        if let exercise {
            let sessions = history ?? TrainingStore.shared.sessions
            let last = LiveHistory.last(exercise.exerciseId, in: sessions)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ExerciseHeader(exercise: exercise, position: index + 1, count: session.state.exercises.count)
                    BestCard(exercise: exercise, sessions: sessions)
                    sets(exercise, last: last)
                    if exercise.done && exercise.hasDoneWork {
                        EffortCard(value: exercise.effort) { session.setEffort(exercise: index, to: $0) }
                            .transition(.opacity.combined(with: .scale(scale: 0.96)))
                    }
                    actions(exercise)
                }
                .padding(.horizontal, Theme.padding)
                .padding(.top, 4)
                .padding(.bottom, 24)
                .animation(.snappy, value: exercise.sets)
                .animation(.snappy, value: editing)
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

    private func sets(_ exercise: LiveExercise, last: LiveHistory.Last?) -> some View {
        let current = exercise.sets.firstIndex { !$0.done }
        return VStack(spacing: 8) {
            ForEach(Array(exercise.sets.enumerated()), id: \.element.id) { s, set in
                SetRowView(
                    number: s + 1, set: set, previous: LiveHistory.set(s, of: last), step: exercise.weightStep,
                    needsLoad: Equipment.needsLoad(exercise.equipment), current: s == current, editing: editing == set.id, field: $field
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
        case .edit: withAnimation(.snappy) { editing = editing == id ? nil : id }
        case .weight(let steps): withAnimation(.snappy) { session.adjustWeight(exercise: index, set: s, by: steps) }
        case .reps(let delta): withAnimation(.snappy) { session.adjustReps(exercise: index, set: s, by: delta) }
        case .setWeight(let kg): session.setWeight(exercise: index, set: s, to: kg)
        case .setReps(let reps): session.setReps(exercise: index, set: s, to: reps)
        case .remove: withAnimation(.snappy) { session.removeSet(exercise: index, set: s) }
        }
    }

    private func actions(_ exercise: LiveExercise) -> some View {
        let left = exercise.sets.count { !$0.done }
        return VStack(spacing: 10) {
            AdaptiveStack(spacing: 10) {
                if left > 1 {
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

/// Thumbnail, "Ejercicio 2 de 6", the name and muscle, the notes and the guide;
/// then the target and the one line of advice.
private struct ExerciseHeader: View {
    let exercise: LiveExercise
    let position: Int
    let count: Int
    @State private var showNotes = false

    private var detail: ExerciseDetail? { ExerciseCatalog.shared.details[exercise.exerciseId] }
    private var route: ExerciseRoute { ExerciseRoute(exerciseId: exercise.exerciseId, name: exercise.name) }
    private var notes: String? { exercise.notes.flatMap { $0.isEmpty ? nil : $0 } }
    private var muscle: String? { detail?.primaryMuscles.first?.label }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 12) {
                NavigationLink(value: route) {
                    ExerciseMediaView(path: detail?.media.thumbnail ?? detail?.media.animation, cornerRadius: 14)
                        .frame(width: 64, height: 64)
                        .saturation(exercise.skipped ? 0 : 1)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Ver la guía de \(exercise.name)")

                VStack(alignment: .leading, spacing: 4) {
                    Text("Ejercicio \(position) de \(count)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(exercise.name)
                        .font(.title3.bold())
                        .fontDesign(.rounded)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 6) {
                        if exercise.supersetId != nil { GlassChip("Superserie", systemImage: "link", tint: Theme.training) }
                        if let muscle { GlassChip(muscle, systemImage: "figure.strengthtraining.traditional") }
                        if exercise.skipped { GlassChip("Saltado hoy", systemImage: "forward") }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                HStack(spacing: 6) {
                    if let notes {
                        Button { showNotes = true } label: {
                            Image(systemName: "text.quote").frame(width: 44, height: 44)
                        }
                        .accessibilityLabel("Notas")
                        .popover(isPresented: $showNotes) {
                            Text(notes)
                                .font(.callout)
                                .padding()
                                .frame(maxWidth: 320, alignment: .leading)
                                .fixedSize(horizontal: false, vertical: true)
                                .presentationCompactAdaptation(.popover)
                        }
                    }
                    NavigationLink(value: route) {
                        Image(systemName: "info.circle").frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("Cómo se hace")
                }
                .font(.title3)
                .foregroundStyle(Theme.training)
                .buttonStyle(.plain)
                .glassEffect(.regular.interactive(), in: .capsule)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(exercise.prescription)
                    .font(.headline)
                    .fontDesign(.rounded)
                    .foregroundStyle(Theme.training)
                    .contentTransition(.numericText())
                if let guidance = exercise.guidance {
                    Text(guidance)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

// MARK: - Best mark

/// "Mejor marca": the heaviest load on this exercise, its trend per session and
/// today's goal. Hidden without history.
private struct BestCard: View {
    let exercise: LiveExercise
    let sessions: [TrainingSession]
    @State private var selected: Date?

    private struct Point: Identifiable {
        var day: Date
        var kg: Double
        var id: Date { day }
    }

    private var points: [Point] {
        sessions
            .compactMap { session in
                let top = session.sets.filter { $0.exerciseId == exercise.exerciseId && $0.reps > 0 }.map(\.weightKg).max()
                return top.flatMap { $0 > 0 ? Point(day: session.start, kg: $0) : nil }
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
        return "Siguiente meta: \((best.weightKg + exercise.weightStep).formatted()) kg"
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
                            Text((shown?.kg ?? best.weightKg).formatted())
                                .font(.title2.bold())
                                .contentTransition(.numericText())
                            Text("kg").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                        }
                        .fontDesign(.rounded)
                        if shown == nil {
                            Text("con \(TrainingText.repetitions(best.reps))").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .animation(.snappy, value: shown?.kg)

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
        let low = (points.map(\.kg).min() ?? 0) * 0.9
        return Chart {
            ForEach(points) { point in
                AreaMark(x: .value("Fecha", point.day), yStart: .value("Base", low), yEnd: .value("Peso", point.kg))
                    .foregroundStyle(LinearGradient(colors: [Theme.training.opacity(0.35), Theme.training.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                    .interpolationMethod(.monotone)
                LineMark(x: .value("Fecha", point.day), y: .value("Peso", point.kg))
                    .foregroundStyle(Theme.training)
                    .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
                    .interpolationMethod(.monotone)
            }
            if let selected, let point = points.min(by: { abs($0.day.timeIntervalSince(selected)) < abs($1.day.timeIntervalSince(selected)) }) {
                PointMark(x: .value("Fecha", point.day), y: .value("Peso", point.kg))
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

enum SetAction {
    case toggle
    case edit
    case weight(Double)
    case reps(Int)
    case setWeight(Double)
    case setReps(Int)
    case remove
}

/// A set as a row: the load and repetitions big, last time's small below.
/// The one up next is highlighted with "Hecho"; tapping the numbers opens −/+.
struct SetRowView: View {
    let number: Int
    let set: LiveSet
    let previous: SetLog?
    let step: Double
    let needsLoad: Bool
    let current: Bool
    let editing: Bool
    let field: FocusState<SetField?>.Binding
    let act: (SetAction) -> Void

    private var highlighted: Bool { current || editing }

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                badge
                Button { act(.edit) } label: { numbers }
                    .buttonStyle(.plain)
                    .accessibilityHint(editing ? "Cierra los ajustes" : "Cambia peso y repeticiones")
                Spacer(minLength: 0)
                if !current || set.done { check }
            }
            if editing { steppers }
            if current && !set.done {
                Button { act(.toggle) } label: {
                    Label("Hecho", systemImage: "checkmark")
                        .font(.title3.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 52)
                }
                .buttonStyle(.glassProminent)
                .tint(Theme.training)
                .accessibilityLabel("Hecho, serie \(number)")
            } else if editing {
                Button("Listo") { act(.edit) }
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .buttonStyle(.glass)
            }
        }
        .padding(12)
        .background(background, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay {
            if highlighted {
                RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Theme.training.opacity(0.4), lineWidth: 1)
            }
        }
        .contextMenu {
            if !set.done {
                Button("Eliminar serie", systemImage: "trash", role: .destructive) { act(.remove) }
            }
        }
        .sensoryFeedback(.selection, trigger: set.weightKg)
        .sensoryFeedback(.selection, trigger: set.reps)
    }

    private var background: Color {
        if set.done { return Theme.training.opacity(0.12) }
        return highlighted ? Theme.training.opacity(0.08) : Color.secondary.opacity(0.08)
    }

    private var badge: some View {
        ZStack {
            Circle().fill(set.done || highlighted ? Theme.training.opacity(0.2) : Color.secondary.opacity(0.12))
            if set.done {
                Image(systemName: "checkmark").font(.subheadline.bold()).transition(.scale.combined(with: .opacity))
            } else {
                Text("\(number)").font(.subheadline.bold()).fontDesign(.rounded)
            }
        }
        .foregroundStyle(set.done || highlighted ? Theme.training : .secondary)
        .frame(width: 32, height: 32)
        .accessibilityHidden(true)
    }

    private var numbers: some View {
        VStack(alignment: .leading, spacing: 2) {
            if editing {
                Text("Serie \(number)").font(.headline)
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    if set.weightKg > 0 || !needsLoad {
                        if set.weightKg > 0 {
                            Text(set.weightKg.formatted())
                                .font(.title2.bold())
                                .contentTransition(.numericText())
                            Text("kg").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                            Text("·").font(.title3).foregroundStyle(.tertiary)
                        }
                    } else {
                        Label("Elige tu peso", systemImage: "pencil")
                            .font(.headline)
                            .foregroundStyle(Theme.training)
                        Text("·").font(.title3).foregroundStyle(.tertiary)
                    }
                    Text("\(set.reps)")
                        .font(.title2.bold())
                        .contentTransition(.numericText())
                    Text(set.reps == 1 ? "repetición" : "repeticiones").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                }
                .fontDesign(.rounded)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            }
            if let previous {
                Text("Última vez: \(TrainingText.load(previous.weightKg, reps: previous.reps))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Serie \(number): \(TrainingText.load(set.weightKg, reps: set.reps))")
    }

    private var check: some View {
        Button { act(.toggle) } label: {
            Image(systemName: set.done ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 30))
                .foregroundStyle(set.done ? Theme.training : Color.secondary.opacity(0.6))
                .contentTransition(.symbolEffect(.replace))
                .frame(width: 52, height: 52)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(set.done ? "Desmarcar serie \(number)" : "Marcar serie \(number) como hecha")
    }

    private var steppers: some View {
        VStack(spacing: 10) {
            ValueStepper(label: "Peso", unit: "kg", value: set.weightKg, text: { $0.formatted() }, field: .weight(set.id), focus: field, keyboard: .decimalPad,
                         stepLabel: "\(step.formatted()) kg", step: { act(.weight($0)) }, commit: { act(.setWeight($0)) })
            ValueStepper(label: "Repeticiones", unit: "", value: Double(set.reps), text: { "\(Int($0))" }, field: .reps(set.id), focus: field, keyboard: .numberPad,
                         stepLabel: "1", step: { act(.reps(Int($0))) }, commit: { act(.setReps(Int($0))) })
        }
        .transition(.opacity.combined(with: .move(edge: .top)))
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
