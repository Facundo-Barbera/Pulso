import SwiftUI

/// "Agua de hoy": every glass logged on the day, newest first. Swipe or tap the
/// trash to delete one by mistake; it leaves Salud too.
struct WaterEntriesSheet: View {
    let store: NutritionStore
    @Environment(\.dismiss) private var dismiss

    private var entries: [WaterEntry] { (store.water?.entries ?? []).sorted { $0.loggedAt > $1.loggedAt } }
    private var settings: WaterSettings { store.water?.settings ?? .standard }

    var body: some View {
        NavigationStack {
            List {
                if entries.isEmpty {
                    ContentUnavailableView("Sin agua registrada", systemImage: "drop",
                                           description: Text("Cada vaso que registres aparecerá aquí."))
                        .listRowBackground(Color.clear)
                } else {
                    Section {
                        ForEach(entries) { entry in
                            row(entry)
                                .swipeActions {
                                    Button("Borrar", systemImage: "trash", role: .destructive) { remove(entry) }
                                }
                        }
                    } footer: {
                        Text("Desliza a la izquierda para borrar un registro hecho por error.")
                    }
                }
            }
            .navigationTitle("Agua de hoy")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Listo") { dismiss() } }
            }
            .animation(.snappy, value: entries)
            .sensoryFeedback(.impact(weight: .light), trigger: entries.count) { old, new in new < old }
        }
    }

    private func row(_ entry: WaterEntry) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "drop.fill").foregroundStyle(Theme.water)
            VStack(alignment: .leading, spacing: 2) {
                Text(settings.format(entry.amountMl)).font(.body.weight(.semibold)).fontDesign(.rounded)
                Text(Date(timeIntervalSince1970: entry.loggedAt / 1000).formatted(date: .omitted, time: .shortened))
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button("Borrar", systemImage: "trash", role: .destructive) { remove(entry) }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
        }
    }

    private func remove(_ entry: WaterEntry) {
        Task { await store.removeWater(entry) }
    }
}
