import SwiftUI

/// The session in the gym, one exercise per screen: "Ejercicio 2 de 6" and a
/// strip of the day's exercises up top, the focused exercise (or cardio block)
/// paging sideways, and a glass bar at the bottom that is the rest countdown
/// while resting and "Siguiente" otherwise.
struct LiveSessionView: View {
    let session: LiveSession
    let store: TrainingStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var confirmEnd = false
    @State private var editing = false
    @State private var coach = false
    @State private var swapping: SwapTarget?

    private var state: LiveSessionState { session.state }

    private var focus: Binding<Int> {
        Binding(get: { session.state.focus }, set: { index in withAnimation(.snappy) { session.setFocus(index) } })
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                SessionStrip(state: state) { index in focus.wrappedValue = index }
                    .padding(.horizontal, Theme.padding)
                    .padding(.bottom, 8)
                if state.exercises.isEmpty {
                    ScrollView {
                        EmptyStateView(systemImage: "dumbbell", title: "Sesión sin ejercicios", message: "Añade uno o pídeselo al Coach.", tint: Theme.training, actionTitle: "Editar sesión") { editing = true }
                            .padding(.top, 60)
                    }
                } else {
                    TabView(selection: focus) {
                        ForEach(Array(state.exercises.enumerated()), id: \.element.id) { index, exercise in
                            Group {
                                if exercise.isCardio {
                                    CardioPage(session: session, index: index)
                                } else {
                                    ExercisePage(session: session, index: index) {
                                        swapping = SwapTarget(index: index, exerciseId: exercise.exerciseId, name: exercise.name)
                                    }
                                }
                            }
                            .tag(index)
                        }
                    }
                    .tabViewStyle(.page(indexDisplayMode: .never))
                }
            }
            .safeAreaInset(edge: .bottom) {
                BottomBar(session: session) { confirmEnd = true }
            }
            .overlay(alignment: .top) {
                if session.coachUndo != nil {
                    UndoBanner(undo: session.undoCoach, close: session.dismissUndo)
                        .padding(.horizontal, Theme.padding)
                        .padding(.top, 4)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .navigationTitle(state.name)
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: ExerciseRoute.self) { ExerciseDetailView(exerciseId: $0.exerciseId, name: $0.name) }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cerrar", systemImage: "chevron.down") { dismiss() }
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button("Coach", systemImage: "sparkles") { coach = true }
                        .tint(Theme.training)
                    Button("Editar sesión", systemImage: "list.bullet") { editing = true }
                }
                ToolbarSpacer(.fixed, placement: .topBarTrailing)
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Terminar") { confirmEnd = true }
                        .buttonStyle(.glassProminent)
                        .tint(Theme.training)
                }
            }
            .confirmationDialog("¿Terminar la sesión?", isPresented: $confirmEnd, titleVisibility: .visible) {
                if state.hasWork {
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
                Text(endMessage)
            }
            .sheet(isPresented: $editing) { EditSessionSheet(session: session) }
            .sheet(isPresented: $coach) {
                LiveCoachSheet(sessionId: state.id, currentExercise: state.focused?.name) { await session.coachChanged() }
                    .presentationDetents([.medium, .large])
                    .presentationBackgroundInteraction(.enabled(upThrough: .medium))
            }
            .sheet(item: $swapping) { target in
                SwapExerciseSheet(exerciseId: target.exerciseId, name: target.name, scopes: [.today, .always], initialScope: .today) { picked, scope in
                    withAnimation(.snappy) { session.swap(target.index, to: picked, scope: scope) }
                    swapping = nil
                }
            }
            .sensoryFeedback(trigger: state.setsDone) { old, new in new > old ? .success : nil }
            .sensoryFeedback(.impact(weight: .medium), trigger: session.coachChanges)
            .sensoryFeedback(.selection, trigger: state.focus)
            .onChange(of: scenePhase) { _, phase in
                switch phase {
                case .active: Task { await session.pull() }
                case .background: session.flush()
                default: break
                }
            }
            .task {
                await session.pull()
                let ids = state.exercises.map(\.exerciseId)
                await ExerciseCatalog.shared.prefetch(ids, animations: ids)
            }
        }
    }

    private var endMessage: String {
        let cardio = state.cardioLogs.count
        switch (state.setsDone, cardio) {
        case (0, 0): return "Aún no has hecho ninguna serie."
        case (let sets, 0): return "\(sets) de \(state.setsTotal) series hechas."
        case (0, let blocks): return blocks == 1 ? "1 bloque de cardio hecho." : "\(blocks) bloques de cardio hechos."
        case (let sets, let blocks): return "\(sets) de \(state.setsTotal) series y \(blocks) de cardio hechos."
        }
    }
}

private struct SwapTarget: Identifiable {
    let index: Int
    let exerciseId: String
    let name: String
    var id: String { "\(index)-\(exerciseId)" }
}

// MARK: - Header

/// "Ejercicio 2 de 6", the session clock, and one capsule per exercise filling
/// as its sets are done. Tap a capsule to jump to it.
private struct SessionStrip: View {
    let state: LiveSessionState
    let select: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(state.exercises.isEmpty ? "Sin ejercicios" : "Ejercicio \(state.focus + 1) de \(state.exercises.count)")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.training)
                    .contentTransition(.numericText())
                    .animation(.snappy, value: state.focus)
                Spacer(minLength: 8)
                Label {
                    Text(state.startedAt, style: .timer).monospacedDigit()
                } icon: {
                    Image(systemName: "stopwatch")
                }
                .font(.subheadline.weight(.medium))
                .fontDesign(.rounded)
                .foregroundStyle(.secondary)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)

            HStack(spacing: 4) {
                ForEach(Array(state.exercises.enumerated()), id: \.element.id) { index, exercise in
                    Button { select(index) } label: {
                        StripCapsule(exercise: exercise, current: index == state.focus)
                            .frame(maxWidth: .infinity)
                            .frame(height: 28)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Ejercicio \(index + 1), \(exercise.name)")
                    .accessibilityValue(exercise.skipped ? "Saltado" : exercise.done ? "Hecho" : index == state.focus ? "En pantalla" : "Pendiente")
                }
            }
            .animation(.snappy, value: state.exercises)
            .animation(.snappy, value: state.focus)
        }
    }
}

private struct StripCapsule: View {
    let exercise: LiveExercise
    let current: Bool

    private var fraction: Double {
        if exercise.isCardio { return exercise.cardioLog == nil ? 0 : 1 }
        guard !exercise.sets.isEmpty else { return exercise.done ? 1 : 0 }
        return Double(exercise.sets.filter(\.done).count) / Double(exercise.sets.count)
    }

    var body: some View {
        Capsule()
            .fill(Color.secondary.opacity(exercise.skipped ? 0.07 : 0.2))
            .overlay(alignment: .leading) {
                GeometryReader { proxy in
                    Capsule()
                        .fill(Theme.training.gradient)
                        .frame(width: proxy.size.width * fraction)
                }
            }
            .clipShape(Capsule())
            .frame(height: current ? 10 : 6)
            .padding(3)
            .overlay {
                if current { Capsule().strokeBorder(Theme.training.opacity(0.7), lineWidth: 1.5) }
            }
    }
}

// MARK: - Bottom bar

/// Resting: a big countdown with a draining ring, +15 s and skip.
/// Otherwise "Siguiente", or "Terminar sesión" once everything is done.
private struct BottomBar: View {
    let session: LiveSession
    let finish: () -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.25)) { context in
            let state = session.state
            Group {
                if state.resting(at: context.date), let start = state.restStartedAt, let end = state.restEndsAt {
                    RestPanel(now: context.date, start: start, end: end, next: state.activityState(now: end), session: session)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                } else if state.allDone || state.exercises.isEmpty {
                    if state.hasWork {
                        Button(action: finish) {
                            Label("Terminar sesión", systemImage: "flag.checkered")
                                .font(.headline)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.glassProminent)
                        .tint(Theme.training)
                    }
                } else if let next = nextIndex(state) {
                    Button {
                        withAnimation(.snappy) { session.setFocus(next) }
                    } label: {
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 0) {
                                Text("Siguiente").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                Text(state.exercises[next].name).font(.headline).foregroundStyle(.primary)
                            }
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            Image(systemName: "chevron.right")
                                .font(.headline)
                                .foregroundStyle(Theme.training)
                        }
                        .padding(.horizontal, 6)
                        .frame(minHeight: 44)
                    }
                    .buttonStyle(.glass)
                    .transition(.opacity)
                }
            }
            .frame(maxWidth: .infinity)
            .animation(.snappy, value: state.resting(at: context.date))
        }
        .padding(.horizontal, Theme.padding)
        .padding(.bottom, 8)
    }

    /// The next exercise on the page order, else one left behind.
    private func nextIndex(_ state: LiveSessionState) -> Int? {
        state.focus + 1 < state.exercises.count ? state.focus + 1 : state.nextPending(after: state.focus)
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
                Button("Saltar") { withAnimation(.snappy) { session.skipRest() } }
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

/// "El Coach cambió la sesión · Deshacer", for a few seconds after a change.
private struct UndoBanner: View {
    let undo: () -> Void
    let close: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "sparkles")
                .foregroundStyle(Theme.training)
                .symbolEffect(.bounce, options: .nonRepeating)
            Text("El Coach cambió la sesión")
                .font(.subheadline.weight(.medium))
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button("Deshacer", action: undo)
                .font(.subheadline.weight(.semibold))
                .buttonStyle(.glassProminent)
                .tint(Theme.training)
            Button("Cerrar", systemImage: "xmark", action: close)
                .labelStyle(.iconOnly)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(width: 32, height: 32)
                .contentShape(Rectangle())
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .glassEffect(.regular, in: .capsule)
    }
}

#if DEBUG
extension LiveSessionState {
    /// Strength with history, a cardio block with intervals, and a skipped exercise.
    static var preview: LiveSessionState {
        let day = ProgramDay(id: "d1", name: "Torso A", focus: nil, weekday: nil, exercises: [
            ProgramExercise(id: "pe1", exerciseId: "press-banca", exerciseName: "Press de banca con barra y agarre cerrado", equipment: "barbell", sets: 4, repMin: 6, repMax: 8, targetRpe: nil, targetRir: 2, restSeconds: 150, notes: "Pausa de un segundo abajo, codos a 45° y escápulas juntas todo el recorrido", kind: "compound"),
            ProgramExercise(id: "pe2", exerciseId: "curl", exerciseName: "Curl con mancuernas", equipment: "dumbbell", sets: 3, repMin: 10, repMax: 12, targetRpe: 8, targetRir: nil, restSeconds: 60, notes: nil, kind: "isolation"),
            ProgramExercise(id: "pe3", exerciseId: "cinta", exerciseName: "Intervalos en cinta", equipment: "machine", sets: 1, repMin: 1, repMax: 1, targetRpe: nil, targetRir: nil, restSeconds: 0, notes: "Calienta 5 min suave antes", kind: "cardio", modality: "treadmill",
                            cardio: CardioTarget(durationMinutes: 16, speedKmh: 12, inclinePercent: 1, zone: 4, intervals: CardioIntervals(rounds: 8, workSeconds: 30, restSeconds: 90))),
            ProgramExercise(id: "pe4", exerciseId: "eliptica", exerciseName: "Elíptica suave", equipment: "machine", sets: 1, repMin: 1, repMax: 1, targetRpe: nil, targetRir: nil, restSeconds: 0, notes: nil, kind: "cardio", modality: "elliptical",
                            cardio: CardioTarget(durationMinutes: 20, level: 8, zone: 2)),
        ])
        let suggestions = ["pe1": LoadSuggestion(exerciseId: "press-banca", weightKg: 102.5, reps: 7, reason: "Subiste las 3 series a 8: prueba 102,5 kg y vuelve al rango bajo", lastSessionAt: 1)]
        var state = LiveSessionState(day: day, programId: nil, suggestions: suggestions, now: .now.addingTimeInterval(-1_260))
        state.toggle(exercise: 0, set: 0, now: .now.addingTimeInterval(-400))
        state.skipRest()
        return state
    }
}

#Preview("Fuerza · 375 pt", traits: .fixedLayout(width: 375, height: 812)) {
    LiveSessionView(session: LiveSession(state: .preview), store: .shared)
}

#Preview("Fuerza · 440 pt, claro", traits: .fixedLayout(width: 440, height: 956)) {
    LiveSessionView(session: LiveSession(state: .preview), store: .shared)
        .preferredColorScheme(.light)
}

#Preview("Fuerza · 375 pt, XXL", traits: .fixedLayout(width: 375, height: 812)) {
    LiveSessionView(session: LiveSession(state: .preview), store: .shared)
        .dynamicTypeSize(.xxLarge)
}
#endif
