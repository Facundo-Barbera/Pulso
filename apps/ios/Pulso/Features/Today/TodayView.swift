import SwiftUI

struct TodayView: View {
    let model: PulsoModel
    @State private var store = TodayStore.shared

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                Text(Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(Locale(identifier: "es"))).uppercased())
                    .font(.caption.weight(.semibold))
                    .tracking(0.6)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if let error = model.error {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                ReadinessCard(readiness: store.readiness)
                ActivityCard(day: store.today)
                SleepCard(day: store.today)
                SignalsCard(store: store)
                WorkoutsCard(workouts: model.workouts)

                if let lastSync = model.lastSync {
                    Text(lastSync).font(.caption).foregroundStyle(.tertiary)
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 24)
        }
        .navigationTitle(Self.greeting())
        .refreshable { await store.sync() }
        .task { await store.sync() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if store.syncing { ProgressView() }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Sincronizar desde Salud", systemImage: "heart.text.square") { Task { await store.sync() } }
                        .disabled(store.syncing)
                    Button("Olvidar esta Mac", role: .destructive) { model.unpair() }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
    }

    static func greeting(at date: Date = .now) -> String {
        switch Calendar.current.component(.hour, from: date) {
        case 6..<13: "Buenos días"
        case 13..<20: "Buenas tardes"
        default: "Buenas noches"
        }
    }
}
