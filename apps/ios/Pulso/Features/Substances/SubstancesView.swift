import SwiftUI

/// Sustancias: a private, non-judgmental log of when the person uses cannabis,
/// alcohol or nicotine, to see how often and how it sits with their sleep. Only
/// reachable through `SubstancesAccess` (Face ID each time); closes itself when
/// the app goes to the background. A List, not a ScrollView, so entries swipe.
struct SubstancesView: View {
    /// Presented as a sheet (the profile menu) rather than pushed (Ajustes): adds "Listo".
    var closable = false
    @State private var store = SubstanceStore()
    @State private var logging: LogTarget?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    private enum LogTarget: Identifiable {
        case new(Substance)
        case existing(SubstanceEntry)
        var id: String {
            switch self {
            case let .new(substance): "new-\(substance.rawValue)"
            case let .existing(entry): entry.id
            }
        }
    }

    var body: some View {
        List {
            Section {
                Picker("Sustancia", selection: $store.substance) {
                    ForEach(Substance.allCases) { Text($0.shortLabel).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            .cardRow()

            if let overview = store.current {
                if overview.isEmpty {
                    Section {
                        EmptyStateView(
                            systemImage: store.substance.symbol,
                            title: "Sin registros de \(store.substance.label.lowercased())",
                            message: "Anota cuándo consumes para ver con qué frecuencia y cómo se lleva con tu sueño. Solo tú lo ves.",
                            tint: SubstanceStyle.tint,
                            actionTitle: "Registrar"
                        ) { logging = .new(store.substance) }
                    }
                    .cardRow()
                } else {
                    dashboard(overview)
                    entries(overview)
                }
            } else {
                Section {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 60)
                }
                .cardRow()
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(14)
        .navigationTitle("Sustancias")
        .toolbar {
            if closable {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Listo", systemImage: "checkmark") { dismiss() }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Registrar", systemImage: "plus") { logging = .new(store.substance) }
                    .buttonStyle(.glassProminent)
            }
        }
        .refreshable { await store.load() }
        .onChange(of: store.substance, initial: true) { _, _ in Task { await store.load() } }
        // More private than the rest of the app: leaving Pulso closes it, and coming back asks again.
        .onChange(of: scenePhase) { _, phase in if phase == .background { dismiss() } }
        .animation(.snappy, value: store.current)
        .sensoryFeedback(.selection, trigger: store.substance)
        .sensoryFeedback(.success, trigger: store.changes)
        .sheet(item: $logging) { target in
            switch target {
            case let .new(substance): SubstanceLogSheet(store: store, entry: nil, substance: substance)
            case let .existing(entry): SubstanceLogSheet(store: store, entry: entry, substance: entry.substance)
            }
        }
    }

    @ViewBuilder private func dashboard(_ overview: SubstanceOverview) -> some View {
        let summary = overview.summary
        Section {
            SubstanceHero(summary: summary)
        }
        .cardRow()
        Section {
            HStack(spacing: 10) {
                StatTile(title: "Esta semana", value: "\(summary.daysThisWeek)", unit: SubstanceText.days(summary.daysThisWeek), systemImage: "calendar", tint: SubstanceStyle.tint)
                StatTile(
                    title: "Promedio",
                    value: summary.avgDaysPerWeek.map { $0.formatted(.number.precision(.fractionLength(0...1))) } ?? "—",
                    unit: summary.avgDaysPerWeek == nil ? nil : "días/sem",
                    systemImage: "chart.bar",
                    tint: SubstanceStyle.tint
                )
                StatTile(title: "Más largo sin", value: "\(summary.longestWithout)", unit: SubstanceText.days(summary.longestWithout), systemImage: "arrow.left.and.right", tint: SubstanceStyle.tint)
            }
        }
        .cardRow()
        Section {
            SubstanceHeatmapCard(summary: summary)
        }
        .cardRow()
        Section {
            SubstanceWeeksCard(summary: summary, goal: store.substance == .cannabis ? overview.settings.maxDaysPerWeek : nil)
        }
        .cardRow()
        if summary.timeOfDay.contains(where: { $0.uses > 0 }) {
            Section {
                SubstanceTimeOfDayCard(buckets: summary.timeOfDay)
            }
            .cardRow()
        }
        if !summary.correlations.isEmpty {
            Section {
                SubstanceCorrelationsCard(correlations: summary.correlations)
            }
            .cardRow()
        }
        // One setting on the engine; it reads as "días de cannabis", so it lives on that tab.
        if store.substance == .cannabis {
            Section {
                SubstanceGoalCard(maxDays: overview.settings.maxDaysPerWeek, daysThisWeek: summary.daysThisWeek) { max in
                    await store.setGoal(max)
                }
            }
            .cardRow()
        }
    }

    private func entries(_ overview: SubstanceOverview) -> some View {
        Section {
            ForEach(overview.entries) { entry in
                Button { logging = .existing(entry) } label: { SubstanceEntryRow(entry: entry) }
                    .tint(.primary)
                    .swipeActions(edge: .trailing) {
                        Button("Eliminar", systemImage: "trash", role: .destructive) {
                            Task { await store.delete(entry) }
                        }
                    }
                    .swipeActions(edge: .leading) {
                        Button("Editar", systemImage: "pencil") { logging = .existing(entry) }
                            .tint(SubstanceStyle.tint)
                    }
            }
        } header: {
            Text("Registros")
        } footer: {
            Text("Últimos 60 días. Desliza para editar o eliminar.")
        }
    }
}

private extension View {
    /// A dashboard card as a List row: no cell background, insets or separators.
    func cardRow() -> some View {
        listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
    }
}

struct SubstanceEntryRow: View {
    let entry: SubstanceEntry

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: entry.symbol)
                .font(.body.weight(.medium))
                .foregroundStyle(SubstanceStyle.tint)
                .frame(width: 36, height: 36)
                .background(SubstanceStyle.tint.opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.title).font(.body.weight(.medium))
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
                if let note = entry.note, !note.isEmpty {
                    Text(note).font(.caption).foregroundStyle(.tertiary).lineLimit(1)
                }
            }
            .lineLimit(1)
            Spacer(minLength: 8)
            if let detail {
                Text(detail)
                    .font(.subheadline.weight(.semibold))
                    .fontDesign(.rounded)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        var parts = [SubstanceText.dayTitle(entry.date), LocalClock.display(entry.time)]
        if let context = entry.context { parts.append(context.label) }
        return parts.joined(separator: " · ")
    }

    private var detail: String? {
        if let mg = entry.thcMg { return "\(mg.formatted(.number.precision(.fractionLength(0...1)))) mg" }
        if let count = entry.count { return "×\(count)" }
        return nil
    }
}

#Preview("Sustancias") {
    NavigationStack { SubstancesView(closable: true) }
}
