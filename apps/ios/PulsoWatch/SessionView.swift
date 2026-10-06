import SwiftUI
import WatchKit

/// The Watch's screens. Without a session: the next day and "Empezar". In a
/// session, pages side by side as in the Workout app: the session's controls
/// on the left (end and save, discard, pause the recording), the workout in
/// the middle where it opens, the music on the right. The workout is two views
/// one above the other (the Crown moves between them): the time and numbers,
/// and below it the sets ("Hecho", load and reps, the rest, the cardio block).
struct SessionView: View {
    let store: WatchSessionStore
    let workout: WorkoutManager
    @State private var page = Page.workout
    @State private var view = WorkoutView.time
    /// The session the 3, 2, 1 was shown for.
    @State private var counted: String?

    private enum Page { case controls, workout, music }
    private enum WorkoutView { case time, sets }

    var body: some View {
        if let state = store.state {
            TabView(selection: $page) {
                ControlsPage(store: store, workout: workout).tag(Page.controls)
                NavigationStack {
                    TabView(selection: $view) {
                        MetricsPage(state: state, workout: workout).tag(WorkoutView.time)
                        NowPage(store: store, state: state).tag(WorkoutView.sets)
                    }
                    .tabViewStyle(.verticalPage)
                }
                .tag(Page.workout)
                NowPlayingView().tag(Page.music)
            }
            .tabViewStyle(.page)
            // On the time whenever a session (re)opens: the page view doesn't take its first selection.
            .task(id: state.id) {
                try? await Task.sleep(for: .milliseconds(50))
                page = .workout
                view = .time
            }
            .overlay {
                // Just started (here or on the phone): 3, 2, 1 as the Workout app does.
                if counted != state.id, Date().timeIntervalSince(state.startedAt) < 10 {
                    Countdown { counted = state.id }
                }
            }
        } else {
            IdlePage(store: store)
        }
    }
}

// MARK: - Idle

private struct IdlePage: View {
    let store: WatchSessionStore

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "dumbbell.fill")
                .font(.system(size: 30))
                .foregroundStyle(.tint)
            if let plan = store.plan {
                VStack(spacing: 2) {
                    Text("Siguiente").font(.footnote).foregroundStyle(.secondary)
                    Text(plan.day.name).font(.headline).multilineTextAlignment(.center)
                }
                Button("Empezar", systemImage: "play.fill") { store.start() }
                    .buttonStyle(.borderedProminent)
                    .tint(.accentColor)
            } else {
                Text("Abre Pulso en tu iPhone una vez para traer tu plan.")
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 4)
    }
}

// MARK: - Now

private struct NowPage: View {
    let store: WatchSessionStore
    let state: LiveSessionState
    @State private var editing: Editing?

    struct Editing: Identifiable {
        var exercise: Int
        var set: Int
        var weight: Bool
        var id: String { "\(exercise)-\(set)-\(weight)" }
    }

    /// The pending cardio block to offer once no strength set is left.
    private var cardioIndex: Int? {
        if let running = state.runningCardio { return state.exercises.firstIndex { $0.id == running.id } }
        if state.current == nil { return state.exercises.firstIndex { $0.isCardio && $0.pending } }
        return nil
    }

    /// What the page is about, in the clock's line.
    private var heading: String? {
        if state.resting(at: .now) { return "DESCANSO" }
        if let cardio = cardioIndex { return state.exercises[cardio].name.uppercased() }
        guard let current = state.current else { return nil }
        if let group = state.superset(of: current.exercise) {
            return "RONDA \((state.currentRound(group) ?? current.set) + 1)/\(state.rounds(group))"
        }
        return "SERIE \(current.set + 1)/\(state.exercises[current.exercise].sets.count)"
    }

    var body: some View {
        page
            .toolbar {
                if let heading {
                    ToolbarItem(placement: .topBarLeading) {
                        Text(heading)
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(.tint)
                            .lineLimit(1)
                    }
                }
            }
    }

    private var page: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    if state.resting(at: context.date), let end = state.restEndsAt {
                        rest(until: end, now: context.date)
                    } else if let cardio = cardioIndex {
                        CardioNow(store: store, state: state, index: cardio, now: context.date)
                    } else if let current = state.current {
                        strength(current)
                    } else {
                        done
                    }
                }
                if store.unsent > 0 {
                    Label("\(store.unsent) por enviar al iPhone", systemImage: "iphone.slash")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .sheet(item: $editing) { target in
            ValueEditor(store: store, exercise: target.exercise, set: target.set, weight: target.weight)
        }
    }

    // MARK: Strength

    @ViewBuilder private func strength(_ current: (exercise: Int, set: Int)) -> some View {
        let group = state.superset(of: current.exercise)
        let round = group.flatMap { state.currentRound($0) } ?? current.set
        let members = group.map { Array($0) } ?? [current.exercise]
        ForEach(members, id: \.self) { e in
            if let set = state.exercises[e].sets[safe: round], !state.exercises[e].skipped {
                line(e, round, set)
            }
        }
        Button {
            store.done()
        } label: {
            Label("Hecho", systemImage: "checkmark")
                .font(.headline)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .tint(.accentColor)
        .padding(.top, 2)
    }

    private func line(_ e: Int, _ s: Int, _ set: LiveSet) -> some View {
        let exercise = state.exercises[e]
        let unit = store.unit(e)
        return VStack(alignment: .leading, spacing: 0) {
            Text(exercise.name)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            HStack(spacing: 14) {
                if Equipment.needsLoad(exercise.equipment) {
                    Button { editing = Editing(exercise: e, set: s, weight: true) } label: {
                        MetricText(WeightUnit.number(unit.shown(unit.snapKg(set.weightKg))), unit.rawValue.uppercased(), size: 34)
                    }
                }
                Button { editing = Editing(exercise: e, set: s, weight: false) } label: {
                    MetricText(exercise.repRange(set).map { "\($0.lowerBound)–\($0.upperBound)" } ?? "\(set.reps)", "REPS", size: 34)
                }
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: Rest

    @ViewBuilder private func rest(until end: Date, now: Date) -> some View {
        let left = max(0, end.timeIntervalSince(now))
        Text(Duration.seconds(left.rounded(.up)).formatted(.time(pattern: .minuteSecond)))
            .font(.system(size: 64, weight: .semibold, design: .rounded))
            .monospacedDigit()
            .contentTransition(.numericText(countsDown: true))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
        if let next = state.current {
            let exercise = state.exercises[next.exercise]
            Text("Sigue: \(exercise.name)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        Button("Saltar", systemImage: "forward.fill") { store.skipRest() }
            .buttonStyle(.bordered)
    }

    // MARK: Done

    @ViewBuilder private var done: some View {
        Label("Sesión completa", systemImage: "checkmark.seal.fill")
            .font(.headline)
            .foregroundStyle(.tint)
        Text("\(state.setsDone) series hechas")
            .font(.footnote)
            .foregroundStyle(.secondary)
        Button("Terminar y guardar", systemImage: "flag.checkered") { store.finish(save: true) }
            .buttonStyle(.borderedProminent)
            .tint(.accentColor)
    }
}

/// A cardio block: its target, its clock, start/pause and "Terminar bloque".
private struct CardioNow: View {
    let store: WatchSessionStore
    let state: LiveSessionState
    let index: Int
    let now: Date

    var body: some View {
        let exercise = state.exercises[index]
        let clock = state.cardioClock?.exerciseId == exercise.id ? state.cardioClock : nil
        let running = clock?.running ?? false
        VStack(alignment: .leading, spacing: 6) {
            if let summary = exercise.cardio?.summary {
                Text(summary).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            Text(Duration.seconds((clock?.elapsed(at: now) ?? 0).rounded(.down)).formatted(.time(pattern: .minuteSecond)))
                .font(.system(size: 40, weight: .bold, design: .rounded))
                .monospacedDigit()
            HStack {
                Button {
                    running ? store.pauseCardio() : store.startCardio(index)
                } label: {
                    Image(systemName: running ? "pause.fill" : "play.fill")
                }
                .tint(running ? .yellow : .green)
                .accessibilityLabel(running ? "Pausar" : "Empezar")
                Button {
                    store.finishCardio(index)
                } label: {
                    Image(systemName: "checkmark")
                }
                .tint(.accentColor)
                .disabled(clock == nil)
                .accessibilityLabel("Terminar bloque")
            }
            .buttonStyle(.bordered)
        }
    }
}

/// One number of a set. The Digital Crown is precise: turned slowly the weight
/// moves by 0,25 kg (0,5 lb) for odd plates and dumbbells, turned fast by the
/// equipment's step; the reps take two clicks each, so they don't run away.
/// −/+ go by the equipment's step (one rep). What's turned shows at once and
/// reaches the session once the Crown rests.
private struct ValueEditor: View {
    let store: WatchSessionStore
    let exercise: Int
    let set: Int
    let weight: Bool
    @State private var crown = 0.0
    @State private var ticks = 0
    @State private var lastTick = Date.distantPast
    /// The value being turned (in the unit, or reps); nil shows the session's.
    @State private var value: Double?
    @State private var commit: Task<Void, Never>?
    @Environment(\.dismiss) private var dismiss

    /// Clicks of the Crown per rep.
    private static let repClicks = 2
    /// Clicks closer than this are a fast turn.
    private static let fast = 0.06

    private var unit: WeightUnit { store.unit(exercise) }
    private var fine: Double { unit == .kg ? 0.25 : 0.5 }
    private var current: LiveSet? { store.state?.exercises[safe: exercise]?.sets[safe: set] }

    /// The session's value: the load in the unit, or the reps (the range's top while it shows).
    private var stored: Double {
        guard let current, let ex = store.state?.exercises[safe: exercise] else { return 0 }
        return weight ? unit.shown(unit.snapKg(current.weightKg)) : Double(ex.repRange(current)?.upperBound ?? current.reps)
    }

    private var text: String {
        if let value { return weight ? WeightUnit.number(value) : "\(Int(value))" }
        guard let current, let ex = store.state?.exercises[safe: exercise] else { return "" }
        if weight { return WeightUnit.number(stored) }
        return ex.repRange(current).map { "\($0.lowerBound)–\($0.upperBound)" } ?? "\(current.reps)"
    }

    var body: some View {
        VStack(spacing: 6) {
            Text(weight ? "PESO" : "REPETICIONES")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.tint)
            MetricText(text, weight ? unit.rawValue.uppercased() : "REPS", size: 46)
            HStack {
                Button { step(-1, coarse: true) } label: { Image(systemName: "minus") }
                Button { step(1, coarse: true) } label: { Image(systemName: "plus") }
                if weight {
                    // This machine's unit, for every session.
                    Button(unit.other.rawValue) {
                        save()
                        store.setUnit(unit.other, exercise: exercise)
                    }
                    .accessibilityLabel("Cambiar a \(unit.other == .kg ? "kilos" : "libras")")
                }
            }
            .buttonStyle(.bordered)
            Button("Listo") { dismiss() }
                .buttonStyle(.borderedProminent)
                .tint(.accentColor)
        }
        .focusable()
        .digitalCrownRotation($crown, from: -100_000, through: 100_000, by: 1, sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: false)
        .onChange(of: crown) { _, turned in
            let target = Int(turned.rounded())
            while ticks != target {
                let up = target > ticks
                ticks += up ? 1 : -1
                if weight {
                    let now = Date()
                    step(up ? 1 : -1, coarse: now.timeIntervalSince(lastTick) < Self.fast)
                    lastTick = now
                } else if ticks % Self.repClicks == 0 {
                    step(up ? 1 : -1, coarse: false)
                }
            }
        }
        .onDisappear(perform: save)
    }

    private func step(_ direction: Int, coarse: Bool) {
        let from = value ?? stored
        let next: Double
        if !weight {
            next = max(0, from + Double(direction))
        } else if coarse {
            next = direction > 0 ? unit.stepUp(from) : unit.stepDown(from)
        } else {
            next = max(0, ((from / fine).rounded() + Double(direction)) * fine)
        }
        guard next != from else { return }
        value = next
        WKInterfaceDevice.current().play(.click)
        commit?.cancel()
        commit = Task {
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            save()
        }
    }

    /// What's turned, into the session (one edit for the phone, not one per click).
    private func save() {
        commit?.cancel()
        guard let value else { return }
        if weight {
            store.setWeight(exercise: exercise, set: set, to: value)
        } else {
            store.setReps(exercise: exercise, set: set, to: Int(value))
        }
        self.value = nil
    }
}

// MARK: - Metrics

/// As the Workout app: the time large (hundredths while the screen is up), the
/// rest as a bar while it runs, heart rate, energy, and the distance on a walk
/// or run; values in white.
private struct MetricsPage: View {
    let state: LiveSessionState
    let workout: WorkoutManager
    @Environment(\.isLuminanceReduced) private var dimmed

    private var walking: Bool { workout.stage?.countsSteps ?? false }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            // Hundredths while the screen is up; whole seconds when the wrist is down.
            TimelineView(.periodic(from: .now, by: dimmed || workout.paused ? 1 : 1.0 / 30)) { context in
                VStack(alignment: .leading, spacing: 2) {
                    Text(clock(workout.elapsed(at: context.date), hundredths: !dimmed))
                        .font(.system(size: 46, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(workout.paused ? Color.secondary : Color.yellow)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    if state.resting(at: context.date), let start = state.restStartedAt, let end = state.restEndsAt {
                        RestBar(start: start, end: end, now: context.date).padding(.vertical, 4)
                    }
                }
            }
            heartLine
            if walking, let meters = workout.distanceMeters {
                MetricText((meters / 1000).formatted(.number.precision(.fractionLength(2))), "KM")
            }
            MetricText("\(Int(workout.activeKcal.rounded()))", "KCAL\nACTIVAS")
            MetricText(workout.totalKcal.map { "\(Int($0.rounded()))" } ?? "--", "KCAL\nTOTALES")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .toolbar {
            // What the Watch is recording, in the clock's line.
            ToolbarItem(placement: .topBarLeading) {
                Image(systemName: workout.stage?.symbol ?? "dumbbell.fill")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.tint)
                    .frame(width: 34, height: 34)
                    .background(Color.accentColor.opacity(0.25), in: .circle)
            }
        }
    }

    private var heartLine: some View {
        HStack(alignment: .lastTextBaseline, spacing: 4) {
            Text(workout.heartRate.map { "\(Int($0.rounded()))" } ?? "--")
                .font(.system(size: 36, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .contentTransition(.numericText())
                .animation(.snappy, value: workout.heartRate)
            Image(systemName: "heart.fill")
                .font(.system(size: 22))
                .foregroundStyle(.red)
                .symbolEffect(.pulse, isActive: workout.heartRate != nil && !workout.paused)
        }
    }

    /// 08:23.47 (01:08:23.47 past an hour); without the hundredths when dimmed.
    private func clock(_ seconds: TimeInterval, hundredths: Bool) -> String {
        let d = Duration.seconds(seconds.rounded(.down))
        let whole = seconds >= 3600 ? d.formatted(.time(pattern: .hourMinuteSecond)) : d.formatted(.time(pattern: .minuteSecond(padMinuteToLength: 2)))
        guard hundredths else { return whole }
        return whole + String(format: ".%02d", Int(seconds * 100) % 100)
    }
}

/// A number with its unit stacked small beside it, as the Workout app does.
private struct MetricText: View {
    let value: String
    let unit: String
    var tint: Color = .primary
    var size: CGFloat = 36

    init(_ value: String, _ unit: String, tint: Color = .primary, size: CGFloat = 36) {
        self.value = value
        self.unit = unit
        self.tint = tint
        self.size = size
    }

    var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: 3) {
            Text(value)
                .font(.system(size: size, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .contentTransition(.numericText())
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            Text(unit)
                .font(.system(size: 13, weight: .bold))
                .lineSpacing(-3)
                .fixedSize()
        }
        .foregroundStyle(tint)
        .animation(.snappy, value: value)
    }
}

/// The rest as a filling bar, with the seconds left in a bubble riding it.
private struct RestBar: View {
    let start: Date
    let end: Date
    let now: Date

    var body: some View {
        let total = max(1, end.timeIntervalSince(start))
        let left = max(0, end.timeIntervalSince(now))
        let progress = 1 - left / total
        GeometryReader { geo in
            let bubble = 52.0
            ZStack(alignment: .leading) {
                Capsule().fill(Color.accentColor.opacity(0.3)).frame(height: 10)
                Capsule().fill(Color.accentColor).frame(width: max(10, geo.size.width * progress), height: 10)
                Text(Duration.seconds(left.rounded(.up)).formatted(.time(pattern: .minuteSecond)))
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.black)
                    .frame(width: bubble, height: 24)
                    .background(Color.accentColor, in: .capsule)
                    .offset(x: min(max(0, geo.size.width * progress - bubble / 2), geo.size.width - bubble))
            }
            .frame(maxHeight: .infinity)
        }
        .frame(height: 24)
        .animation(.linear(duration: 1), value: progress)
    }
}

// MARK: - Countdown

/// 3, 2, 1 in a ring that empties each second, then out of the way.
private struct Countdown: View {
    let done: () -> Void
    @State private var count = 3
    @State private var progress = 1.0

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            Circle()
                .stroke(Color.accentColor.opacity(0.25), lineWidth: 10)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(count)")
                .font(.system(size: 80, weight: .bold, design: .rounded))
                .contentTransition(.numericText(countsDown: true))
        }
        .padding(18)
        .task {
            for n in stride(from: 3, through: 1, by: -1) {
                withAnimation(.snappy) { count = n }
                progress = 1
                withAnimation(.linear(duration: 1)) { progress = 0 }
                WKInterfaceDevice.current().play(.click)
                try? await Task.sleep(for: .seconds(1))
            }
            WKInterfaceDevice.current().play(.start)
            done()
        }
    }
}

// MARK: - Controls

private struct ControlsPage: View {
    let store: WatchSessionStore
    let workout: WorkoutManager
    @State private var confirmDiscard = false

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Button("Terminar y guardar", systemImage: "flag.checkered") { store.finish(save: true) }
                    .buttonStyle(.borderedProminent)
                    .tint(.accentColor)
                Button(workout.paused ? "Seguir grabando" : "Pausar grabación", systemImage: workout.paused ? "play.fill" : "pause.fill") {
                    workout.paused ? workout.resume() : workout.pause()
                }
                .tint(.yellow)
                Button("Descartar sesión", systemImage: "trash", role: .destructive) { confirmDiscard = true }
            }
        }
        .confirmationDialog("¿Descartar la sesión?", isPresented: $confirmDiscard) {
            Button("Descartar", role: .destructive) { store.finish(save: false) }
            Button("Seguir", role: .cancel) {}
        } message: {
            Text("Se pierde lo registrado, aquí y en el iPhone.")
        }
    }
}
