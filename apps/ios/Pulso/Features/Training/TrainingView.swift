import SwiftUI

/// Entreno: the day to train as the hero, the rest of the program below, then
/// recent sessions. "Empezar" opens the live session full screen.
struct TrainingView: View {
    let model: PulsoModel
    @State private var store = TrainingStore.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let live = store.live {
                    ResumeCard(live: live) { showLive = true }
                }
                if let program = store.program {
                    if let day = store.nextDay {
                        TodayHero(day: day, suggestions: store.suggestions, busy: store.live != nil) { start(day) }
                    }
                    ProgramHeader(program: program)
                    ForEach(program.days.filter { $0.id != store.nextDay?.id }) { day in
                        DayCard(day: day, suggestions: store.suggestions, busy: store.live != nil) { start(day) }
                    }
                    if !store.sessions.isEmpty {
                        RecentSessions(sessions: store.sessions)
                    }
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
        .navigationTitle("Entreno")
        .navigationDestination(for: ExerciseRoute.self) { ExerciseHistoryView(route: $0) }
        .refreshable { await store.load() }
        .task { await store.load() }
        .fullScreenCover(isPresented: $showLive, onDismiss: finishIfRequested) {
            if let live = store.live {
                LiveSessionView(session: live, store: store)
            }
        }
        // Reads the store, not the closure's value: records arrive after the sheet opens.
        .sheet(item: $store.summary) { opened in SessionSummaryView(summary: store.summary ?? opened) }
    }

    @State private var showLive = false

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

/// Pushes an exercise's history chart.
struct ExerciseRoute: Hashable {
    var exerciseId: String
    var name: String
}

// MARK: - Hero

private struct TodayHero: View {
    let day: ProgramDay
    let suggestions: [String: LoadSuggestion]
    let busy: Bool
    let start: () -> Void

    /// 1 = Monday … 7 = Sunday, like `ProgramDay.weekday`.
    private var isoWeekdayToday: Int { (Calendar.current.component(.weekday, from: .now) + 5) % 7 + 1 }

    private var minutes: Int {
        let seconds = day.exercises.reduce(0) { $0 + $1.sets * ($1.restSeconds + 45) }
        return max(10, Int((Double(seconds) / 60 / 5).rounded()) * 5)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(day.weekday == isoWeekdayToday ? "Hoy toca" : "Siguiente")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.training)
                Text(day.name)
                    .font(.largeTitle.bold())
                    .fontDesign(.rounded)
                if let focus = day.focus {
                    Text(focus).font(.title3).foregroundStyle(.secondary)
                }
            }

            HStack(spacing: 20) {
                Stat(value: "\(day.exercises.count)", label: "ejercicios")
                Stat(value: "\(day.exercises.reduce(0) { $0 + $1.sets })", label: "series")
                Stat(value: "~\(minutes)", label: "min")
            }

            VStack(spacing: 0) {
                ForEach(day.exercises) { ex in
                    ExerciseLine(exercise: ex, suggestion: suggestions[ex.id])
                    if ex.id != day.exercises.last?.id { Divider().padding(.leading, 4) }
                }
            }

            Button(action: start) {
                Label("Empezar", systemImage: "play.fill")
                    .font(.title3.bold())
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
            }
            .buttonStyle(.glassProminent)
            .tint(Theme.training)
            .disabled(busy)
        }
        .padding(20)
        .background {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(LinearGradient(colors: [Theme.training.opacity(0.28), Theme.training.opacity(0.06)], startPoint: .topLeading, endPoint: .bottomTrailing))
        }
        .overlay {
            RoundedRectangle(cornerRadius: 28, style: .continuous).strokeBorder(Theme.training.opacity(0.25))
        }
    }
}

private struct Stat: View {
    let value: String
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value).font(.title2.bold()).fontDesign(.rounded)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
    }
}

/// One prescribed exercise: name and prescription, the suggested load on the right.
private struct ExerciseLine: View {
    let exercise: ProgramExercise
    let suggestion: LoadSuggestion?

    var body: some View {
        NavigationLink(value: ExerciseRoute(exerciseId: exercise.exerciseId, name: exercise.exerciseName)) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(exercise.exerciseName).font(.body.weight(.medium)).foregroundStyle(.primary)
                    Text(exercise.prescription).font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer()
                if let weight = suggestion?.weightKg, weight > 0 {
                    Text("\(weight.formatted()) kg")
                        .font(.subheadline.weight(.semibold))
                        .fontDesign(.rounded)
                        .foregroundStyle(Theme.training)
                }
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Program

private struct ProgramHeader: View {
    let program: TrainingProgram

    var body: some View {
        Card {
            CardTitle(text: "Programa", systemImage: "list.bullet.clipboard")
            Text(program.name).font(.headline)
            Text(program.goal).font(.subheadline).foregroundStyle(.secondary)
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

private struct DayCard: View {
    let day: ProgramDay
    let suggestions: [String: LoadSuggestion]
    let busy: Bool
    let start: () -> Void
    @State private var expanded = false

    var body: some View {
        Card {
            Button {
                withAnimation(.snappy) { expanded.toggle() }
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(day.name).font(.headline)
                        Text(day.focus ?? day.exercises.map(\.exerciseName).joined(separator: ", "))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer()
                    if let weekday = day.weekday {
                        Text(Calendar.current.weekdaySymbols[weekday % 7].capitalized)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                    Image(systemName: "chevron.down")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if expanded {
                VStack(spacing: 0) {
                    ForEach(day.exercises) { ExerciseLine(exercise: $0, suggestion: suggestions[$0.id]) }
                }
                Button("Empezar este día", systemImage: "play.fill", action: start)
                    .buttonStyle(.glass)
                    .disabled(busy)
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
