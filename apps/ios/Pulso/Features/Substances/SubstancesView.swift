import SwiftUI

/// Sustancias: a private, non-judgmental log of when the person uses something
/// (Cannabis and Alcohol built in, plus their own), to see how often and how it
/// sits with their sleep. Only reachable through `SubstancesAccess` (Face ID each
/// time); closes itself when the app goes to the background. A List, not a
/// ScrollView, so entries swipe.
struct SubstancesView: View {
    /// Presented as a sheet (the profile menu) rather than pushed (Ajustes): adds "Listo".
    var closable = false
    @State private var store = SubstanceStore()
    @State private var logging: LogTarget?
    @State private var managing = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    private enum LogTarget: Identifiable {
        case new(Substance)
        case existing(SubstanceEntry, Substance)
        var id: String {
            switch self {
            case let .new(substance): "new-\(substance.id)"
            case let .existing(entry, _): entry.id
            }
        }
    }

    /// What "Registrar" starts on: the substance shown, or the first one under Todas.
    private var logDefault: Substance? {
        store.substance(store.scope?.substanceId) ?? store.active.first
    }

    var body: some View {
        List {
            if !store.active.isEmpty {
                Section {
                    SubstanceChips(items: [SubstanceScope.all] + store.active.map { .one($0.id) }, selection: store.scope, inset: 0, onSelect: { if let scope = $0 { store.scope = scope } }) { scope in
                        if let substance = store.substance(scope.substanceId) {
                            SubstanceLabel(substance: substance)
                        } else {
                            Label("Todas", systemImage: "square.grid.2x2")
                        }
                    }
                    .padding(.vertical, 2)
                }
                .cardRow()
            }

            if let overview = store.current {
                if overview.isEmpty {
                    Section { empty }.cardRow()
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
                Button("Gestionar sustancias", systemImage: "slider.horizontal.3") { managing = true }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Registrar", systemImage: "plus") { if let logDefault { logging = .new(logDefault) } }
                    .buttonStyle(.glassProminent)
                    .disabled(logDefault == nil)
            }
        }
        .navigationDestination(isPresented: $managing) { SubstanceManageView(store: store) }
        .refreshable { await store.load() }
        // Also on coming back from "Gestionar sustancias". Unstructured: leaving must not cancel it.
        .onAppear { Task { await store.load() } }
        // The first load picks the scope; later switches load what's newly shown.
        .onChange(of: store.scope) { old, _ in if old != nil { Task { await store.load() } } }
        // More private than the rest of the app: leaving Pulso closes it, and coming back asks again.
        .onChange(of: scenePhase) { _, phase in
            if phase == .background {
                logging = nil
                managing = false
                dismiss()
            }
        }
        .animation(.snappy, value: store.current)
        .sensoryFeedback(.selection, trigger: store.scope)
        .sensoryFeedback(.success, trigger: store.changes)
        .sheet(item: $logging) { target in
            switch target {
            case let .new(substance): SubstanceLogSheet(store: store, entry: nil, substance: substance)
            case let .existing(entry, substance): SubstanceLogSheet(store: store, entry: entry, substance: substance)
            }
        }
    }

    @ViewBuilder private var empty: some View {
        let substance = store.substance(store.scope?.substanceId)
        VStack(spacing: 14) {
            SubstanceGlyphView(symbol: substance?.symbol ?? "square.grid.2x2")
                .font(.system(size: 44, weight: .medium))
                .foregroundStyle(SubstanceStyle.tint.gradient)
                .symbolEffect(.bounce, options: .nonRepeating)
                .frame(width: 88, height: 88)
                .background(SubstanceStyle.tint.opacity(0.12), in: Circle())
            Text(substance.map { "Sin registros de \($0.name.lowercased())" } ?? "Sin registros todavía")
                .font(.headline)
                .multilineTextAlignment(.center)
            Text("Anota cuándo consumes para ver con qué frecuencia y cómo se lleva con tu sueño. Solo tú lo ves.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if let logDefault {
                Button("Registrar") { logging = .new(logDefault) }
                    .buttonStyle(.glassProminent)
                    .padding(.top, 4)
            }
        }
        .padding(.vertical, 28)
        .padding(.horizontal, Theme.padding)
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private func dashboard(_ overview: SubstanceOverview) -> some View {
        let summary = overview.summary
        let substance = store.substance(summary.substanceId)
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
            SubstanceWeeksCard(summary: summary, goal: substance?.maxDaysPerWeek)
        }
        .cardRow()
        if summary.substanceId == nil, summary.bySubstance.contains(where: { $0.uses > 0 }) {
            Section {
                SubstanceBarsCard(title: "Por sustancia", systemImage: "square.grid.2x2", rows: summary.bySubstance.map { item in
                    let known = store.substance(item.substanceId)
                    return .init(id: item.substanceId, label: known?.name ?? item.substanceId, symbol: known?.symbol, uses: item.uses)
                })
            }
            .cardRow()
        }
        if let substance, summary.byForm.filter({ $0.uses > 0 }).count > 1 {
            Section {
                SubstanceBarsCard(title: "Forma", systemImage: "square.stack", rows: summary.byForm.map {
                    .init(id: $0.form, label: SubstanceText.capitalizedFirst($0.form), symbol: SubstanceText.formSymbol($0.form) ?? substance.symbol, uses: $0.uses)
                })
            }
            .cardRow()
        }
        if summary.timeOfDay.contains(where: { $0.uses > 0 }) {
            Section {
                SubstanceBarsCard(title: "Momento del día", systemImage: "clock", rows: summary.timeOfDay.map {
                    .init(id: $0.key, label: $0.label, symbol: $0.symbol, uses: $0.uses)
                })
            }
            .cardRow()
        }
        if !summary.correlations.isEmpty {
            Section {
                SubstanceCorrelationsCard(correlations: summary.correlations)
            }
            .cardRow()
        }
        // Each substance has its own optional maximum; Todas has none.
        if let substance {
            Section {
                SubstanceGoalCard(maxDays: substance.maxDaysPerWeek, daysThisWeek: summary.daysThisWeek) { max in
                    await store.setGoal(max, for: substance.id)
                }
                .id(substance.id)
            }
            .cardRow()
        }
    }

    private func entries(_ overview: SubstanceOverview) -> some View {
        let mixed = overview.summary.substanceId == nil
        return Section {
            ForEach(overview.entries) { entry in
                let substance = store.substance(entry.substanceId)
                Button { open(entry) } label: { SubstanceEntryRow(entry: entry, substance: substance, showingName: mixed) }
                    .tint(.primary)
                    .swipeActions(edge: .trailing) {
                        Button("Eliminar", systemImage: "trash", role: .destructive) {
                            Task { await store.delete(entry) }
                        }
                    }
                    .swipeActions(edge: .leading) {
                        Button("Editar", systemImage: "pencil") { open(entry) }
                            .tint(SubstanceStyle.tint)
                    }
            }
        } header: {
            Text("Registros")
        } footer: {
            Text("Últimos 60 días. Desliza para editar o eliminar.")
        }
    }

    private func open(_ entry: SubstanceEntry) {
        guard let substance = store.substance(entry.substanceId) else { return }
        logging = .existing(entry, substance)
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
    let substance: Substance?
    /// Under Todas, entries of several substances mix: lead with the name.
    var showingName = false

    var body: some View {
        HStack(spacing: 12) {
            SubstanceGlyphView(symbol: showingName ? substance?.symbol : entry.form.flatMap(SubstanceText.formSymbol) ?? substance?.symbol)
                .font(.body.weight(.medium))
                .foregroundStyle(SubstanceStyle.tint)
                .frame(width: 36, height: 36)
                .background(SubstanceStyle.tint.opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.title(substanceName: substance?.name ?? "Sustancia", showingName: showingName)).font(.body.weight(.medium))
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
                    .lineLimit(1)
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
        if let mg = entry.thcMg { return "\(mg.formatted(.number.precision(.fractionLength(0...1)))) mg THC" }
        if let quantity = entry.quantity { return SubstanceText.quantity(quantity, unit: substance?.unit ?? "veces") }
        return nil
    }
}

#Preview("Sustancias") {
    NavigationStack { SubstancesView(closable: true) }
}
