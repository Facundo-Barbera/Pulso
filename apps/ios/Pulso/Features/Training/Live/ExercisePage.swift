import Charts
import SwiftUI

/// One strength exercise, top to bottom: its header (photo, name, muscle and
/// target; tapping opens the guide), every set as a row of the same shape — the
/// one up next highlighted with "Hecho", the rest quiet — then the exercise's
/// actions, its best mark and the next exercise. Tapping the load or the
/// repetitions types it in place, with −/+ (and the machine's unit) over the keyboard.
struct ExercisePage: View {
    let session: LiveSession
    let index: Int
    /// The sessions to read history from; the store's when nil.
    var history: [TrainingSession]? = nil
    let swap: () -> Void
    /// "¿Bajaste el peso para terminarla?" under a set just done short of the target.
    @State private var offer: DropOffer?
    @State private var info = false
    @FocusState private var field: SetField?

    private var exercise: LiveExercise? {
        session.state.exercises.indices.contains(index) ? session.state.exercises[index] : nil
    }

    var body: some View {
        if let exercise {
            let sessions = history ?? TrainingStore.shared.sessions
            let last = LiveHistory.last(exercise.exerciseId, in: sessions)
            let unit = TrainingStore.shared.unit(for: exercise.exerciseId)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ExerciseHeader(exercise: exercise, target: exercise.headerTarget(withRest: true)) { info = true }
                    if exercise.skipped {
                        SkippedBanner {
                            withAnimation(.snappy) { session.setSkipped(index, false) }
                        }
                        .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .top)))
                    }
                    sets(exercise, last: last, unit: unit)
                    if exercise.done && exercise.hasDoneWork {
                        EffortCard(value: exercise.effort) { session.setEffort(exercise: index, to: $0) }
                            .transition(.opacity.combined(with: .scale(scale: 0.96)))
                    }
                    actions(exercise)
                    BestCard(exercise: exercise, sessions: sessions, unit: unit)
                    NextCard(session: session, after: index)
                        .padding(.top, 8)
                }
                .padding(.horizontal, Theme.padding)
                .padding(.top, 8)
                .padding(.bottom, 24)
                .animation(.snappy, value: exercise.sets)
                .animation(.snappy, value: offer)
                .animation(.snappy, value: exercise.skipped)
            }
            .scrollDismissesKeyboard(.interactively)
            .setKeyboard($field, session: session)
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
        return VStack(spacing: 8) {
            ForEach(Array(exercise.sets.enumerated()), id: \.element.id) { s, set in
                SetRowView(
                    number: s + 1, set: set, range: exercise.repRange(set), previous: LiveHistory.set(s, of: last), unit: unit,
                    needsLoad: Equipment.needsLoad(exercise.equipment), current: s == current, field: $field
                ) { action in
                    perform(action, set: s, id: set.id)
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
                if let offer, offer.setId == set.id, set.done, set.drops.isEmpty {
                    DropPrompt(drop: offer.drop, unit: unit) {
                        withAnimation(.snappy) {
                            session.addDrop(exercise: index, set: s, offer.drop)
                            self.offer = nil
                        }
                    }
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
        }
        // Quiet and brief: it goes by itself after a few seconds.
        .task(id: offer) {
            guard offer != nil else { return }
            try? await Task.sleep(for: .seconds(6))
            guard !Task.isCancelled else { return }
            withAnimation(.snappy) { offer = nil }
        }
    }

    private func perform(_ action: SetAction, set s: Int, id: String) {
        switch action {
        case .toggle:
            field = nil
            withAnimation(.snappy) {
                session.toggle(exercise: index, set: s)
                offer = done(s).flatMap { set in
                    SetDrop.offer(for: set, repMin: exercise?.repMin ?? 0, unit: session.unit(index)).map { DropOffer(setId: id, drop: $0) }
                }
            }
        case .close: field = nil
        case .addDrop:
            field = nil
            guard let drop = session.nextDrop(exercise: index, set: s) else { return }
            withAnimation(.snappy) { session.addDrop(exercise: index, set: s, drop) }
        case .removeDrop(let d):
            field = nil
            withAnimation(.snappy) { session.removeDrop(exercise: index, set: s, drop: d) }
        default: session.apply(action, exercise: index, set: s)
        }
    }

    /// Set `s` of this exercise, when it is done.
    private func done(_ s: Int) -> LiveSet? {
        exercise.flatMap { $0.sets.indices.contains(s) && $0.sets[s].done ? $0.sets[s] : nil }
    }

    /// Series −/+, "Registrar las 2 que faltan" when more than one is left, and "Cambiar ejercicio".
    private func actions(_ exercise: LiveExercise) -> some View {
        let left = exercise.sets.count { !$0.done }
        return PageActions(
            noun: "Series", count: exercise.sets.count, canRemove: session.state.removableSets(index) > 0,
            add: { withAnimation(.snappy) { session.addSet(exercise: index) } },
            remove: { withAnimation(.snappy) { session.removeLastSet(exercise: index) } },
            logAll: left > 1 && !exercise.skipped ? left : nil
        ) {
            field = nil
            withAnimation(.snappy) { session.completeAll(exercise: index) }
        } links: {
            Button("Cambiar ejercicio", systemImage: "arrow.triangle.2.circlepath", action: swap)
        }
    }
}

extension Equipment {
    /// Whether a set asks for a load: bodyweight and bands go by repetitions.
    static func needsLoad(_ id: String) -> Bool { !["bodyweight", "band"].contains(id) }
}

extension LiveExercise {
    /// "3 × 8–10 reps · descanso 1:30"; without the rest in a superset, which rests after the round.
    func headerTarget(withRest: Bool) -> String {
        let reps = repMin < repMax ? "\(repMin)–\(repMax)" : "\(repMax)"
        let target = "\(sets.count) × \(reps) reps"
        return withRest && restSeconds > 0 ? "\(target) · descanso \(TrainingFormat.rest(restSeconds))" : target
    }
}

// MARK: - Header

/// The exercise up top: its photo, name, main muscle as a chip and the target.
/// Tapping it opens the guide.
struct ExerciseHeader: View {
    let exercise: LiveExercise
    let target: String
    let info: () -> Void

    private var detail: ExerciseDetail? { ExerciseCatalog.shared.details[exercise.exerciseId] }

    var body: some View {
        Button(action: info) {
            HStack(alignment: .center, spacing: 14) {
                ExerciseMediaView(path: detail?.media.thumbnail ?? detail?.media.animation, cornerRadius: 16)
                    .frame(width: 72, height: 72)
                    .saturation(exercise.skipped ? 0 : 1)
                    .opacity(exercise.skipped ? 0.6 : 1)
                VStack(alignment: .leading, spacing: 5) {
                    Text(exercise.name)
                        .font(.title3.bold())
                        .fontDesign(.rounded)
                        .strikethrough(exercise.skipped, color: .secondary)
                        .foregroundStyle(exercise.skipped ? .secondary : .primary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        if let muscle = detail?.primaryMuscles.first?.label {
                            ReasonTag(text: muscle)
                        }
                        Text(target)
                            .font(.subheadline)
                            .fontDesign(.rounded)
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "info.circle")
                    .font(.title3)
                    .foregroundStyle(.tertiary)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Abre la guía y los objetivos de hoy")
    }
}

/// Between a superset's headers: "Superserie" with a link, under the photos.
struct SupersetLink: View {
    var body: some View {
        Label("Superserie", systemImage: "link")
            .font(.caption.weight(.semibold))
            .foregroundStyle(Theme.training)
            .fixedSize()
            .padding(.leading, 6)
            .padding(.vertical, -4)
            .accessibilityLabel("En superserie con el siguiente")
    }
}

/// The screen's actions at the end of its list: how many sets (or rounds) with
/// −/+, "Registrar las N que faltan" when there are several, then quiet links.
struct PageActions<Links: View>: View {
    /// "Series" or "Rondas".
    let noun: String
    let count: Int
    /// The last one isn't done (and isn't the only one).
    let canRemove: Bool
    let add: () -> Void
    let remove: () -> Void
    /// Sets left to log at once; nil hides the button.
    var logAll: Int? = nil
    var log: () -> Void = {}
    @ViewBuilder let links: Links

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Text(noun)
                    .font(.headline)
                    .frame(maxWidth: .infinity, alignment: .leading)
                RoundStepButton(systemImage: "minus", size: 40, action: remove)
                    .disabled(!canRemove)
                    .opacity(canRemove ? 1 : 0.4)
                    .accessibilityLabel("Quitar una")
                Text("\(count)")
                    .font(.title2.bold())
                    .fontDesign(.rounded)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .frame(minWidth: 28)
                    .accessibilityLabel("\(count) \(noun.lowercased())")
                RoundStepButton(systemImage: "plus", size: 40, action: add)
                    .accessibilityLabel("Añadir una")
            }
            .padding(.leading, 16)
            .padding(.trailing, 10)
            .padding(.vertical, 8)
            .background(.background.secondary, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
            .sensoryFeedback(.selection, trigger: count)
            if let logAll {
                Button(action: log) {
                    Label("Registrar las \(logAll) que faltan", systemImage: "checkmark.circle")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.glass)
                .accessibilityHint("Las marca tal como están")
            }
            HStack(spacing: 24) { links }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.training)
                .buttonStyle(.plain)
                .frame(minHeight: 44)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 4)
    }
}

/// "Siguiente" at the end of a page: the next screen's photo, names and target.
/// Nothing when nothing is left.
struct NextCard: View {
    let session: LiveSession
    /// The page's first exercise.
    let after: Int

    var body: some View {
        let state = session.state
        if let next = state.nextPending(after: after) {
            let exercises = state.block(of: next).map { state.exercises[$0] }
            VStack(alignment: .leading, spacing: 8) {
                Text("Siguiente")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.training)
                Button {
                    withAnimation(.snappy) { session.setFocus(next) }
                } label: {
                    HStack(spacing: 12) {
                        ExerciseMediaView(path: exercises.first.flatMap { ExerciseCatalog.shared.details[$0.exerciseId]?.media.thumbnail }, cornerRadius: 12)
                            .frame(width: 52, height: 52)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(exercises.map(\.name).joined(separator: " + "))
                                .font(.headline)
                                .lineLimit(2)
                            Text(target(exercises))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Image(systemName: "chevron.right")
                            .font(.headline)
                            .foregroundStyle(.tertiary)
                    }
                    .padding(12)
                    .background(.background.secondary, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Siguiente: \(exercises.map(\.name).joined(separator: " y "))")
            }
        }
    }

    private func target(_ exercises: [LiveExercise]) -> String {
        guard exercises.count > 1 else { return exercises.first.map { $0.target(TrainingStore.shared.unit(for: $0.exerciseId)) } ?? "" }
        let rounds = exercises.map(\.sets.count).max() ?? 0
        return "Superserie · \(rounds) \(rounds == 1 ? "ronda" : "rondas")"
    }
}

/// "Saltado hoy" with "Retomar": a skipped exercise must not look like one waiting.
struct SkippedBanner: View {
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

/// The number being typed in a set row, by set id.
enum SetField: Hashable {
    case weight(String)
    case reps(String)
    case dropWeight(String, Int)
    case dropReps(String, Int)

    var setId: String {
        switch self {
        case .weight(let id), .reps(let id), .dropWeight(let id, _), .dropReps(let id, _): id
        }
    }

    var value: SetValue {
        switch self {
        case .weight: .weight
        case .reps: .reps
        case .dropWeight(_, let d): .dropWeight(d)
        case .dropReps(_, let d): .dropReps(d)
        }
    }

    /// A load: the keyboard offers the machine's unit with it.
    var isLoad: Bool {
        switch self {
        case .weight, .dropWeight: true
        case .reps, .dropReps: false
        }
    }
}

/// The value of a set being changed: the top segment's, or a drop's (by index).
enum SetValue: Hashable {
    case weight
    case reps
    case dropWeight(Int)
    case dropReps(Int)
}

/// The lighter segment offered under a set just done short of the target.
struct DropOffer: Equatable {
    var setId: String
    var drop: SetSegment
}

enum SetAction {
    case toggle
    case close
    case step(SetValue, up: Bool)
    /// In the exercise's unit.
    case setWeight(Double)
    case setReps(Int)
    /// A drop's load, in the exercise's unit.
    case setDropWeight(Int, Double)
    case setDropReps(Int, Int)
    /// "Otro peso": one more, lighter segment.
    case addDrop
    case removeDrop(Int)
    case remove
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}

extension LiveSession {
    /// A row's change to a value of set `s`; the actions that also move the
    /// view's own state (toggle, close, drops) stay with the view.
    func apply(_ action: SetAction, exercise e: Int, set s: Int) {
        switch action {
        case .step(.weight, let up): withAnimation(.snappy) { stepWeight(exercise: e, set: s, up: up) }
        case .step(.reps, let up): withAnimation(.snappy) { adjustReps(exercise: e, set: s, by: up ? 1 : -1) }
        case .step(.dropWeight(let d), let up): withAnimation(.snappy) { stepDropWeight(exercise: e, set: s, drop: d, up: up) }
        case .step(.dropReps(let d), let up):
            let reps = state.exercises[safe: e]?.sets[safe: s]?.drops[safe: d]?.reps ?? 1
            withAnimation(.snappy) { setDropReps(exercise: e, set: s, drop: d, to: reps + (up ? 1 : -1)) }
        case .setWeight(let value): setWeight(exercise: e, set: s, to: value)
        case .setReps(let reps): setReps(exercise: e, set: s, to: reps)
        case .setDropWeight(let d, let value): setDropWeight(exercise: e, set: s, drop: d, to: value)
        case .setDropReps(let d, let reps): setDropReps(exercise: e, set: s, drop: d, to: reps)
        case .remove: withAnimation(.snappy) { removeSet(exercise: e, set: s) }
        case .toggle, .close, .addDrop, .removeDrop: break
        }
    }
}

extension View {
    /// Over the keyboard while a set's number is typed: −/+ one step, the
    /// machine's unit (kg | lb) on a load, and "Listo".
    func setKeyboard(_ field: FocusState<SetField?>.Binding, session: LiveSession) -> some View {
        toolbar {
            if let focused = field.wrappedValue {
                ToolbarItemGroup(placement: .keyboard) {
                    if let at = session.state.locate(set: focused.setId) {
                        Button("Restar", systemImage: "minus") { session.apply(.step(focused.value, up: false), exercise: at.exercise, set: at.set) }
                            .buttonRepeatBehavior(.enabled)
                        Button("Sumar", systemImage: "plus") { session.apply(.step(focused.value, up: true), exercise: at.exercise, set: at.set) }
                            .buttonRepeatBehavior(.enabled)
                        if focused.isLoad {
                            // Plain text in the same glass group: a segmented picker here nests a capsule in a capsule.
                            let exerciseId = session.state.exercises[at.exercise].exerciseId
                            let unit = TrainingStore.shared.unit(for: exerciseId)
                            Button(unit.rawValue) { _ = TrainingStore.shared.setUnit(unit.other, for: exerciseId) }
                                .fontWeight(.semibold)
                                .contentTransition(.interpolate)
                                .accessibilityLabel("Unidad de esta máquina")
                                .accessibilityValue(unit == .kg ? "kilos" : "libras")
                                .accessibilityHint("Cambia a \(unit.other == .kg ? "kilos" : "libras")")
                        }
                    }
                    Spacer()
                    Button("Listo") { field.wrappedValue = nil }
                        .fontWeight(.semibold)
                }
            }
        }
    }
}

/// "¿Bajaste el peso para terminarla?" with the lighter load and the reps
/// missing, one tap to add them. Quiet: a line, not a card.
private struct DropPrompt: View {
    let drop: SetSegment
    let unit: WeightUnit
    let accept: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "arrow.turn.down.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.training)
            Text("¿Bajaste el peso para terminarla?")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: accept) {
                Text(SetDrop.text([drop], unit: unit))
                    .font(.footnote.weight(.semibold))
                    .fontDesign(.rounded)
                    .monospacedDigit()
                    .lineLimit(1)
            }
            .buttonStyle(.glass)
            .tint(Theme.training)
            .accessibilityLabel("Sí, añadir \(SetDrop.text([drop], unit: unit))")
        }
        .padding(.leading, 14)
        .padding(.trailing, 4)
        .accessibilityElement(children: .contain)
    }
}

/// A set. Open (the current one, or one tapped): one horizontal row with the
/// load and repetitions big, last time's small under them and a tall square
/// action on the right ("Hecho", a check to undo, or a quiet one to log it).
/// Tapping a number types it in place. Until the reps are chosen, an open set
/// shows the target range ("8–10") and "Hecho" logs its top. "Otro peso" and
/// removing live in the long press.
struct SetRowView: View {
    let number: Int
    let set: LiveSet
    /// The target range, while the reps aren't chosen.
    let range: ClosedRange<Int>?
    let previous: SetLog?
    let unit: WeightUnit
    let needsLoad: Bool
    let current: Bool
    let field: FocusState<SetField?>.Binding
    /// In a superset round: the exercise's name, over the numbers. The row then
    /// leaves the card and the action to the round.
    var name: String? = nil
    /// Opens the exercise's guide from its name.
    var info: (() -> Void)? = nil
    let act: (SetAction) -> Void

    /// The load in kg: what a done set lifted; an open one on the unit's steps, as "Hecho" will log it.
    private var kg: Double { self.set.done ? self.set.weightKg : unit.snapKg(self.set.weightKg) }
    /// `kg` in the unit, as read.
    private var weight: Double { unit.shown(kg) }

    /// "8–10" while the range shows, else the reps.
    private var repsNumber: String { range.map { "\($0.lowerBound)–\($0.upperBound)" } ?? "\(set.reps)" }
    private var repsWord: String { range == nil && set.reps == 1 ? "repetición" : "repeticiones" }

    var body: some View {
        full
        .contextMenu {
            if needsLoad && set.drops.count < Self.maxDrops {
                Button("Otro peso", systemImage: "arrow.turn.down.right") { act(.addDrop) }
            }
            if !set.drops.isEmpty {
                Button("Quitar el último peso", systemImage: "minus.circle") { act(.removeDrop(set.drops.count - 1)) }
            }
            if !set.done {
                Button("Eliminar serie", systemImage: "trash", role: .destructive) { act(.remove) }
            }
        }
        .sensoryFeedback(.selection, trigger: set.weightKg)
        .sensoryFeedback(.selection, trigger: set.reps)
        .sensoryFeedback(.selection, trigger: set.drops)
    }

    /// A drop's load in kg, as read and logged: on the unit's steps until the set is done.
    private func kg(_ drop: SetSegment) -> Double { self.set.done ? drop.weightKg : unit.snapKg(drop.weightKg) }

    // MARK: Full

    @ViewBuilder private var full: some View {
        if name != nil {
            content
        } else {
            content
                .padding(12)
                .background(background, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay {
                    if current && !set.done {
                        RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Theme.training.opacity(0.55), lineWidth: 1.5)
                    }
                }
        }
    }

    private var content: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                if let name {
                    Button { info?() } label: {
                        Text(name)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    .buttonStyle(.plain)
                    .disabled(info == nil)
                    .accessibilityHint(info == nil ? "" : "Abre la guía")
                }
                HStack(alignment: .firstTextBaseline, spacing: 18) {
                    weightValue
                    repsValue
                }
                .foregroundStyle(current || set.done ? .primary : .secondary)
                .fontDesign(.rounded)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                ForEach(Array(set.drops.enumerated()), id: \.offset) { d, drop in
                    dropLine(d, drop)
                }
                if let caption {
                    Text(caption)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
            // A row opened by hand closes with a tap off its numbers.
            .onTapGesture { if !current { act(.close) } }
            if name == nil { action }
        }
    }

    /// "Serie 2 · anterior: 70 lb · 8"; in a round just "anterior: 70 lb · 8", or nothing.
    private var caption: String? {
        let last = previous.map { "anterior: \(TrainingText.previous($0.weightKg, reps: $0.reps, unit: unit))" }
        if name != nil { return last }
        return last.map { "Serie \(number) · \($0)" } ?? "Serie \(number)"
    }

    /// The set up next stands out; done ones keep a hint of the accent; the rest wait quietly.
    private var background: Color {
        if current && !set.done { return Theme.training.opacity(0.14) }
        return set.done ? Theme.training.opacity(0.07) : Color.secondary.opacity(0.07)
    }

    @ViewBuilder private var weightValue: some View {
        if needsLoad || weight > 0 {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                InlineNumber(label: "Peso", shown: WeightUnit.number(weight), value: weight, field: .weight(set.id), focus: field,
                             keyboard: .decimalPad, font: .title.bold()) { act(.setWeight($0)) }
                Text(unit.rawValue).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
            }
        } else {
            Text("Sin lastre")
                .font(.headline)
                .foregroundStyle(.secondary)
        }
    }

    private var repsValue: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            InlineNumber(label: "Repeticiones", shown: repsNumber, value: range == nil ? Double(set.reps) : nil, field: .reps(set.id), focus: field,
                         keyboard: .numberPad, font: .title.bold()) { act(.setReps(Int($0))) }
            Text(repsWord).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
        }
    }

    /// "↳ 60 kg  3 repeticiones": a drop, each number typed in place.
    private func dropLine(_ d: Int, _ drop: SetSegment) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: "arrow.turn.down.right")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.training)
                .accessibilityHidden(true)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                InlineNumber(label: "Bajaste a", shown: WeightUnit.number(unit.shown(kg(drop))), value: unit.shown(kg(drop)), field: .dropWeight(set.id, d), focus: field,
                             keyboard: .decimalPad, font: .title3.bold()) { act(.setDropWeight(d, $0)) }
                Text(unit.rawValue).font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            }
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                InlineNumber(label: "Repeticiones después de bajar", shown: "\(drop.reps)", value: Double(drop.reps), field: .dropReps(set.id, d), focus: field,
                             keyboard: .numberPad, font: .title3.bold()) { act(.setDropReps(d, Int($0))) }
                Text(drop.reps == 1 ? "repetición" : "repeticiones").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            }
        }
        .fontDesign(.rounded)
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.6)
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

    /// Segments after the top one a set can have.
    static let maxDrops = 3
}

/// A number shown big that becomes a field when tapped, in the same place and
/// size. The field starts empty with the number as its prompt, so typing
/// replaces it; what's typed applies as it goes, and leaving it empty keeps it.
private struct InlineNumber: View {
    let label: String
    let shown: String
    /// The number shown; nil while a range shows.
    let value: Double?
    let field: SetField
    let focus: FocusState<SetField?>.Binding
    let keyboard: UIKeyboardType
    let font: Font
    let commit: (Double) -> Void
    @State private var typed = ""

    private var editing: Bool { focus.wrappedValue == field }

    var body: some View {
        ZStack(alignment: .leading) {
            TextField("", text: $typed, prompt: Text(shown).foregroundStyle(.tertiary))
                .keyboardType(keyboard)
                .focused(focus, equals: field)
                .fixedSize()
                .opacity(editing ? 1 : 0)
            if !editing {
                Text(shown)
                    .contentTransition(.numericText())
                    .allowsHitTesting(false)
            }
        }
        .font(font)
        .padding(.vertical, 2)
        .overlay(alignment: .bottom) {
            Capsule().fill(Theme.training).frame(height: 2).offset(y: 3).opacity(editing ? 1 : 0)
        }
        .contentShape(.rect)
        .onTapGesture { focus.wrappedValue = field }
        .onChange(of: editing) { _, now in
            if now { typed = "" }
        }
        .onChange(of: typed) { _, new in
            guard editing, let parsed = NumberEntry.parse(new) else { return }
            commit(parsed)
        }
        // −/+ (or the unit) over the keyboard moved the number away from what was
        // typed: the field goes back to showing it as the prompt.
        .onChange(of: value) { _, new in
            guard editing, let typedValue = NumberEntry.parse(typed), let new, abs(typedValue - new) > 0.5 else { return }
            typed = ""
        }
        .accessibilityElement(children: editing ? .contain : .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(shown)
        .accessibilityHint("Toca para escribirlo")
        .accessibilityAddTraits(.isButton)
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
struct EffortCard: View {
    /// The exercise's name, when the screen has more than one.
    var name: String? = nil
    let value: Int?
    let set: (Int?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("¿Cuánto te ha costado?").font(.headline)
                    if let name { Text(name).font(.subheadline).foregroundStyle(.secondary).lineLimit(1) }
                }
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
