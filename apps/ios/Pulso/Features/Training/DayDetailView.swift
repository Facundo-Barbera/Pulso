import SwiftUI

/// A day of a block's week, opened from Entreno.
struct DayRoute: Identifiable, Hashable {
    var programId: String
    var dayId: String
    var week: Int

    var id: String { "\(programId)·\(dayId)·\(week)" }
}

/// One day as a sheet: its exercises (edit, swap, back to the program's own day),
/// and one action — start it, repeat it (a done day, after a confirm), or nothing
/// for a preview of another week or block. `start` runs once the sheet is gone.
struct DayDetailView: View {
    let route: DayRoute
    let start: (ProgramDay) -> Void
    @State private var store = TrainingStore.shared
    @Environment(\.dismiss) private var dismiss
    @State private var editingDay: ProgramDay?
    @State private var swapping: SwapRequest?
    @State private var resetting: ProgramDay?
    @State private var confirmRepeat = false
    /// Bumped when a quick swap lands, for the haptic.
    @State private var swapped = 0

    private var block: TrainingBlock? { store.blocks.first { $0.programId == route.programId } }
    /// A day of the active program: it can be edited, and started this week.
    private var isActive: Bool { route.programId == store.program?.id }
    private var days: [ProgramDay] { (isActive ? store.program?.days : block?.days) ?? [] }
    private var day: ProgramDay? { days.first { $0.id == route.dayId } }
    private var week: ProgramWeek? { block?.weeks.first { $0.number == route.week } }
    private var weekDay: WeekDay? { week?.days.first { $0.dayId == route.dayId } }
    private var thisWeek: Bool { isActive && week?.isCurrent == true }
    private var isNext: Bool { thisWeek && route.dayId == store.nextDayId }
    private var adjustment: NextAdjustment? { isNext ? store.adjustment : nil }
    private var canStart: Bool { thisWeek && weekDay?.status.isDone != true && store.live == nil && !(day?.exercises.isEmpty ?? true) }
    private var canRepeat: Bool { thisWeek && weekDay?.status.isDone == true && store.live == nil }

    var body: some View {
        NavigationStack {
            ScrollView {
                if let day {
                    VStack(alignment: .leading, spacing: 16) {
                        if !thisWeek, let week { PreviewNote(week: week, block: block, isActive: isActive) }
                        if let adjustment, adjustment.applies || adjustment.reviewing { AdjustmentNote(adjustment: adjustment) }
                        DayPlan(
                            day: day,
                            number: (days.firstIndex(of: day) ?? 0) + 1,
                            tagline: tagline,
                            suggestions: store.suggestions,
                            records: TrainingPlan.recentRecords(store.sessions),
                            weightKg: store.bodyWeightKg,
                            editable: isActive,
                            actions: DayActions(
                                edit: { editingDay = $0 },
                                swap: { day, exercise in
                                    // The next day (or one already changed for today) swaps for today; others for good.
                                    let today = day.overridden == true || day.id == store.nextDayId
                                    swapping = SwapRequest(dayId: day.id, exercise: exercise, initialScope: today ? .today : .always)
                                },
                                reset: { resetting = $0 }
                            )
                        )
                    }
                    .padding(.horizontal, Theme.padding)
                    .padding(.bottom, 24)
                    .animation(.snappy, value: day)
                } else {
                    EmptyStateView(systemImage: "calendar.badge.exclamationmark", title: "Este día ya no está en el programa", tint: Theme.training)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let day, canStart {
                    BigButton(title: "Empezar \(day.name)", systemImage: "play.fill") { begin(day) }
                } else if canRepeat {
                    Button("Repetir este día", systemImage: "arrow.counterclockwise") { confirmRepeat = true }
                        .font(.headline)
                        .buttonStyle(.glass)
                        .tint(Theme.training)
                        .padding(.bottom, 8)
                }
            }
            .navigationTitle(week.map { "Semana \($0.number)" } ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: ExerciseRoute.self) { ExerciseDetailView(exerciseId: $0.exerciseId, name: $0.name) }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Listo", systemImage: "checkmark") { dismiss() }
                }
                if isActive, let day {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Editar", systemImage: "slider.horizontal.3") { editingDay = day }
                    }
                }
            }
        }
        .presentationDragIndicator(.visible)
        .sheet(item: $editingDay) { day in
            DayEditorView(day: day, suggestions: store.suggestions, hrZones: store.hrZones)
        }
        .sheet(item: $swapping) { request in
            SwapExerciseSheet(exerciseId: request.exercise.exerciseId, name: request.exercise.exerciseName, initialScope: request.initialScope) { library, scope in
                swap(request, to: library, scope: scope)
            }
        }
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
        .confirmationDialog("¿Repetir \(day?.name ?? "este día")?", isPresented: $confirmRepeat, titleVisibility: .visible) {
            Button("Repetir") { if let day { begin(day) } }
        } message: {
            Text("Ya lo hiciste esta semana. Se guarda como otra sesión del mismo día y no cambia cuál toca después.")
        }
        .sensoryFeedback(.success, trigger: swapped)
    }

    /// "Hecho · jue 1 oct", "Siguiente", "Hoy toca · Lunes"…
    private var tagline: String? {
        if let session = weekDay?.last, weekDay?.status.isDone == true {
            return "\(weekDay?.status == .partial ? "A medias" : "Hecho") · \(session.start.formatted(.dateTime.weekday(.wide).day().month()))"
        }
        let today = (Calendar.current.component(.weekday, from: .now) + 5) % 7 + 1
        let next = isNext ? (day?.weekday == today ? "Hoy toca" : "Siguiente") : nil
        let weekday = day?.weekday.map { Calendar.current.weekdaySymbols[$0 % 7].capitalized }
        let parts = [next, weekday].compactMap(\.self)
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func begin(_ day: ProgramDay) {
        start(day)
        dismiss()
    }

    /// The quick "Cambiar" on a row: the day as it is, with that one exercise replaced.
    private func swap(_ request: SwapRequest, to library: LibraryExercise, scope: EditScope) {
        guard let day = store.program?.days.first(where: { $0.id == request.dayId }) else { return }
        let list = day.exercises.map { $0.id == request.exercise.id ? $0.swapped(to: library) : $0 }
        Task {
            do {
                try await store.saveDay(day.id, scope: scope, exercises: list.map(\.editInput))
                swapped += 1
            } catch {
                PulsoModel.shared.handle(error)
            }
        }
    }
}

/// "Vista previa · semana 5": another week or block's day, read-only for starting.
private struct PreviewNote: View {
    let week: ProgramWeek
    let block: TrainingBlock?
    let isActive: Bool

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(isActive ? (week.isFuture ? "Vista previa de la semana \(week.number)" : "Semana \(week.number), ya pasada") : "Bloque \(block?.number ?? 0) · \(block?.name ?? "")")
                    .font(.subheadline.weight(.semibold))
                Text(week.note ?? (week.isFuture ? "Mismo plan: las cargas se ajustan con lo que hagas antes." : "Así era el día en el programa."))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: week.deload ? "arrow.down.right.circle" : "eye.circle").foregroundStyle(Theme.training)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.training.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// The quick "Cambiar" on a plan row.
private struct SwapRequest: Identifiable {
    var dayId: String
    var exercise: ProgramExercise
    var initialScope: EditScope

    var id: String { exercise.id }
}

/// What a day offers when it can be edited: edit it, swap one exercise, drop today's changes.
struct DayActions {
    var edit: (ProgramDay) -> Void = { _ in }
    var swap: (ProgramDay, ProgramExercise) -> Void = { _, _ in }
    var reset: (ProgramDay) -> Void = { _ in }
}

/// The day's name and focus, today's changes, its numbers and its exercises.
struct DayPlan: View {
    let day: ProgramDay
    let number: Int
    let tagline: String?
    let suggestions: [String: LoadSuggestion]
    let records: Set<String>
    let weightKg: Double?
    var editable = true
    var actions = DayActions()

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text([tagline, "Día \(number)"].compactMap(\.self).joined(separator: " · "))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.training)
                Text(day.name)
                    .font(.largeTitle.bold())
                    .fontDesign(.rounded)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                if let focus = day.focus, !focus.isEmpty {
                    Text(focus).font(.title3).foregroundStyle(.secondary)
                }
            }

            if editable, day.overridden == true {
                TodayChangesBar { actions.reset(day) }
                    .transition(.opacity.combined(with: .scale(scale: 0.95, anchor: .leading)))
            }

            DayStats(day: day, weightKg: weightKg)

            if day.exercises.isEmpty {
                Card {
                    Label("Día sin ejercicios", systemImage: "figure.cooldown")
                        .foregroundStyle(.secondary)
                    if editable {
                        Button("Añadir ejercicios", systemImage: "plus") { actions.edit(day) }
                            .buttonStyle(.glass)
                            .tint(Theme.training)
                    }
                }
            } else {
                Card {
                    VStack(spacing: 0) {
                        ForEach(day.exercises) { ex in
                            PlanExerciseRow(exercise: ex, suggestion: suggestions[ex.id], record: records.contains(ex.exerciseId))
                                .contextMenu {
                                    if editable {
                                        Button("Cambiar ejercicio", systemImage: "arrow.triangle.2.circlepath") { actions.swap(day, ex) }
                                        Button("Editar día", systemImage: "slider.horizontal.3") { actions.edit(day) }
                                    }
                                }
                            if ex.id != day.exercises.last?.id { Divider().padding(.leading, 68) }
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
struct DayStats: View {
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
                    Text(exercise.isCardio ? exercise.prescription : TrainingPlan.prescription(exercise, weightKg: exercise.weightKg ?? suggestion?.weightKg, unit: TrainingStore.shared.unit(for: exercise.exerciseId)))
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
struct MuscleBadge: View {
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

/// The screen's one big action, on glass at the bottom.
struct BigButton: View {
    let title: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.title3.bold())
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
        }
        .buttonStyle(.glassProminent)
        .tint(Theme.training)
        .sensoryFeedback(.impact, trigger: title)
        .padding(.horizontal, Theme.padding)
        .padding(.bottom, 8)
    }
}
