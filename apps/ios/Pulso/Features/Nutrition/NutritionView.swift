import SwiftUI

/// The Dieta tab: the macro hero, the active plan with "comido" taps, the
/// day's meals by slot (swipe or long-press to delete), and 7-day adherence.
/// Adding food lives in a floating glass bar.
struct NutritionView: View {
    let model: PulsoModel
    @State private var store = NutritionStore()
    @State private var sheet: Sheet?
    @State private var toast: String?
    @Environment(\.askCoach) private var askCoach

    enum Sheet: String, Identifiable {
        case quickAdd, scan, targets
        var id: String { rawValue }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if let day = store.day {
                    content(day)
                } else if store.loading {
                    ProgressView().controlSize(.large).padding(.top, 120)
                } else {
                    ContentUnavailableView {
                        Label("Sin conexión con la Mac", systemImage: "fork.knife.circle")
                    } description: {
                        Text("No se pudo cargar tu dieta.")
                    } actions: {
                        Button("Reintentar") { Task { await store.load() } }.buttonStyle(.glassProminent)
                    }
                    .padding(.top, 60)
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 90)
            .animation(.snappy, value: store.day)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Dieta")
        .navigationSubtitle(subtitle)
        .toolbar { toolbar }
        .refreshable { await store.load() }
        .task { await store.load() }
        .safeAreaInset(edge: .bottom) { addBar }
        .sheet(item: $sheet, onDismiss: { Task { await store.load() } }) { sheet in
            switch sheet {
            case .quickAdd: QuickAddView(store: store).presentationDetents([.medium, .large])
            case .scan: BarcodeScanView(store: store).presentationDetents([.large])
            case .targets: TargetsView(store: store).presentationDetents([.medium, .large])
            }
        }
        .overlay(alignment: .top) {
            if let toast {
                Text(toast)
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 18).padding(.vertical, 10)
                    .glassEffect()
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .sensoryFeedback(.success, trigger: store.day?.meals.count ?? 0) { old, new in new > old }
    }

    @ViewBuilder
    private func content(_ day: NutritionDay) -> some View {
        Card {
            MacroHero(summary: day.summary) { sheet = .targets }
                .padding(.vertical, 6)
        }
        if let plan = day.plan {
            PlanCard(plan: plan, store: store)
        }
        if day.meals.isEmpty {
            emptyDay
        } else {
            ForEach(MealSlot.allCases) { slot in
                let meals = store.meals(in: slot)
                if !meals.isEmpty {
                    SlotCard(slot: slot, meals: meals, totals: day.summary.bySlot[slot.rawValue]) { meal in
                        Task { await store.delete(meal) }
                    }
                }
            }
        }
        if store.week.contains(where: { $0.entries > 0 }) {
            Card { AdherenceChart(days: store.week) }
        }
    }

    private var subtitle: String {
        if store.isToday { return "Hoy" }
        return store.date.formatted(.dateTime.weekday(.wide).day().month(.wide))
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarLeading) {
            Button("Día anterior", systemImage: "chevron.left") { Task { await store.shift(days: -1) } }
            Button("Día siguiente", systemImage: "chevron.right") { Task { await store.shift(days: 1) } }
                .disabled(store.isToday)
        }
        ToolbarItem(placement: .topBarTrailing) {
            Menu("Más", systemImage: "ellipsis") {
                Button("Copiar el día anterior", systemImage: "doc.on.doc") { Task { await copyPrevious() } }
                Button("Objetivos diarios", systemImage: "target") { sheet = .targets }
            }
        }
    }

    /// The glass quick-add bar floating over the content.
    private var addBar: some View {
        GlassEffectContainer(spacing: 12) {
            HStack(spacing: 12) {
                Button { sheet = .scan } label: {
                    Label("Escanear", systemImage: "barcode.viewfinder")
                        .padding(.horizontal, 6).padding(.vertical, 4)
                }
                .buttonStyle(.glass)
                Button { sheet = .quickAdd } label: {
                    Label("Añadir comida", systemImage: "plus")
                        .fontWeight(.semibold)
                        .padding(.horizontal, 6).padding(.vertical, 4)
                }
                .buttonStyle(.glassProminent)
            }
        }
        .controlSize(.large)
        .padding(.bottom, 8)
    }

    private var emptyDay: some View {
        Card {
            VStack(spacing: 12) {
                Image(systemName: "fork.knife.circle.fill")
                    .font(.system(size: 52))
                    .foregroundStyle(Theme.energy.gradient)
                    .symbolEffect(.bounce, value: store.dateKey)
                Text(store.isToday ? "Aún no registraste nada hoy" : "Nada registrado este día")
                    .font(.headline)
                HStack {
                    Button("Copiar el día anterior", systemImage: "doc.on.doc") { Task { await copyPrevious() } }
                        .buttonStyle(.glass)
                    if store.day?.plan == nil {
                        Button("Plan con el Coach", systemImage: "sparkles") {
                            askCoach("Arma mi plan de comidas según mis objetivos y preferencias")
                        }
                        .buttonStyle(.glassProminent)
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
        }
    }

    private func copyPrevious() async {
        let copied = await store.copyPreviousDay()
        show(copied == 0 ? "El día anterior está vacío" : "\(copied) alimentos copiados")
    }

    private func show(_ message: String) {
        withAnimation(.snappy) { toast = message }
        Task {
            try? await Task.sleep(for: .seconds(2))
            withAnimation(.snappy) { if toast == message { toast = nil } }
        }
    }
}

/// One meal slot's entries.
private struct SlotCard: View {
    let slot: MealSlot
    let meals: [MealEntry]
    let totals: NutritionMacros?
    let onDelete: (MealEntry) -> Void

    var body: some View {
        Card {
            HStack {
                CardTitle(text: slot.title, systemImage: slot.systemImage)
                Spacer()
                if let totals {
                    Text("\(Int(totals.kcal)) kcal")
                        .font(.caption.weight(.semibold).monospacedDigit()).fontDesign(.rounded)
                        .foregroundStyle(.secondary)
                        .contentTransition(.numericText(value: totals.kcal))
                }
            }
            ForEach(meals) { meal in
                SwipeToDelete { onDelete(meal) } content: {
                    MealRow(meal: meal)
                }
                if meal.id != meals.last?.id { Divider() }
            }
        }
    }
}

private struct MealRow: View {
    let meal: MealEntry

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 5) {
                    Text(meal.name).font(.body.weight(.medium)).lineLimit(1)
                    if let icon = sourceIcon {
                        Image(systemName: icon).font(.caption2).foregroundStyle(.tertiary)
                    }
                }
                HStack(spacing: 6) {
                    Text(foodQuantityText(meal.quantity, meal.unit))
                    Text("·")
                    Text(Date(timeIntervalSince1970: meal.eatenAt / 1000), format: .dateTime.hour().minute())
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text("\(Int(meal.kcal)) kcal").font(.subheadline.weight(.semibold).monospacedDigit()).fontDesign(.rounded)
                MacroLine(macros: meal.macros)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
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

/// Swipe left to reveal a delete button; long-press offers it too.
private struct SwipeToDelete<Content: View>: View {
    let onDelete: () -> Void
    @ViewBuilder var content: Content
    @State private var offset: CGFloat = 0
    private let reveal: CGFloat = 76

    var body: some View {
        ZStack(alignment: .trailing) {
            Button(role: .destructive) {
                withAnimation(.snappy) { offset = 0 }
                onDelete()
            } label: {
                Image(systemName: "trash.fill").font(.body.weight(.semibold)).frame(width: 52, height: 40)
            }
            .buttonStyle(.glassProminent)
            .tint(.red)
            .opacity(offset < -8 ? 1 : 0)

            content
                .background(Color(.secondarySystemGroupedBackground))
                .offset(x: offset)
                .gesture(
                    DragGesture(minimumDistance: 20)
                        .onChanged { value in
                            guard abs(value.translation.width) > abs(value.translation.height) else { return }
                            offset = min(0, max(-reveal - 30, value.translation.width + (offset < 0 ? -reveal : 0)))
                        }
                        .onEnded { value in
                            withAnimation(.snappy) { offset = value.translation.width < -reveal / 2 ? -reveal : 0 }
                        }
                )
        }
        .contextMenu {
            Button("Eliminar", systemImage: "trash", role: .destructive, action: onDelete)
        }
        .sensoryFeedback(.impact(weight: .light), trigger: offset == -reveal)
    }
}

/// The active plan's day: meals with their items, each with a "comido" tap.
private struct PlanCard: View {
    let plan: DietPlanForDay
    let store: NutritionStore
    @State private var expanded = true

    private var items: [DietPlanItem] { plan.day.meals.flatMap(\.items) }
    private var eatenCount: Int { items.filter { store.isEaten($0) }.count }
    private var done: Bool { !items.isEmpty && eatenCount == items.count }

    var body: some View {
        Card {
            Button { withAnimation(.snappy) { expanded.toggle() } } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        CardTitle(text: "Plan · \(plan.day.label)", systemImage: "list.bullet.clipboard")
                        Text(plan.plan.name).font(.headline).foregroundStyle(.primary)
                    }
                    Spacer()
                    Gauge(value: Double(eatenCount), in: 0...Double(max(items.count, 1))) {
                        EmptyView()
                    } currentValueLabel: {
                        Text("\(eatenCount)/\(items.count)").fontDesign(.rounded)
                    }
                    .gaugeStyle(.accessoryCircularCapacity)
                    .tint(Theme.body)
                    .scaleEffect(0.8)
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.bold)).foregroundStyle(.secondary)
                        .rotationEffect(.degrees(expanded ? 0 : -90))
                }
            }
            .buttonStyle(.plain)

            if expanded {
                if let notes = plan.plan.notes, !notes.isEmpty {
                    Text(notes).font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(Array(plan.day.meals.enumerated()), id: \.offset) { _, meal in
                    VStack(alignment: .leading, spacing: 8) {
                        Label(meal.name ?? meal.slot.title, systemImage: meal.slot.systemImage)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.secondary)
                        ForEach(meal.items) { item in
                            PlanItemRow(item: item, eaten: store.isEaten(item)) {
                                Task { await store.eat(item) }
                            }
                        }
                    }
                    .padding(.top, 4)
                }
            }
        }
        .sensoryFeedback(.success, trigger: done) { _, new in new }
    }
}

private struct PlanItemRow: View {
    let item: DietPlanItem
    let eaten: Bool
    let onEat: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.name).strikethrough(eaten, color: .secondary).foregroundStyle(eaten ? .secondary : .primary)
                HStack(spacing: 6) {
                    Text("\(foodQuantityText(item.quantity, item.unit)) · \(Int(item.kcal)) kcal")
                    MacroLine(macros: item.macros)
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button(action: onEat) {
                Image(systemName: eaten ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(eaten ? Theme.body : .secondary)
                    .contentTransition(.symbolEffect(.replace))
                    .symbolEffect(.bounce, value: eaten)
            }
            .buttonStyle(.plain)
            .disabled(eaten)
            .accessibilityLabel(eaten ? "Comido" : "Marcar como comido")
        }
    }
}
