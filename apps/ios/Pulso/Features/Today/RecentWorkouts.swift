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
        case "stair_climbing": "Escaladora"
        case "stairs": "Escaleras"
        case "mixed_cardio": "Cardio"
        case "jump_rope": "Comba"
        case "cooldown": "Enfriamiento"
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
        case "stair_climbing", "stairs": "figure.stair.stepper"
        case "jump_rope": "figure.jumprope"
        case "cooldown": "figure.cooldown"
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

/// One row of "what I trained" (`@pulso/contract` `ActivityEntry`): a Pulso session with what the
/// Watch recorded during it merged in, or a Health workout on its own. Each workout appears once.
struct ActivityEntry: Codable, Identifiable, Hashable {
    /// "session" or "workout".
    var kind: String
    var id: String
    /// Spanish: "Torso A", "Carrera".
    var title: String
    var activity: String?
    var startedAt: Double
    var endedAt: Double
    var energy: Double?
    /// meters
    var distance: Double?
    var avgHeartRate: Double?
    var maxHeartRate: Double?
    var sets: Int?
    var volumeKg: Double?
    var merged: Bool = false
    var parts: [RecordedPart] = []
    var sourceName: String?

    var start: Date { Date(timeIntervalSince1970: startedAt / 1000) }
    var minutes: Int { Int((endedAt - startedAt) / 60_000) }
    var isSession: Bool { kind == "session" }

    var symbol: String {
        isSession ? "figure.strengthtraining.traditional" : Workout(id: id, source: "healthkit", activity: activity ?? "", startedAt: startedAt, endedAt: endedAt).symbol
    }

    /// "41 min · 10 series · 201 kcal" for a session, "32 min · 310 kcal · 5,10 km" for a workout.
    var details: String {
        var parts = ["\(minutes) min"]
        if let sets, sets > 0 { parts.append("\(sets) series") }
        if let energy, energy > 0 { parts.append("\(Int(energy.rounded())) kcal") }
        if !isSession, let distance, distance > 0 { parts.append((distance / 1000).formatted(.number.precision(.fractionLength(2))) + " km") }
        return parts.joined(separator: " · ")
    }
}

extension ActivityEntry {
    init(workout: Workout) {
        self.init(kind: "workout", id: workout.id, title: workout.name, activity: workout.activity, startedAt: workout.startedAt, endedAt: workout.endedAt,
                  energy: workout.energy, distance: workout.distance, avgHeartRate: workout.avgHeartRate, maxHeartRate: workout.maxHeartRate)
    }
}

struct WorkoutRow: View {
    let entry: ActivityEntry
    var showsDay = true

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: entry.symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(Theme.training)
                .frame(width: 38, height: 38)
                .background(Theme.training.opacity(0.16), in: Circle())
                .overlay(alignment: .bottomTrailing) {
                    if entry.merged {
                        Image(systemName: "applewatch")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.pink)
                            .padding(3)
                            .background(.background, in: Circle())
                            .offset(x: 3, y: 3)
                            .accessibilityLabel("Con datos de Apple Watch")
                    }
                }
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(entry.details).font(.caption).foregroundStyle(.secondary).fontDesign(.rounded).lineLimit(2)
            }
            Spacer(minLength: 8)
            // The day keeps its width; the name and details give way first.
            Text(showsDay ? entry.start.formatted(.relative(presentation: .named)) : entry.start.formatted(date: .omitted, time: .shortened))
                .font(.caption)
                .foregroundStyle(.tertiary)
                .lineLimit(1)
                .layoutPriority(1)
        }
    }
}

/// The last few sessions and workouts, with "Ver todo" pushing the full list.
struct RecentWorkoutsCard: View {
    let entries: [ActivityEntry]
    let onSync: () -> Void

    var body: some View {
        Card {
            HStack {
                CardTitle(text: "Entrenamientos", systemImage: "figure.run")
                Spacer()
                if entries.count > 4 {
                    NavigationLink("Ver todo") { WorkoutListView(entries: entries) }
                        .font(.subheadline.weight(.medium))
                }
            }
            if entries.isEmpty {
                EmptyCardState(
                    symbol: "figure.run.circle",
                    message: "Tus sesiones y entrenamientos de Salud aparecen acá.",
                    action: ("Sincronizar", onSync)
                )
            } else {
                VStack(spacing: 12) {
                    ForEach(entries.prefix(4)) { WorkoutRow(entry: $0) }
                }
            }
        }
    }
}

struct WorkoutListView: View {
    let entries: [ActivityEntry]

    private var byDay: [(day: Date, entries: [ActivityEntry])] {
        Dictionary(grouping: entries) { Calendar.current.startOfDay(for: $0.start) }
            .map { ($0.key, $0.value.sorted { $0.startedAt > $1.startedAt }) }
            .sorted { $0.day > $1.day }
    }

    var body: some View {
        List {
            ForEach(byDay, id: \.day) { group in
                Section(group.day.formatted(.dateTime.weekday(.wide).day().month(.wide))) {
                    ForEach(group.entries) { WorkoutRow(entry: $0, showsDay: false) }
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
