import SwiftUI

/// The Dieta tab: rings, the active plan with "comido" taps, the day's meals
/// by slot (swipe to delete), and 7-day adherence.
struct NutritionView: View {
    let model: PulsoModel
    @State private var store = NutritionStore()
    @State private var sheet: Sheet?
    @State private var toast: String?

    enum Sheet: String, Identifiable {
        case quickAdd, scan, targets
        var id: String { rawValue }
    }

    var body: some View {
        List {
            if let day = store.day {
                Section {
                    MacroRingsCard(summary: day.summary) { sheet = .targets }
                }
                if let plan = day.plan {
                    PlanSection(plan: plan, store: store)
                }
                ForEach(MealSlot.allCases) { slot in
                    let meals = store.meals(in: slot)
                    if !meals.isEmpty {
                        Section {
                            ForEach(meals) { MealRow(meal: $0) }
                                .onDelete { offsets in
                                    let doomed = offsets.map { meals[$0] }
                                    Task { for meal in doomed { await store.delete(meal) } }
                                }
                        } header: {
                            slotHeader(slot, day.summary.bySlot[slot.rawValue])
                        }
                    }
                }
                if day.meals.isEmpty {
                    Section {
                        emptyDay
                    }
                }
                if !store.week.isEmpty {
                    Section {
                        AdherenceChart(days: store.week)
                    }
                }
            } else if store.loading {
                ProgressView().frame(maxWidth: .infinity)
            } else {
                ContentUnavailableView("Sin datos", systemImage: "fork.knife", description: Text("No se pudo cargar la dieta."))
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(title)
        .toolbar { toolbar }
        .refreshable { await store.load() }
        .task { await store.load() }
        .sheet(item: $sheet, onDismiss: { Task { await store.load() } }) { sheet in
            switch sheet {
            case .quickAdd: QuickAddView(store: store)
            case .scan: BarcodeScanView(store: store)
            case .targets: TargetsView(store: store)
            }
        }
        .overlay(alignment: .bottom) {
            if let toast {
                Text(toast)
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(.thinMaterial, in: Capsule())
                    .padding(.bottom, 12)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .sensoryFeedback(.success, trigger: store.day?.meals.count ?? 0) { old, new in new > old }
    }

    private var title: String {
        if store.isToday { return "Dieta" }
        return store.date.formatted(.dateTime.weekday(.wide).day().month())
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarLeading) {
            Button("Día anterior", systemImage: "chevron.left") { Task { await store.shift(days: -1) } }
            if !store.isToday {
                Button("Día siguiente", systemImage: "chevron.right") { Task { await store.shift(days: 1) } }
            }
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            Menu("Más", systemImage: "ellipsis.circle") {
                Button("Copiar el día anterior", systemImage: "doc.on.doc") { Task { await copyPrevious() } }
                Button("Objetivos diarios", systemImage: "target") { sheet = .targets }
            }
            Button("Escanear", systemImage: "barcode.viewfinder") { sheet = .scan }
            Button("Añadir", systemImage: "plus") { sheet = .quickAdd }
        }
    }

    private func slotHeader(_ slot: MealSlot, _ totals: NutritionMacros?) -> some View {
        HStack {
            CardTitle(text: slot.title, systemImage: slot.systemImage)
            Spacer()
            if let totals {
                Text("\(Int(totals.kcal)) kcal").font(.caption.weight(.semibold).monospacedDigit()).foregroundStyle(.secondary)
            }
        }
    }

    private var emptyDay: some View {
        VStack(spacing: 10) {
            Image(systemName: "fork.knife.circle").font(.largeTitle).foregroundStyle(.tertiary)
            Text("Nada registrado").font(.headline)
            HStack {
                Button("Añadir", systemImage: "plus") { sheet = .quickAdd }
                Button("Escanear", systemImage: "barcode.viewfinder") { sheet = .scan }
                Button("Copiar ayer", systemImage: "doc.on.doc") { Task { await copyPrevious() } }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    private func copyPrevious() async {
        let copied = await store.copyPreviousDay()
        show(copied == 0 ? "El día anterior está vacío" : "\(copied) alimentos copiados")
    }

    private func show(_ message: String) {
        withAnimation { toast = message }
        Task {
            try? await Task.sleep(for: .seconds(2))
            withAnimation { if toast == message { toast = nil } }
        }
    }
}

private struct MealRow: View {
    let meal: MealEntry

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    Text(meal.name).font(.body.weight(.medium))
                    if let icon = sourceIcon {
                        Image(systemName: icon).font(.caption2).foregroundStyle(.tertiary)
                    }
                }
                HStack(spacing: 6) {
                    Text(foodQuantityText(meal.quantity, meal.unit))
                    Text(Date(timeIntervalSince1970: meal.eatenAt / 1000), format: .dateTime.hour().minute())
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text("\(Int(meal.kcal)) kcal").font(.subheadline.weight(.semibold).monospacedDigit())
                MacroLine(macros: meal.macros)
            }
        }
    }

    private var sourceIcon: String? {
        switch meal.source {
        case "barcode": "barcode"
        case "plan": "list.bullet.clipboard"
        case "agent": "sparkles"
        default: nil
        }
    }
}

/// The active plan's day: meals with their items, each with a "comido" tap.
private struct PlanSection: View {
    let plan: DietPlanForDay
    let store: NutritionStore
    @State private var expanded = true

    private var items: [DietPlanItem] { plan.day.meals.flatMap(\.items) }
    private var eatenCount: Int { items.filter { store.isEaten($0) }.count }

    var body: some View {
        Section(isExpanded: $expanded) {
            if let notes = plan.plan.notes, !notes.isEmpty {
                Text(notes).font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(Array(plan.day.meals.enumerated()), id: \.offset) { _, meal in
                VStack(alignment: .leading, spacing: 8) {
                    Label(meal.name ?? meal.slot.title, systemImage: meal.slot.systemImage)
                        .font(.subheadline.weight(.semibold))
                    ForEach(meal.items) { item in
                        PlanItemRow(item: item, eaten: store.isEaten(item)) {
                            Task { await store.eat(item) }
                        }
                    }
                }
                .padding(.vertical, 2)
            }
        } header: {
            HStack {
                CardTitle(text: plan.plan.name, systemImage: "list.bullet.clipboard")
                Spacer()
                Text("\(plan.day.label) · \(eatenCount)/\(items.count)")
                    .font(.caption.weight(.semibold)).foregroundStyle(eatenCount == items.count ? Theme.body : .secondary)
            }
        }
    }
}

private struct PlanItemRow: View {
    let item: DietPlanItem
    let eaten: Bool
    let onEat: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.name).strikethrough(eaten, color: .secondary).foregroundStyle(eaten ? .secondary : .primary)
                HStack(spacing: 6) {
                    Text("\(foodQuantityText(item.quantity, item.unit)) · \(Int(item.kcal)) kcal")
                    MacroLine(macros: item.macros)
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if eaten {
                Image(systemName: "checkmark.circle.fill").font(.title3).foregroundStyle(Theme.body)
            } else {
                Button("Comido", action: onEat)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .tint(Theme.body)
            }
        }
    }
}
