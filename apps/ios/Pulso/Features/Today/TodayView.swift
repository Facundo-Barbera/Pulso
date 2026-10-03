import SwiftUI

struct TodayView: View {
    let model: PulsoModel
    @State private var store = TodayStore.shared
    /// Backs "Añadir noche" on the sleep card; saving reloads Hoy.
    @State private var sleep = SleepStore()
    @State private var addingSleep = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                header
                ReadinessHero(readiness: store.readiness)
                CoachBriefCard(model: model)
                CalendarWeekStrip(model: model)
                MedicationTodayCard(model: model)
                ActivityCard(day: store.today)
                SleepCard(day: store.today, onSync: sync, onAdd: { addingSleep = true }) { SleepView(model: model) }
                TrendsCard(store: store)
                RecentWorkoutsCard(entries: store.recent, onSync: sync)
            }
            .padding(.horizontal)
            .padding(.bottom, 32)
        }
        .navigationTitle(Self.greeting())
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink { CalendarView(model: model) } label: { Image(systemName: "calendar") }
                    .accessibilityLabel("Calendario")
            }
        }
        .refreshable { await store.sync() }
        .task { await store.sync() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { sync() }
        }
        .sensoryFeedback(.success, trigger: store.updatedAt)
        .sheet(isPresented: $addingSleep) {
            ManualSleepSheet(store: sleep, model: model)
        }
    }

    /// Today's date and a quiet sync status; errors show here too, never as a blocking row.
    /// Side by side when they fit; on a 375 pt phone or large text the status drops below.
    private var header: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline) {
                today
                Spacer()
                syncStatus
            }
            VStack(alignment: .leading, spacing: 6) {
                today
                syncStatus
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var today: some View {
        Text(Self.sentenceCase(Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide))))
            .font(.subheadline.weight(.medium))
            .foregroundStyle(.secondary)
            .lineLimit(1)
    }

    private var syncStatus: some View {
        TimelineView(.periodic(from: .now, by: 30)) { _ in
            status
        }
    }

    /// "miércoles, 1 de octubre" → "Miércoles, 1 de octubre" (`.capitalized` would give "1 De Octubre").
    static func sentenceCase(_ text: String) -> String {
        text.prefix(1).uppercased() + text.dropFirst()
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
        .lineLimit(1)
        .foregroundStyle(model.error != nil ? AnyShapeStyle(Theme.caution) : AnyShapeStyle(.secondary))
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
