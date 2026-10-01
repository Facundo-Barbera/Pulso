import SwiftUI

struct TodayView: View {
    let model: PulsoModel
    @State private var store = TodayStore.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                header
                ReadinessHero(readiness: store.readiness)
                // Integration slot: the Medication feature's today card goes here.
                ActivityCard(day: store.today)
                // Integration slot: pass the Sleep feature's screen as the destination,
                // `SleepCard(day:onSync:) { SleepView() }`, to make this card a link.
                SleepCard(day: store.today, onSync: sync)
                TrendsCard(store: store)
                RecentWorkoutsCard(workouts: store.workouts, onSync: sync)
            }
            .padding(.horizontal)
            .padding(.bottom, 32)
        }
        .navigationTitle(Self.greeting())
        .refreshable { await store.sync() }
        .task { await store.sync() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { sync() }
        }
        .sensoryFeedback(.success, trigger: store.updatedAt)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Olvidar esta Mac", systemImage: "laptopcomputer.slash", role: .destructive) { model.unpair() }
                } label: {
                    Image(systemName: "ellipsis")
                }
            }
        }
    }

    /// Today's date and a quiet sync status; errors show here too, never as a blocking row.
    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide)).capitalized)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
            Spacer()
            TimelineView(.periodic(from: .now, by: 30)) { _ in
                status
            }
        }
    }

    @ViewBuilder private var status: some View {
        let label: Text = if store.syncing {
            Text("Actualizando…")
        } else if model.error != nil {
            Text("Sin conexión con la Mac")
        } else if let updatedAt = store.updatedAt {
            Text("Actualizado \(updatedAt.formatted(.relative(presentation: .named)))")
        } else {
            Text("")
        }
        HStack(spacing: 5) {
            Image(systemName: model.error != nil ? "exclamationmark.icloud" : "arrow.triangle.2.circlepath")
                .symbolEffect(.rotate, isActive: store.syncing)
            label
        }
        .font(.caption)
        .foregroundStyle(model.error != nil ? AnyShapeStyle(Theme.protein) : AnyShapeStyle(.secondary))
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .glassEffect(.regular, in: .capsule)
        .opacity(store.updatedAt == nil && !store.syncing && model.error == nil ? 0 : 1)
        .animation(.snappy, value: store.syncing)
        .accessibilityHint(model.error ?? "")
    }

    private func sync() {
        Task { await store.sync() }
    }

    static func greeting(at date: Date = .now) -> String {
        switch Calendar.current.component(.hour, from: date) {
        case 6..<13: "Buenos días"
        case 13..<20: "Buenas tardes"
        default: "Buenas noches"
        }
    }
}
