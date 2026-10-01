import SwiftUI

/// Two apps often record the same session (the Watch and a gym app, a minute
/// apart). For display, same-activity workouts that overlap more than half of
/// the shorter one collapse into the one with more data.
enum WorkoutMerge {
    static func merged(_ workouts: [Workout]) -> [Workout] {
        var kept: [Workout] = []
        for workout in workouts.sorted(by: { richness($0) > richness($1) }) {
            if !kept.contains(where: { $0.activity == workout.activity && overlap($0, workout) > 0.5 }) {
                kept.append(workout)
            }
        }
        return kept.sorted { $0.startedAt > $1.startedAt }
    }

    /// Fraction of the shorter workout covered by the other.
    static func overlap(_ a: Workout, _ b: Workout) -> Double {
        let shared = min(a.endedAt, b.endedAt) - max(a.startedAt, b.startedAt)
        let shorter = min(a.endedAt - a.startedAt, b.endedAt - b.startedAt)
        return shared > 0 && shorter > 0 ? shared / shorter : 0
    }

    /// More fields filled wins, then the longer recording.
    private static func richness(_ w: Workout) -> (Int, Double) {
        ([w.energy, w.distance].compactMap { $0 }.filter { $0 > 0 }.count, w.endedAt - w.startedAt)
    }
}

extension Workout {
    var start: Date { Date(timeIntervalSince1970: startedAt / 1000) }
    var minutes: Int { Int((endedAt - startedAt) / 60_000) }

    var name: String {
        switch activity {
        case "running": "Carrera"
        case "walking": "Caminata"
        case "hiking": "Senderismo"
        case "cycling": "Ciclismo"
        case "swimming": "Natación"
        case "strength", "functional_strength": "Fuerza"
        case "hiit": "HIIT"
        case "yoga": "Yoga"
        case "rowing": "Remo"
        case "elliptical": "Elíptica"
        case "core": "Core"
        case "flexibility": "Flexibilidad"
        case "cross_training": "Entrenamiento cruzado"
        case "soccer": "Fútbol"
        default: "Entrenamiento"
        }
    }

    var symbol: String {
        switch activity {
        case "running": "figure.run"
        case "walking": "figure.walk"
        case "hiking": "figure.hiking"
        case "cycling": "figure.outdoor.cycle"
        case "swimming": "figure.pool.swim"
        case "strength", "functional_strength": "dumbbell.fill"
        case "hiit", "cross_training": "figure.highintensity.intervaltraining"
        case "yoga", "flexibility": "figure.yoga"
        case "rowing": "figure.rower"
        case "elliptical": "figure.elliptical"
        case "core": "figure.core.training"
        case "soccer": "figure.soccer"
        default: "figure.mixed.cardio"
        }
    }

    var details: String {
        var parts = ["\(minutes) min"]
        if let energy, energy > 0 { parts.append("\(Int(energy)) kcal") }
        if let distance, distance > 0 { parts.append((distance / 1000).formatted(.number.precision(.fractionLength(2))) + " km") }
        return parts.joined(separator: " · ")
    }
}

struct WorkoutRow: View {
    let workout: Workout
    var showsDay = true

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: workout.symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(Theme.training)
                .frame(width: 38, height: 38)
                .background(Theme.training.opacity(0.16), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(workout.name).font(.subheadline.weight(.semibold))
                Text(workout.details).font(.caption).foregroundStyle(.secondary).fontDesign(.rounded)
            }
            Spacer()
            Text(showsDay ? workout.start.formatted(.relative(presentation: .named)) : workout.start.formatted(date: .omitted, time: .shortened))
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
    }
}

/// The last few workouts, with "Ver todo" pushing the full list.
struct RecentWorkoutsCard: View {
    let workouts: [Workout]
    let onSync: () -> Void

    var body: some View {
        Card {
            HStack {
                CardTitle(text: "Entrenamientos", systemImage: "figure.run")
                Spacer()
                if workouts.count > 4 {
                    NavigationLink("Ver todo") { WorkoutListView(workouts: workouts) }
                        .font(.subheadline.weight(.medium))
                }
            }
            if workouts.isEmpty {
                EmptyCardState(
                    symbol: "figure.run.circle",
                    message: "Tus entrenamientos de Salud aparecen acá.",
                    action: ("Sincronizar", onSync)
                )
            } else {
                VStack(spacing: 12) {
                    ForEach(workouts.prefix(4)) { WorkoutRow(workout: $0) }
                }
            }
        }
    }
}

struct WorkoutListView: View {
    let workouts: [Workout]

    private var byDay: [(day: Date, workouts: [Workout])] {
        Dictionary(grouping: workouts) { Calendar.current.startOfDay(for: $0.start) }
            .map { ($0.key, $0.value) }
            .sorted { $0.day > $1.day }
    }

    var body: some View {
        List {
            ForEach(byDay, id: \.day) { group in
                Section(group.day.formatted(.dateTime.weekday(.wide).day().month(.wide))) {
                    ForEach(group.workouts) { WorkoutRow(workout: $0, showsDay: false) }
                }
            }
        }
        .navigationTitle("Entrenamientos")
        .navigationBarTitleDisplayMode(.large)
    }
}

/// A designed empty state for a card: symbol, one line, one action.
struct EmptyCardState: View {
    let symbol: String
    let message: String
    var action: (label: String, run: () -> Void)?

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(.secondary)
                .symbolEffect(.pulse, options: .repeat(2))
            Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            if let action {
                Button(action.label, action: action.run).buttonStyle(.glass)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }
}
