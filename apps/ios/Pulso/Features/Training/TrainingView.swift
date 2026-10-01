import SwiftUI

/// Entreno: the program's days as tabs, the selected day's exercises below and
/// recent sessions after them. The floating "Empezar" opens the live session full screen.
struct TrainingView: View {
    let model: PulsoModel
    @State private var store = TrainingStore.shared
    @State private var showLive = false
    /// nil follows the day the engine says is next.
    @State private var selectedDayId: String?
    @State private var editingDay: ProgramDay?
    @State private var swapping: SwapRequest?
    @State private var resetting: ProgramDay?
    @State private var showPreferences = false
    /// Bumped when a quick swap lands, for the haptic.
    @State private var swapped = 0

    private var selectedDay: ProgramDay? { store.program?.day(selectedDayId ?? store.nextDay?.id) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let live = store.live {
                    ResumeCard(live: live) { showLive = true }
                }
                if let program = store.program {
                    ProgramPlan(
                        program: program,
                        nextDayId: store.nextDay?.id,
                        suggestions: store.suggestions,
                        records: TrainingPlan.recentRecords(store.sessions),
                        weightKg: store.bodyWeightKg,
                        selectedId: $selectedDayId,
                        actions: DayActions(
                            edit: { editingDay = $0 },
                            swap: { day, exercise in
                                // Today's day (or one already changed for today) swaps for today; others for good.
                                let today = day.overridden == true || day.id == store.nextDay?.id
                                swapping = SwapRequest(dayId: day.id, exercise: exercise, initialScope: today ? .today : .always)
                            },
                            reset: { resetting = $0 }
                        )
                    )
                    if !store.sessions.isEmpty {
                        RecentSessions(sessions: store.sessions)
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
        }
        .safeAreaInset(edge: .bottom) {
            if let program = store.program, let day = selectedDay, store.live == nil {
                StartButton(number: (program.days.firstIndex(of: day) ?? 0) + 1) { start(day) }
            }
        }
        .navigationTitle("Entreno")
        .navigationDestination(for: ExerciseRoute.self) { ExerciseDetailView(exerciseId: $0.exerciseId, name: $0.name) }
        .toolbar {
            if store.program != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu("Opciones", systemImage: "gearshape") {
                        if let day = selectedDay {
                            Button("Editar \(day.name)", systemImage: "slider.horizontal.3") { editingDay = day }
                        }
                        Button("Equipo preferido", systemImage: "gearshape.2") { showPreferences = true }
                    }
                }
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .fullScreenCover(isPresented: $showLive, onDismiss: finishIfRequested) {
            if let live = store.live {
                LiveSessionView(session: live, store: store)
            }
        }
        // Reads the store, not the closure's value: records arrive after the sheet opens.
        .sheet(item: $store.summary) { opened in SessionSummaryView(summary: store.summary ?? opened) }
        .sheet(item: $editingDay) { day in
            DayEditorView(day: day, suggestions: store.suggestions, hrZones: store.hrZones)
        }
        .sheet(item: $swapping) { request in
            SwapExerciseSheet(exerciseId: request.exercise.exerciseId, name: request.exercise.exerciseName, initialScope: request.initialScope) { library, scope in
                swap(request, to: library, scope: scope)
            }
        }
        .sheet(isPresented: $showPreferences) { TrainingPreferencesView() }
        .confirmationDialog(
            "¿Volver al día del programa?",
            isPresented: Binding(get: { resetting != nil }, set: { if !$0 { resetting = nil } }),
            titleVisibility: .visible,
            presenting: resetting
        ) { day in
            Button("Restablecer \(day.name)", role: .destructive) { Task { await store.resetDay(day.id) } }
        } message: { _ in
            Text("Se quitan los cambios de hoy y vuelve la rutina del programa.")
        }
        .sensoryFeedback(.success, trigger: swapped)
    }

    /// The quick "Cambiar" on a plan row: the day as it is, with that one exercise replaced.
    private func swap(_ request: SwapRequest, to library: LibraryExercise, scope: EditScope) {
        guard let day = store.program?.days.first(where: { $0.id == request.dayId }) else { return }
        let list = day.exercises.map { $0.id == request.exercise.id ? $0.swapped(to: library) : $0 }
        Task {
            do {
                try await store.saveDay(day.id, scope: scope, exercises: list.map(\.editInput))
                swapped += 1
            } catch {
                model.handle(error)
            }
        }
    }

    /// The program, then each exercise's guide and thumbnail (and the next day's
    /// demonstrations) cached for the gym.
    private func load() async {
        await store.load()
        let ids = store.program?.days.flatMap { $0.exercises.map(\.exerciseId) } ?? []
        await ExerciseCatalog.shared.prefetch(ids, animations: store.nextDay?.exercises.map(\.exerciseId) ?? [])
    }

    private func finishIfRequested() {
        guard store.finishRequested else { return }
        store.finishRequested = false
        Task { await store.finish() }
    }

    private func start(_ day: ProgramDay) {
        store.start(day)
        showLive = true
    }
}

/// Pushes an exercise's screen (guide and performance).
struct ExerciseRoute: Hashable {
    var exerciseId: String
    var name: String
}

private extension TrainingProgram {
    func day(_ id: String?) -> ProgramDay? { days.first { $0.id == id } ?? days.first }
}

/// A plan row's quick "Cambiar".
private struct SwapRequest: Identifiable {
    var dayId: String
    var exercise: ProgramExercise
    var initialScope: EditScope

    var id: String { exercise.id }
}

/// What the selected day offers: edit it, swap one exercise, drop today's changes.
private struct DayActions {
    var edit: (ProgramDay) -> Void = { _ in }
    var swap: (ProgramDay, ProgramExercise) -> Void = { _, _ in }
    var reset: (ProgramDay) -> Void = { _ in }
}

// MARK: - Plan

/// Header, the day tabs and the selected day. Swiping the day sideways moves to the next or previous one.
private struct ProgramPlan: View {
    let program: TrainingProgram
    let nextDayId: String?
    let suggestions: [String: LoadSuggestion]
    let records: Set<String>
    let weightKg: Double?
    @Binding var selectedId: String?
    var actions = DayActions()
    @State private var edge: Edge = .trailing

    private var selected: ProgramDay? { program.day(selectedId ?? nextDayId) }
    private var index: Int { selected.flatMap(program.days.firstIndex(of:)) ?? 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            PlanHeader(program: program)
            DayTabs(days: program.days, selectedId: selected?.id, select: select)
            if let day = selected {
                DayPlan(day: day, isNext: day.id == nextDayId, suggestions: suggestions, records: records, weightKg: weightKg, actions: actions)
                    .id(day.id)
                    .transition(.asymmetric(
                        insertion: .move(edge: edge).combined(with: .opacity),
                        removal: .move(edge: edge == .trailing ? .leading : .trailing).combined(with: .opacity)
                    ))
                    .contentShape(Rectangle())
                    .simultaneousGesture(DragGesture(minimumDistance: 24).onEnded { value in
                        let dx = value.translation.width
                        guard abs(dx) > max(60, abs(value.translation.height) * 1.5) else { return }
                        step(dx < 0 ? 1 : -1)
                    })
            }
        }
        .sensoryFeedback(.selection, trigger: selected?.id)
    }

    private func select(_ id: String) {
        let target = program.days.firstIndex { $0.id == id } ?? 0
        guard target != index else { return }
        edge = target > index ? .trailing : .leading
        withAnimation(.snappy) { selectedId = id }
    }

    private func step(_ delta: Int) {
        let target = index + delta
        guard program.days.indices.contains(target) else { return }
        select(program.days[target].id)
    }
}

private struct PlanHeader: View {
    let program: TrainingProgram

    private var week: Int { TrainingPlan.week(of: program) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(program.name)
                .font(.title2.bold())
                .fontDesign(.rounded)
                .lineLimit(2)
            HStack(spacing: 8) {
                Text("Semana \(week) de \(program.weeks)")
                    .font(.subheadline.weight(.semibold))
                    .fontDesign(.rounded)
                    .foregroundStyle(Theme.training)
                    .contentTransition(.numericText())
                if TrainingPlan.isDeload(week: week, weeks: program.weeks, notes: program.notes) {
                    GlassChip("Descarga", systemImage: "arrow.down.right", tint: Theme.training)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// "Día 1 · Torso A" pills on glass, the selected one filled. Scrolls to keep it in view.
private struct DayTabs: View {
    let days: [ProgramDay]
    let selectedId: String?
    let select: (String) -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        ForEach(Array(days.enumerated()), id: \.element.id) { i, day in
                            let selected = day.id == selectedId
                            Button { select(day.id) } label: {
                                Text("Día \(i + 1) · \(day.name)")
                                    .font(.subheadline.weight(.semibold))
                                    .lineLimit(1)
                                    .frame(maxWidth: 220)
                                    .foregroundStyle(selected ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 9)
                                    .contentShape(.capsule)
                            }
                            .buttonStyle(.plain)
                            .glassEffect(selected ? .regular.tint(Theme.training).interactive() : .regular.interactive(), in: .capsule)
                            .accessibilityAddTraits(selected ? .isSelected : [])
                            .id(day.id)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            .scrollIndicators(.hidden)
            .contentMargins(.horizontal, Theme.padding, for: .scrollContent)
            .padding(.horizontal, -Theme.padding)
            .onAppear { proxy.scrollTo(selectedId, anchor: .center) }
            .onChange(of: selectedId) { _, id in withAnimation(.snappy) { proxy.scrollTo(id, anchor: .center) } }
        }
    }
}

private struct DayPlan: View {
    let day: ProgramDay
    let isNext: Bool
    let suggestions: [String: LoadSuggestion]
    let records: Set<String>
    let weightKg: Double?
    let actions: DayActions

    /// 1 = Monday … 7 = Sunday, like `ProgramDay.weekday`.
    private var isoWeekdayToday: Int { (Calendar.current.component(.weekday, from: .now) + 5) % 7 + 1 }

    private var tagline: String? {
        let next = isNext ? (day.weekday == isoWeekdayToday ? "Hoy toca" : "Siguiente") : nil
        let weekday = day.weekday.map { Calendar.current.weekdaySymbols[$0 % 7].capitalized }
        let parts = [next, weekday].compactMap(\.self)
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                if let tagline {
                    Text(tagline).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.training)
                }
                Text(day.name)
                    .font(.largeTitle.bold())
                    .fontDesign(.rounded)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                if let focus = day.focus, !focus.isEmpty {
                    Text(focus).font(.title3).foregroundStyle(.secondary)
                }
            }

            if day.overridden == true {
                TodayChangesBar { actions.reset(day) }
                    .transition(.opacity.combined(with: .scale(scale: 0.95, anchor: .leading)))
            }

            DayStats(day: day, weightKg: weightKg)

            if day.exercises.isEmpty {
                Card {
                    Label("Día sin ejercicios", systemImage: "figure.cooldown")
                        .foregroundStyle(.secondary)
                    Button("Añadir ejercicios", systemImage: "plus") { actions.edit(day) }
                        .buttonStyle(.glass)
                        .tint(Theme.training)
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        CardTitle(text: "Ejercicios", systemImage: "list.bullet")
                        Spacer(minLength: 8)
                        Button("Editar", systemImage: "slider.horizontal.3") { actions.edit(day) }
                            .font(.subheadline.weight(.semibold))
                            .buttonStyle(.glass)
                            .controlSize(.small)
                            .tint(Theme.training)
                    }
                    Card {
                        VStack(spacing: 0) {
                            ForEach(day.exercises) { ex in
                                PlanExerciseRow(exercise: ex, suggestion: suggestions[ex.id], record: records.contains(ex.exerciseId))
                                    .contextMenu {
                                        Button("Cambiar ejercicio", systemImage: "arrow.triangle.2.circlepath") { actions.swap(day, ex) }
                                        Button("Editar día", systemImage: "slider.horizontal.3") { actions.edit(day) }
                                    }
                                if ex.id != day.exercises.last?.id { Divider().padding(.leading, 68) }
                            }
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(.snappy, value: day.overridden)
    }
}

/// "Cambios solo para hoy" with the way back to the program's own day.
private struct TodayChangesBar: View {
    let reset: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            GlassChip("Cambios solo para hoy", systemImage: "clock.arrow.circlepath", tint: Theme.training)
            Button("Restablecer", action: reset)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.training)
                .buttonStyle(.borderless)
        }
    }
}

/// "⚡ 5 ejercicios · ⏱ ~40 min · 🔥 ~310 kcal"; kcal only with a known body weight.
private struct DayStats: View {
    let day: ProgramDay
    let weightKg: Double?

    var body: some View {
        AdaptiveStack(horizontalAlignment: .leading, spacing: 16) {
            stat("\(day.exercises.count)", day.exercises.count == 1 ? "ejercicio" : "ejercicios", "bolt.fill", Theme.training)
            stat("~\(TrainingPlan.minutes(day))", "min", "timer", Theme.fat)
            if let kcal = TrainingPlan.kcal(day, weightKg: weightKg) {
                stat("~\(kcal)", "kcal", "flame.fill", Theme.energy)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func stat(_ value: String, _ unit: String, _ symbol: String, _ tint: Color) -> some View {
        HStack(spacing: 5) {
            Image(systemName: symbol).foregroundStyle(tint)
            Text(value).fontWeight(.semibold).fontDesign(.rounded).contentTransition(.numericText())
            Text(unit).foregroundStyle(.secondary)
        }
        .font(.subheadline)
        .lineLimit(1)
        .fixedSize()
    }
}

/// One prescribed exercise: its demonstration still, name and "series × reps × kg",
/// a trophy after a recent record, and the primary muscle on a small figure. Opens the exercise screen.
private struct PlanExerciseRow: View {
    let exercise: ProgramExercise
    let suggestion: LoadSuggestion?
    let record: Bool

    private var detail: ExerciseDetail? { ExerciseCatalog.shared.details[exercise.exerciseId] }

    var body: some View {
        NavigationLink(value: ExerciseRoute(exerciseId: exercise.exerciseId, name: exercise.exerciseName)) {
            HStack(spacing: 12) {
                ExerciseMediaView(path: detail?.media.thumbnail, cornerRadius: 12)
                    .frame(width: 56, height: 56)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        Text(exercise.exerciseName)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(.primary)
                            .lineLimit(2)
                        if record {
                            Image(systemName: "trophy.fill")
                                .font(.caption)
                                .foregroundStyle(Theme.carbs)
                                .accessibilityLabel("Récord reciente")
                        }
                    }
                    // A load set by hand wins over the suggestion; cardio shows its target.
                    Text(exercise.isCardio ? exercise.prescription : TrainingPlan.prescription(exercise, weightKg: exercise.weightKg ?? suggestion?.weightKg))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 4)
                if let primary = detail?.primaryMuscles, !primary.isEmpty {
                    MuscleBadge(primary: primary)
                }
            }
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// The figure (front, or back when the muscle only shows there) with the primary muscles lit.
private struct MuscleBadge: View {
    let primary: [Muscle]

    private var polygons: [BodyPolygon] {
        guard let first = primary.first, !BodyMapData.views(of: first).front else { return BodyMapData.front }
        return BodyMapData.back
    }

    var body: some View {
        ZStack {
            BodyShape(polygons: polygons) { _ in true }
                .fill(Color.secondary.opacity(0.35))
            BodyShape(polygons: polygons) { $0.map(primary.contains) ?? false }
                .fill(MuscleMapView.primaryColor.gradient)
        }
        .aspectRatio(BodyMapData.size, contentMode: .fit)
        .frame(height: 32)
        .frame(width: 40, height: 40)
        .background(.fill.tertiary, in: .circle)
        .accessibilityElement()
        .accessibilityLabel(primary.map(\.label).formatted(.list(type: .and)))
    }
}

private struct StartButton: View {
    let number: Int
    let start: () -> Void

    var body: some View {
        Button(action: start) {
            Label("Empezar día \(number)", systemImage: "play.fill")
                .font(.title3.bold())
                .lineLimit(1)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .contentTransition(.numericText())
        }
        .buttonStyle(.glassProminent)
        .tint(Theme.training)
        .sensoryFeedback(.impact, trigger: number)
        .padding(.horizontal, Theme.padding)
        .padding(.bottom, 8)
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

    var body: some View {
        Card {
            CardTitle(text: "Últimas sesiones", systemImage: "clock.arrow.circlepath")
            ForEach(sessions.prefix(5)) { session in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(session.name).font(.body.weight(.medium))
                        Text(session.start.formatted(.dateTime.weekday(.wide).day().month()))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("\(Int(session.volumeKg).formatted()) kg").font(.subheadline.weight(.semibold)).fontDesign(.rounded)
                        Text("\(session.sets.count) series · \(Int(session.duration / 60)) min").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
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


#if DEBUG
#Preview("Entreno · 375 pt", traits: .fixedLayout(width: 375, height: 812)) {
    NavigationStack { TrainingView(model: .shared) }
}

private struct PlanPreview: View {
    var weightKg: Double? = 78
    @State private var selected: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                ProgramPlan(
                    program: .preview,
                    nextDayId: "d2",
                    suggestions: ["pe1": LoadSuggestion(exerciseId: "press-banca-inclinado", weightKg: 32.5, reps: 8, reason: "", lastSessionAt: nil)],
                    records: ["press-banca-inclinado"],
                    weightKg: weightKg,
                    selectedId: $selected
                )
                .padding(.horizontal, Theme.padding)
            }
            .safeAreaInset(edge: .bottom) { StartButton(number: 2) {} }
            .navigationTitle("Entreno")
        }
    }
}

#Preview("Plan · 375 pt, nombres largos", traits: .fixedLayout(width: 375, height: 900)) {
    PlanPreview()
}

#Preview("Plan · 375 pt, XXL, sin peso", traits: .fixedLayout(width: 375, height: 900)) {
    PlanPreview(weightKg: nil).dynamicTypeSize(.xxLarge)
}

#Preview("Plan · 440 pt, claro", traits: .fixedLayout(width: 440, height: 956)) {
    PlanPreview().preferredColorScheme(.light)
}

private extension TrainingProgram {
    static let preview: TrainingProgram = {
        func ex(_ id: String, _ exerciseId: String, _ name: String, _ sets: Int, _ min: Int, _ max: Int, rest: Int = 120) -> ProgramExercise {
            ProgramExercise(id: id, exerciseId: exerciseId, exerciseName: name, equipment: "barbell", sets: sets, repMin: min, repMax: max, targetRpe: nil, targetRir: 2, restSeconds: rest, notes: nil)
        }
        return TrainingProgram(
            id: "p", name: "Hipertrofia torso-pierna con énfasis en la cadena posterior", goal: "Ganar músculo manteniendo la fuerza",
            weeks: 6, notes: "Semana 6 de descarga: mitad de series.", active: true,
            createdAt: (Date.now.timeIntervalSince1970 - 16 * 86_400) * 1000,
            days: [
                ProgramDay(id: "d1", name: "Torso A", focus: "Empuje horizontal", weekday: 1, exercises: [ex("pa", "press-banca", "Press de banca", 4, 6, 8)]),
                ProgramDay(id: "d2", name: "Pierna con énfasis en isquiotibiales y glúteos", focus: "Bisagra de cadera y cadena posterior", weekday: 3, exercises: [
                    ex("pe1", "press-banca-inclinado", "Press inclinado con mancuernas en banco a 30 grados", 4, 6, 8),
                    ex("pe2", "peso-muerto-rumano", "Peso muerto rumano", 3, 8, 10, rest: 150),
                    ex("pe3", "curl-femoral", "Curl femoral tumbado", 3, 10, 12, rest: 90),
                    ex("pe4", "elevacion-gemelos", "Elevación de gemelos de pie en máquina", 4, 12, 12, rest: 60),
                ], overridden: true),
                ProgramDay(id: "d3", name: "Torso B", focus: nil, weekday: 5, exercises: [ex("pc", "dominadas", "Dominadas lastradas", 4, 5, 7)]),
                ProgramDay(id: "d4", name: "Pierna B", focus: "Sentadilla", weekday: nil, exercises: []),
            ]
        )
    }()
}
#endif
