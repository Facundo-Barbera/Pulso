import SwiftUI

/// Entreno: one hero (this week's progress and the next workout with its big
/// "Empezar"), then the weeks of every block with what happened each day, then
/// recent sessions and the program's notes. A day opens as a sheet with its
/// exercises; edits, preferences, units and the Coach live in the menu.
struct TrainingView: View {
    let model: PulsoModel
    @State private var store = TrainingStore.shared
    @State private var showLive = false
    @State private var previewing: DayRoute?
    /// Set by the day sheet's "Empezar"; started once the sheet is gone.
    @State private var pendingStart: ProgramDay?
    @State private var openedSession: TrainingSession?
    @State private var repeating: ProgramDay?
    @State private var confirmNextWeek = false
    @State private var resuming: TrainingBlock?
    @State private var editingDay: ProgramDay?
    @State private var showPreferences = false
    /// nil follows the current week.
    @State private var selectedWeek: WeekRef?
    @Environment(\.askCoach) private var askCoach

    /// For exercises without their own unit, and for totals. Each machine can still say otherwise.
    private var defaultUnit: Binding<WeightUnit> {
        Binding(get: { store.defaultUnit }, set: { unit in Task { await store.setDefaultUnit(unit) } })
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let live = store.live {
                    ResumeCard(live: live) { showLive = true }
                }
                if let program = store.program {
                    NextWorkoutHero(
                        program: program,
                        block: store.activeBlock,
                        showBlock: store.blocks.count > 1,
                        day: store.nextDay,
                        adjustment: store.adjustment,
                        weightKg: store.bodyWeightKg,
                        running: store.live != nil,
                        actions: HeroActions(
                            start: start,
                            preview: { day in preview(day) },
                            startNextWeek: { confirmNextWeek = true },
                            askCoach: { askCoach($0, send: false) }
                        )
                    )
                    if !store.blocks.isEmpty {
                        WeekBrowser(
                            blocks: store.blocks,
                            nextDayId: store.nextDayId,
                            selection: $selectedWeek,
                            actions: WeekActions(
                                openSession: { open($0.id) },
                                preview: { block, week, day in previewing = DayRoute(programId: block.programId, dayId: day.dayId, week: week.number) },
                                repeatDay: { day in repeating = program.days.first { $0.id == day.dayId } },
                                resume: { resuming = $0 }
                            )
                        )
                    }
                    if !store.sessions.isEmpty {
                        RecentSessions(sessions: store.sessions) { open($0.id) }
                    }
                    ProgramNotes(program: program)
                } else if store.loaded {
                    EmptyProgram()
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 80)
                }
            }
            .padding(.horizontal, Theme.padding)
            .padding(.bottom, 32)
            .animation(.snappy, value: store.program)
            .animation(.snappy, value: store.adjustment)
        }
        .navigationTitle("Entreno")
        .navigationDestination(for: ExerciseRoute.self) { ExerciseDetailView(exerciseId: $0.exerciseId, name: $0.name) }
        .toolbar {
            if store.program != nil {
                ToolbarItem(placement: .topBarTrailing) { menu }
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .onAppear(perform: openRequestedLive)
        .onChange(of: store.liveRequested) { openRequestedLive() }
        .fullScreenCover(isPresented: $showLive, onDismiss: finishIfRequested) {
            if let live = store.live {
                LiveSessionView(session: live, store: store)
            }
        }
        // Reads the store, not the closure's value: records arrive after the sheet opens.
        .sheet(item: $store.summary) { opened in SessionSummaryView(summary: store.summary ?? opened) }
        .sheet(item: $openedSession) { session in SessionSummaryView(summary: SessionSummary(session: session, uploaded: true)) }
        .sheet(item: $previewing, onDismiss: startPending) { route in
            DayDetailView(route: route) { pendingStart = $0 }
        }
        .sheet(item: $editingDay) { day in
            DayEditorView(day: day, suggestions: store.suggestions, hrZones: store.hrZones)
        }
        .sheet(isPresented: $showPreferences) { TrainingPreferencesView() }
        .confirmationDialog("¿Repetir \(repeating?.name ?? "este día")?", isPresented: Binding(get: { repeating != nil }, set: { if !$0 { repeating = nil } }), titleVisibility: .visible, presenting: repeating) { day in
            Button("Repetir \(day.name)") { start(day) }
        } message: { _ in
            Text("Ya lo hiciste esta semana. Se guarda como otra sesión del mismo día y no cambia cuál toca después.")
        }
        .confirmationDialog("¿Empezar la semana \((store.activeBlock?.currentWeek ?? 0) + 1) ya?", isPresented: $confirmNextWeek, titleVisibility: .visible) {
            Button("Empezar ya") {
                selectedWeek = nil
                Task { await store.startNextWeek() }
            }
        } message: {
            Text("Esta semana queda cerrada con lo que hiciste y la siguiente empieza hoy.")
        }
        .confirmationDialog("¿Retomar \(resuming?.name ?? "el bloque")?", isPresented: Binding(get: { resuming != nil }, set: { if !$0 { resuming = nil } }), titleVisibility: .visible, presenting: resuming) { block in
            Button("Retomar \(block.name)") {
                selectedWeek = nil
                Task { await store.resume(block) }
            }
        } message: { block in
            Text("Empieza un bloque nuevo con sus días, desde la semana 1. Lo que hiciste en \(store.activeBlock?.name ?? "este bloque") se queda en tu historial.")
        }
    }

    private var menu: some View {
        Menu("Opciones", systemImage: "ellipsis") {
            if let day = store.nextDay {
                Button("Editar \(day.name)", systemImage: "slider.horizontal.3") { editingDay = day }
            }
            Button("Equipo preferido", systemImage: "gearshape.2") { showPreferences = true }
            Picker(selection: defaultUnit) {
                ForEach(WeightUnit.allCases) { Text($0 == .kg ? "Kilos (kg)" : "Libras (lb)").tag($0) }
            } label: {
                Label("Unidad por defecto", systemImage: "scalemass")
                Text(store.defaultUnit.rawValue)
            }
            .pickerStyle(.menu)
            Divider()
            Button("Preguntar al Coach", systemImage: "sparkles") { askCoach("¿Cómo voy con mi programa esta semana?", send: false) }
            Button("Cambiar de programa", systemImage: "arrow.triangle.branch") {
                askCoach("Quiero cambiar de programa, sin perder lo que ya hice: ", send: false)
            }
        }
    }

    private func preview(_ day: ProgramDay) {
        guard let block = store.activeBlock else { return }
        previewing = DayRoute(programId: block.programId, dayId: day.id, week: block.currentWeek)
    }

    private func open(_ sessionId: String) {
        Task { openedSession = await store.session(sessionId) }
    }

    /// The program, then each exercise's guide and thumbnail (and the next day's
    /// demonstrations) cached for the gym.
    private func load() async {
        await store.load()
        let ids = store.program?.days.flatMap { $0.exercises.map(\.exerciseId) } ?? []
        await ExerciseCatalog.shared.prefetch(ids, animations: store.nextDay?.exercises.map(\.exerciseId) ?? [])
    }

    /// A resumed session or a rest/cardio notification: the live screen, once.
    private func openRequestedLive() {
        guard store.liveRequested else { return }
        store.liveRequested = false
        if store.live != nil { showLive = true }
    }

    private func finishIfRequested() {
        guard store.finishRequested else { return }
        store.finishRequested = false
        Task { await store.finish() }
    }

    private func startPending() {
        guard let day = pendingStart else { return }
        pendingStart = nil
        start(day)
    }

    private func start(_ day: ProgramDay) {
        store.start(day)
        showLive = store.live != nil
    }
}

/// Pushes an exercise's screen (guide and performance).
struct ExerciseRoute: Hashable {
    var exerciseId: String
    var name: String
}

// MARK: - Hero

struct HeroActions {
    var start: (ProgramDay) -> Void = { _ in }
    var preview: (ProgramDay) -> Void = { _ in }
    var startNextWeek: () -> Void = {}
    var askCoach: (String) -> Void = { _ in }
}

/// The screen's one hero: this week's ring ("1 de 4 días hechos") and the next
/// workout with its big "Empezar", the Coach's note on it when there is one.
/// With the week complete: "Semana completa" and the way to start the next one early.
private struct NextWorkoutHero: View {
    let program: TrainingProgram
    let block: TrainingBlock?
    let showBlock: Bool
    let day: ProgramDay?
    let adjustment: NextAdjustment?
    let weightKg: Double?
    let running: Bool
    let actions: HeroActions

    private var week: ProgramWeek? { block?.current }
    private var done: Int { week?.done ?? 0 }
    private var total: Int { program.days.count }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 16) {
                WeekRing(done: done, total: total)
                VStack(alignment: .leading, spacing: 3) {
                    Text(showBlock ? "Bloque \(block?.number ?? 1) · \(program.name)" : program.name)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Text("Semana \(block?.currentWeek ?? 1) de \(program.weeks)")
                        .font(.title2.bold())
                        .fontDesign(.rounded)
                        .contentTransition(.numericText())
                    Text("\(done) de \(total) días hechos")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .contentTransition(.numericText())
                    if week?.deload == true {
                        GlassChip("Descarga", systemImage: "arrow.down.right", tint: Theme.training).padding(.top, 2)
                    }
                }
                Spacer(minLength: 0)
            }
            if block?.weekComplete == true {
                WeekCompleteContent(block: block!, program: program, actions: actions)
            } else if let day {
                if block?.finished == true {
                    Label("Terminaste las \(program.weeks) semanas. Puedes seguir, o pedirle al Coach el siguiente bloque.", systemImage: "flag.checkered")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                NextDayContent(day: day, adjustment: adjustment, weightKg: weightKg, running: running, actions: actions)
            }
        }
        .padding(Theme.padding + 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: Theme.corner + 6, style: .continuous)
                .fill(.background.secondary)
                .overlay {
                    RoundedRectangle(cornerRadius: Theme.corner + 6, style: .continuous)
                        .fill(LinearGradient(colors: [Theme.training.opacity(0.2), Theme.training.opacity(0.02)], startPoint: .topLeading, endPoint: .bottomTrailing))
                }
        }
        .animation(.snappy, value: done)
    }
}

/// "1/4" inside a ring that fills with the week; a check when it's full.
private struct WeekRing: View {
    let done: Int
    let total: Int

    private var share: Double { total == 0 ? 0 : min(1, Double(done) / Double(total)) }

    var body: some View {
        ZStack {
            Circle().stroke(Theme.training.opacity(0.15), lineWidth: 9)
            Circle()
                .trim(from: 0, to: share)
                .stroke(Theme.training.gradient, style: StrokeStyle(lineWidth: 9, lineCap: .round))
                .rotationEffect(.degrees(-90))
            if share >= 1 {
                Image(systemName: "checkmark")
                    .font(.title2.bold())
                    .foregroundStyle(Theme.training)
                    .symbolEffect(.bounce, options: .nonRepeating)
                    .transition(.scale.combined(with: .opacity))
            } else {
                Text("\(done)/\(total)")
                    .font(.headline)
                    .fontDesign(.rounded)
                    .contentTransition(.numericText())
            }
        }
        .frame(width: 72, height: 72)
        .animation(.snappy, value: share)
        .accessibilityElement()
        .accessibilityLabel("\(done) de \(total) días hechos esta semana")
    }
}

private struct NextDayContent: View {
    let day: ProgramDay
    let adjustment: NextAdjustment?
    let weightKg: Double?
    let running: Bool
    let actions: HeroActions

    private var isoWeekdayToday: Int { (Calendar.current.component(.weekday, from: .now) + 5) % 7 + 1 }

    /// "Pecho, espalda y hombros", from the exercises' guides (cached), else the day's focus.
    private var muscles: String? {
        var seen: [Muscle] = []
        for ex in day.exercises {
            for muscle in ExerciseCatalog.shared.details[ex.exerciseId]?.primaryMuscles ?? [] where !seen.contains(muscle) {
                seen.append(muscle)
            }
        }
        guard !seen.isEmpty else { return day.focus }
        return seen.prefix(3).map(\.label).formatted(.list(type: .and)).capitalizedFirst
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Divider()
            Button { actions.preview(day) } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(day.weekday == isoWeekdayToday ? "Hoy toca" : "Siguiente")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.training)
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(day.name)
                            .font(.title.bold())
                            .fontDesign(.rounded)
                            .lineLimit(2)
                            .minimumScaleFactor(0.7)
                        Image(systemName: "chevron.right").font(.headline).foregroundStyle(.tertiary)
                    }
                    if let muscles {
                        Text(muscles).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Muestra los ejercicios")
            DayStats(day: adjustment?.applies == true ? adjustment!.day : day, weightKg: weightKg)
            if let adjustment { AdjustmentNote(adjustment: adjustment) }
            if !running {
                Button { actions.start(day) } label: {
                    Label("Empezar \(day.name)", systemImage: "play.fill")
                        .font(.title3.bold())
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                .buttonStyle(.glassProminent)
                .tint(Theme.training)
                .sensoryFeedback(.impact, trigger: running)
            }
        }
    }
}

private struct WeekCompleteContent: View {
    let block: TrainingBlock
    let program: TrainingProgram
    let actions: HeroActions

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Divider()
            Label(block.canStartNextWeek ? "Semana completa" : "Programa completado", systemImage: "checkmark.seal.fill")
                .font(.title3.bold())
                .foregroundStyle(Theme.training)
                .symbolEffect(.bounce, options: .nonRepeating)
            if block.canStartNextWeek {
                Text("Buen trabajo. La semana \(block.currentWeek + 1) empieza el lunes\(program.days.first.map { " con \($0.name)" } ?? "").")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("Empezar la semana \(block.currentWeek + 1) ya", systemImage: "forward.end.fill", action: actions.startNextWeek)
                    .font(.subheadline.weight(.semibold))
                    .buttonStyle(.glass)
                    .tint(Theme.training)
            } else {
                Text("Hiciste las \(program.weeks) semanas. Pídele al Coach el siguiente bloque: tu historial y tus cargas siguen contigo.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("Pedir el siguiente bloque", systemImage: "sparkles") {
                    actions.askCoach("Terminé \(program.name). Diseña mi siguiente bloque a partir de lo que hice: ")
                }
                .buttonStyle(.glassProminent)
                .tint(Theme.training)
            }
        }
    }
}

/// The Coach's word on the next session: still reviewing, or its one sentence
/// with "Ver por qué" (a Coach thread) and "Entrenar normal".
struct AdjustmentNote: View {
    let adjustment: NextAdjustment
    @State private var opening = false

    private var store: TrainingStore { TrainingStore.shared }
    /// A review that kept the plan with nothing noticed says nothing.
    private var silent: Bool { adjustment.noChange && adjustment.signals.isEmpty }

    var body: some View {
        if adjustment.reviewing {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("El Coach está revisando tu próxima sesión…")
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
        } else if let rationale = adjustment.rationale, !silent {
            VStack(alignment: .leading, spacing: 10) {
                Label {
                    Text(rationale).fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: adjustment.decidedBy == "fallback" ? "gearshape" : "sparkles").foregroundStyle(Theme.training)
                }
                .font(.subheadline)
                .opacity(adjustment.dismissed ? 0.6 : 1)
                if adjustment.dismissed {
                    Text("Hoy entrenas el plan normal.").font(.caption).foregroundStyle(.secondary)
                }
                AdaptiveStack(horizontalAlignment: .leading, spacing: 8) {
                    Button {
                        opening = true
                        Task {
                            await store.discussAdjustment()
                            opening = false
                        }
                    } label: {
                        if opening { ProgressView().controlSize(.mini) } else { Text("Ver por qué") }
                    }
                    if !adjustment.noChange {
                        Button(adjustment.dismissed ? "Usar el ajuste" : "Entrenar normal") {
                            Task { await store.setAdjustmentDismissed(!adjustment.dismissed) }
                        }
                    }
                }
                .font(.subheadline.weight(.semibold))
                .buttonStyle(.glass)
                .controlSize(.small)
                .tint(Theme.training)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.training.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .sensoryFeedback(.selection, trigger: adjustment.dismissed)
            .animation(.snappy, value: adjustment.dismissed)
        }
    }
}

// MARK: - Program

private struct ProgramNotes: View {
    let program: TrainingProgram

    var body: some View {
        Card {
            CardTitle(text: "Sobre el programa", systemImage: "list.bullet.clipboard")
            Text(program.goal).font(.subheadline)
            HStack(spacing: 12) {
                Label("\(program.weeks) semanas", systemImage: "calendar")
                Label("\(program.days.count) días", systemImage: "repeat")
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            if let notes = program.notes, !notes.isEmpty {
                Text(notes).font(.footnote).foregroundStyle(.secondary).padding(.top, 2)
            }
        }
    }
}

// MARK: - Sessions

private struct RecentSessions: View {
    let sessions: [TrainingSession]
    let open: (TrainingSession) -> Void

    /// "10 series · 41 min · 201 kcal": the time spans what the Watch recorded too, its kcal counted once.
    private func recentDetail(_ session: TrainingSession) -> String {
        var parts = ["\(session.sets.count) series", "\(Int(session.spanDuration / 60)) min"]
        if let kcal = session.recorded?.energy { parts.append("\(Int(kcal.rounded())) kcal") }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        Card {
            CardTitle(text: "Últimas sesiones", systemImage: "clock.arrow.circlepath")
            ForEach(sessions.prefix(5)) { session in
                Button { open(session) } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 5) {
                                Text(session.name).font(.body.weight(.medium)).foregroundStyle(.primary)
                                if session.merged == true {
                                    Image(systemName: "applewatch")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.pink)
                                        .accessibilityLabel("Con datos de Apple Watch")
                                }
                            }
                            Text(session.start.formatted(.dateTime.weekday(.wide).day().month()))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(TrainingStore.shared.defaultUnit.formatTotal(session.volumeKg)).font(.subheadline.weight(.semibold)).fontDesign(.rounded)
                            Text(recentDetail(session)).font(.caption).foregroundStyle(.secondary).fontDesign(.rounded)
                        }
                    }
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct ResumeCard: View {
    let live: LiveSession
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(spacing: 14) {
                Image(systemName: "figure.strengthtraining.traditional")
                    .font(.title2)
                    .symbolEffect(.pulse)
                    .foregroundStyle(Theme.training)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Sesión en curso").font(.headline)
                    Text("\(live.state.name) · \(live.state.setsDone)/\(live.state.setsTotal) series")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(live.state.startedAt, style: .timer)
                    .font(.headline.monospacedDigit())
                    .fontDesign(.rounded)
            }
            .padding(Theme.padding)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.tint(Theme.training.opacity(0.25)).interactive(), in: .rect(cornerRadius: Theme.corner))
    }
}

private struct EmptyProgram: View {
    @Environment(\.askCoach) private var askCoach

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "figure.strengthtraining.traditional")
                .font(.system(size: 64))
                .foregroundStyle(Theme.training.gradient)
                .symbolEffect(.bounce, options: .nonRepeating)
            Text("Aún no tienes rutina").font(.title2.bold())
            Text("Pídele al Coach un programa: lo verás aquí con los pesos sugeridos para cada día.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Pedir rutina al Coach", systemImage: "sparkles") {
                askCoach("Diseña mi rutina de entrenamiento para esta semana según mi perfil y objetivos")
            }
            .buttonStyle(.glassProminent)
            .tint(Theme.training)
            .controlSize(.large)
            .padding(.top, 6)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 80)
        .padding(.horizontal, 24)
    }
}

private extension String {
    /// "pecho, espalda" → "Pecho, espalda".
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

#if DEBUG
#Preview("Entreno · 375 pt", traits: .fixedLayout(width: 375, height: 812)) {
    NavigationStack { TrainingView(model: .shared) }
}

private struct HeroPreview: View {
    var complete = false
    var adjustment: NextAdjustment?

    var body: some View {
        let block = TrainingBlock.preview(complete: complete)
        NarrowPreview {
            NextWorkoutHero(program: .preview, block: block, showBlock: true, day: complete ? nil : TrainingProgram.preview.days[1], adjustment: adjustment, weightKg: 78, running: false, actions: HeroActions())
            WeekBrowser(blocks: [block], nextDayId: "d2", selection: .constant(nil))
        }
    }
}

#Preview("Hero · siguiente, con ajuste") {
    HeroPreview(adjustment: NextAdjustment(
        id: "a", programId: "p", dayId: "d2", status: "ready", decidedBy: "coach", noChange: false,
        rationale: "Llevas 9 días sin entrenar y dormiste poco: hoy 2 series por ejercicio y un 10 % menos de peso.",
        signals: [AdjustmentSignal(kind: "inactivity", level: "moderate", days: 9, detail: "Llevas 9 días sin entrenar")],
        changes: [ExerciseChange(action: "adjust", programExerciseId: "pe1", loadPercent: -10, sets: 2)],
        dismissed: false, threadId: nil, day: TrainingProgram.preview.days[1], suggestions: [:]
    ))
}

#Preview("Hero · semana completa, claro") {
    HeroPreview(complete: true).preferredColorScheme(.light)
}

extension TrainingProgram {
    static let preview: TrainingProgram = {
        func ex(_ id: String, _ exerciseId: String, _ name: String, _ sets: Int, _ min: Int, _ max: Int, rest: Int = 120) -> ProgramExercise {
            ProgramExercise(id: id, exerciseId: exerciseId, exerciseName: name, equipment: "barbell", sets: sets, repMin: min, repMax: max, targetRpe: nil, targetRir: 2, restSeconds: rest, notes: nil)
        }
        return TrainingProgram(
            id: "p", name: "Torso / Pierna", goal: "Ganar músculo manteniendo la fuerza",
            weeks: 6, notes: "Semana 4 de descarga: mitad de series.", active: true,
            createdAt: (Date.now.timeIntervalSince1970 - 3 * 86_400) * 1000,
            days: [
                ProgramDay(id: "d1", name: "Torso A", focus: "Empuje horizontal", weekday: nil, exercises: [ex("pa", "press-banca", "Press de banca", 4, 6, 8)]),
                ProgramDay(id: "d2", name: "Pierna A", focus: "Sentadilla", weekday: nil, exercises: [
                    ex("pe1", "sentadilla-hack", "Sentadilla hack", 4, 6, 10),
                    ex("pe2", "peso-muerto-rumano", "Peso muerto rumano", 3, 8, 10, rest: 150),
                ]),
                ProgramDay(id: "d3", name: "Torso B", focus: nil, weekday: nil, exercises: [ex("pc", "dominadas", "Dominadas", 4, 5, 7)]),
                ProgramDay(id: "d4", name: "Pierna B", focus: nil, weekday: nil, exercises: [ex("pd", "prensa", "Prensa", 3, 10, 12)]),
            ]
        )
    }()
}

extension TrainingBlock {
    static func preview(complete: Bool) -> TrainingBlock {
        let monday = Calendar.current.dateInterval(of: .weekOfYear, for: .now)!.start.timeIntervalSince1970 * 1000
        let week = 7 * 86_400_000.0
        let session = { (day: String, offset: Double) in
            WeekSession(id: "s\(day)", dayId: day, name: day, startedAt: monday + offset * 86_400_000 + 64_800_000, endedAt: monday + offset * 86_400_000 + 67_260_000, sets: 10, cardioMinutes: 0)
        }
        let days = TrainingProgram.preview.days
        let weeks = (1...6).map { n in
            let current = n == 1
            let statuses: [WeekDayStatus] = current ? (complete ? [.done, .done, .partial, .done] : [.done, .planned, .planned, .planned]) : [.planned, .planned, .planned, .planned]
            let weekDays = zip(days, statuses).enumerated().map { i, pair in
                WeekDay(dayId: pair.0.id, name: pair.0.name, status: pair.1, sessions: pair.1.isDone ? [session(pair.0.id, Double(i))] : [])
            }
            return ProgramWeek(
                number: n, startsAt: monday + Double(n - 1) * week, endsAt: monday + Double(n) * week, state: current ? "current" : "future",
                startedEarly: false, deload: n == 4, note: n == 4 ? "Semana 4 de descarga: mitad de series." : nil,
                days: weekDays, done: weekDays.filter(\.status.isDone).count, other: []
            )
        }
        return TrainingBlock(
            programId: "p", number: 2, name: "Torso / Pierna", goal: "", startedAt: monday, endedAt: nil, endReason: nil, active: true, resumedFrom: nil,
            days: days, currentWeek: 1, weekComplete: complete, canStartNextWeek: complete, finished: false, weeks: weeks
        )
    }
}
#endif
