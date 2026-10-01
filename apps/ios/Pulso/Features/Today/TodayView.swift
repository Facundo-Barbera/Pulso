import SwiftUI

struct TodayView: View {
    let model: PulsoModel

    var body: some View {
        List {
            Section {
                Button {
                    Task { await model.syncHealth() }
                } label: {
                    HStack {
                        Label("Sincronizar desde Salud", systemImage: "heart.text.square")
                        if model.syncing {
                            Spacer()
                            ProgressView()
                        }
                    }
                }
                .disabled(model.syncing)
            } footer: {
                if let error = model.error {
                    Text(error).foregroundStyle(.red)
                } else if let lastSync = model.lastSync {
                    Text(lastSync)
                }
            }

            Section("Entrenamientos") {
                if model.workouts.isEmpty {
                    Text("Todavía nada.").foregroundStyle(.secondary)
                }
                ForEach(model.workouts) { workout in
                    WorkoutRow(workout: workout)
                }
            }
        }
        .navigationTitle("Hoy")
        .refreshable { await model.refresh() }
        .toolbar {
            Menu {
                Button("Olvidar esta Mac", role: .destructive) { model.unpair() }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
        }
    }
}

private struct WorkoutRow: View {
    let workout: Workout

    var body: some View {
        let start = Date(timeIntervalSince1970: workout.startedAt / 1000)
        let minutes = Int((workout.endedAt - workout.startedAt) / 60_000)
        VStack(alignment: .leading, spacing: 2) {
            Text(workout.activity.capitalized).font(.headline)
            Text(details(start: start, minutes: minutes)).font(.subheadline).foregroundStyle(.secondary)
        }
    }

    private func details(start: Date, minutes: Int) -> String {
        var parts = [start.formatted(date: .abbreviated, time: .shortened), "\(minutes) min"]
        if let energy = workout.energy { parts.append("\(Int(energy)) kcal") }
        if let distance = workout.distance { parts.append(String(format: "%.2f km", distance / 1000)) }
        return parts.joined(separator: " · ")
    }
}
