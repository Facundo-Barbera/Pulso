import SwiftUI

/// Dieta · Hoy: the macro hero, water in one row, then the day's meals down a
/// timeline, folded to a line each, then the extras in their own compact card.
/// Without a plan, what was eaten is the timeline.
struct NutritionTodaySection: View {
    let day: NutritionDay
    let store: NutritionStore
    @Binding var sheet: NutritionView.Sheet?
    let showPlan: () -> Void
    let addWater: (Double) -> Void
    let undoWater: () -> Void
    let copyPrevious: () -> Void
    /// Opens the Coach with this text waiting in the composer.
    let draftForCoach: (String) -> Void
    var onAction: (SlotAction, PlanSlot) -> Void = { _, _ in }
    /// Ties entries to another meal of the day (a plan change with its undo).
    var onMove: ([MealEntry], PlanSlot) -> Void = { _, _ in }

    private var planDay: DietDay? { store.planDay.flatMap { $0.slots.isEmpty ? nil : $0 } }
    /// Entries not tied to one of today's slots: snacks and drinks between meals.
    private var extras: [MealEntry] {
        guard let planDay else { return day.meals }
        let ids = Set(planDay.slots.map(\.id))
        return day.meals.filter { $0.slotId.map { !ids.contains($0) } ?? true }
    }

    var body: some View {
        Card {
            MacroHero(summary: day.summary) { sheet = .targets }
                .padding(.vertical, 6)
            if planDay == nil, let next = store.nextMeal {
                Divider().padding(.top, 6)
                NextMealLine(meal: next, onOpenPlan: showPlan)
            }
        }
        if let water = day.water {
            WaterCard(
                water: water,
                onAdd: addWater,
                onUndo: undoWater,
                onCustom: { sheet = .waterAmount },
                onSettings: { sheet = .water },
                onShowEntries: { sheet = .waterEntries }
            )
        }
        if let planDay {
            TodayPlanCard(day: planDay, horizon: store.horizon, meals: day.meals, showPlan: showPlan, onAction: onAction, onMove: onMove) {
                delete($0)
            }
            if !extras.isEmpty {
                ExtrasCard(extras: extras, moveTargets: planDay.slots, onMove: onMove) { delete($0) }
            }
        } else if !extras.isEmpty {
            MealTimeline(meals: extras) { meal in
                Task { await store.delete(meal) }
            }
        } else {
            emptyDay
        }
    }

    private func delete(_ meals: [MealEntry]) {
        Task { await store.deleteMeals(meals.map(\.id)) }
    }

    /// Symbol, one line, one action: telling the Coach today, copying the day before on a past day.
    private var emptyDay: some View {
        Card {
            EmptyStateView(
                systemImage: "fork.knife.circle",
                title: store.isToday ? "Nada registrado hoy" : "Nada registrado este día",
                message: store.isToday ? "Toca Registrar o cuéntale al Coach qué comiste." : nil,
                tint: Theme.energy,
                actionTitle: store.isToday ? "Contarle al Coach" : "Copiar el día anterior"
            ) {
                if store.isToday {
                    draftForCoach("A las \(Date.now.formatted(date: .omitted, time: .shortened)) comí ")
                } else {
                    copyPrevious()
                }
            }
            .frame(maxWidth: .infinity)
            .symbolEffect(.bounce, value: store.dateKey)
        }
    }
}

/// The day's planned meals down a timeline, one line each until opened. The title
/// carries real against planned kcal and is the way to Plan.
private struct TodayPlanCard: View {
    let day: DietDay
    let horizon: DietHorizon?
    let meals: [MealEntry]
    let showPlan: () -> Void
    let onAction: (SlotAction, PlanSlot) -> Void
    let onMove: ([MealEntry], PlanSlot) -> Void
    let onDelete: ([MealEntry]) -> Void

    var body: some View {
        Card {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                CardTitle(text: "Comidas", systemImage: "fork.knife")
                Spacer(minLength: 4)
                Button(action: showPlan) {
                    HStack(spacing: 3) {
                        totals.monospacedDigit().contentTransition(.numericText())
                        Image(systemName: "chevron.right").font(.caption2.weight(.bold))
                    }
                    .font(.caption.weight(.semibold)).fontDesign(.rounded)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityHint("Abre el plan")
            }
            .lineLimit(1)
            .padding(.bottom, 4)
            VStack(spacing: 0) {
                ForEach(day.slots) { slot in
                    let entries = meals.filter { $0.slotId == slot.id }
                    PlanSlotRow(slot: slot, source: horizon?.source(of: slot), recipeId: horizon?.recipeId(of: slot),
                                entries: entries, isLast: slot.id == day.slots.last?.id,
                                moveTargets: day.slots.filter { $0.id != slot.id },
                                onAction: { onAction($0, slot) }, onDeleteEntry: { onDelete([$0]) },
                                onMove: { onMove(entries, $0) }, onDeleteAll: { onDelete(entries) })
                }
            }
        }
    }

    /// "1.525 de 1.925 kcal"; how many are left from an older Mac without totals.
    private var totals: Text {
        if let real = day.real, let planned = day.asPlanned {
            return Text("\(Int(real.kcal).formatted()) de \(Int(planned.kcal).formatted()) kcal")
        }
        return Text(day.pending == 0 ? "Resuelto" : "\(day.pending) \(day.pending == 1 ? "pendiente" : "pendientes")")
    }
}

/// What was eaten outside the plan's meals, compact: name, time and amount, kcal.
/// Long-press one to move it into a meal or change its amount; swipe to delete.
private struct ExtrasCard: View {
    let extras: [MealEntry]
    let moveTargets: [PlanSlot]
    let onMove: ([MealEntry], PlanSlot) -> Void
    let onDelete: ([MealEntry]) -> Void
    @Environment(\.dishActions) private var dishActions
    @State private var editing: MealEntry?

    private var items: [LoggedItem] { LoggedItem.group(extras.sorted { $0.eatenAt < $1.eatenAt }) }
    private var kcal: Double { extras.reduce(0) { $0 + $1.kcal } }

    var body: some View {
        Card {
            HStack(alignment: .firstTextBaseline) {
                CardTitle(text: "Extras", systemImage: "cup.and.saucer")
                Spacer(minLength: 4)
                Text("\(Int(kcal).formatted()) kcal")
                    .font(.caption.weight(.semibold).monospacedDigit()).fontDesign(.rounded)
                    .foregroundStyle(.secondary)
                    .contentTransition(.numericText(value: kcal))
            }
            .lineLimit(1)
            VStack(spacing: 0) {
                ForEach(items) { item in
                    switch item {
                    case .food(let meal):
                        SwipeToDelete(onDelete: { onDelete([meal]) }, actions: actions(for: meal)) { ExtraRow(meal: meal) }
                    case .dish(let dish, let parts):
                        DishRow(dish: dish, parts: parts) { onDelete([$0]) }
                    }
                    if item.id != items.last?.id { Divider() }
                }
            }
        }
        .sheet(item: $editing) { meal in
            ComponentAmountSheet(meal: meal) { factor in await dishActions.update(meal, factor) }
                .presentationDetents([.medium])
        }
    }

    private func actions(for meal: MealEntry) -> [RowAction] {
        [RowAction(title: "Cambiar la cantidad", systemImage: "slider.horizontal.3") { editing = meal }]
            + moveTargets.map { slot in
                RowAction(title: "Mover a \(slot.slot.title.lowercased())", systemImage: slot.slot.systemImage) { onMove([meal], slot) }
            }
    }
}

/// "Coca-Cola Zero / 17:30 · 355 ml" and its kcal.
private struct ExtraRow: View {
    let meal: MealEntry

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(meal.name).font(.subheadline).lineLimit(2)
                HStack(spacing: 4) {
                    Text(Date(timeIntervalSince1970: meal.eatenAt / 1000), format: .dateTime.hour().minute())
                    Text("·")
                    Text(foodAmountText(meal.quantity, meal.unit, measure: meal.measure))
                }
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
            Spacer(minLength: 8)
            Text("\(Int(meal.kcal).formatted()) kcal")
                .font(.subheadline.weight(.semibold).monospacedDigit()).fontDesign(.rounded)
                .contentTransition(.numericText(value: meal.kcal))
                .layoutPriority(1)
        }
        .padding(.vertical, 8)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }
}

/// "Siguiente: Desayuno · 428 kcal" under the hero, quiet; the foods only when they fit.
private struct NextMealLine: View {
    let meal: DietPlanForDay.Meal
    let onOpenPlan: () -> Void

    private var kcal: Int { Int(meal.items.reduce(0) { $0 + $1.kcal }) }
    private var foods: String { meal.items.map(\.name).joined(separator: ", ") }

    var body: some View {
        Button(action: onOpenPlan) {
            HStack(spacing: 12) {
                Image(systemName: meal.slot.systemImage)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.body)
                    .frame(width: 32, height: 32)
                    .background(Theme.body.opacity(0.14), in: .circle)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text("Siguiente: \(meal.slot.title)").font(.subheadline.weight(.semibold))
                        if meal.adjusted {
                            Image(systemName: "sparkles").font(.caption).foregroundStyle(Theme.training)
                                .accessibilityLabel("Ajustado por el Coach")
                        }
                    }
                    ViewThatFits(in: .horizontal) {
                        Text("\(kcal) kcal · \(foods)")
                        Text("\(kcal) kcal · \(meal.items.count) \(meal.items.count == 1 ? "alimento" : "alimentos")")
                        Text("\(kcal) kcal")
                    }
                    .font(.caption.monospacedDigit()).fontDesign(.rounded)
                    .foregroundStyle(.secondary)
                }
                .lineLimit(1)
                Spacer(minLength: 6)
                Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Abre el plan")
    }
}

/// The day's meals, slot by slot down a timeline. Each slot folds to one line
/// (time, what, kcal); open it for the foods, swipe one to delete it. Snacks
/// and drinks are their own dots, where they happened, however many a day.
struct MealTimeline: View {
    let meals: [MealEntry]
    var title = "Comidas"
    let onDelete: (MealEntry) -> Void

    /// One dot: a meal slot, or one snack — snack entries more than 45 min apart are separate groups.
    struct Moment: Identifiable, Equatable {
        var slot: MealSlot
        var meals: [MealEntry]
        var id: String { "\(slot.rawValue)-\(meals.first?.id ?? "")" }
        /// Only drinks (counted in ml), e.g. a coffee or a beer on its own.
        var isDrink: Bool { meals.allSatisfy { $0.unit == .ml } }
        var title: String { slot == .snack && isDrink ? "Bebida" : slot.title }
        var systemImage: String { isDrink ? "cup.and.saucer" : slot.systemImage }
    }

    /// In the order they were eaten, so a late snack sits where it happened.
    static func moments(_ meals: [MealEntry]) -> [Moment] {
        var groups: [Moment] = []
        for meal in meals.sorted(by: { $0.eatenAt < $1.eatenAt }) {
            if let i = groups.lastIndex(where: { $0.slot == meal.slot }),
               meal.slot != .snack || meal.eatenAt - (groups[i].meals.last?.eatenAt ?? 0) <= 45 * 60_000 {
                groups[i].meals.append(meal)
            } else {
                groups.append(Moment(slot: meal.slot, meals: [meal]))
            }
        }
        return groups
    }

    private var groups: [Moment] { Self.moments(meals) }
    private var caffeineMg: Double { meals.reduce(0) { $0 + ($1.caffeineMg ?? 0) } }
    private var alcoholG: Double { meals.reduce(0) { $0 + ($1.alcoholG ?? 0) } }

    var body: some View {
        Card {
            HStack(spacing: 8) {
                CardTitle(text: title, systemImage: "clock")
                Spacer(minLength: 4)
                if caffeineMg > 0 { StimulantBadge(text: "\(Int(caffeineMg)) mg cafeína", systemImage: "bolt.fill", tint: .brown) }
                if alcoholG > 0 {
                    StimulantBadge(text: "\(alcoholG.formatted(.number.precision(.fractionLength(0...1)))) g alcohol", systemImage: "wineglass.fill",
                                   tint: Theme.training)
                }
            }
            VStack(spacing: 0) {
                ForEach(groups) { group in
                    SlotRow(group: group, isLast: group.id == groups.last?.id, onDelete: onDelete)
                }
            }
        }
    }
}

/// A modest day total for caffeine or alcohol, next to the Comidas title.
private struct StimulantBadge: View {
    let text: String
    let systemImage: String
    let tint: Color

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.caption2.weight(.semibold).monospacedDigit()).fontDesign(.rounded)
            .foregroundStyle(tint)
            .lineLimit(1)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(tint.opacity(0.12), in: .capsule)
            .contentTransition(.numericText())
    }
}

private struct SlotRow: View {
    let group: MealTimeline.Moment
    let isLast: Bool
    let onDelete: (MealEntry) -> Void
    @State private var expanded = false

    private var slot: MealSlot { group.slot }
    private var meals: [MealEntry] { group.meals }
    private var time: Date { Date(timeIntervalSince1970: (meals.map(\.eatenAt).min() ?? 0) / 1000) }
    private var note: String? { meals.compactMap(\.note).first }
    private var kcal: Double { meals.reduce(0) { $0 + $1.kcal } }
    private var tint: Color { Theme.energy }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // The timeline: a dot per slot joined by a line.
            VStack(spacing: 0) {
                Image(systemName: group.systemImage)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(tint)
                    .frame(width: 32, height: 32)
                    .background(tint.opacity(0.15), in: .circle)
                if !isLast {
                    Rectangle().fill(.quaternary).frame(width: 2).frame(maxHeight: .infinity)
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                Button { withAnimation(.snappy) { expanded.toggle() } } label: { header }
                    .buttonStyle(.plain)
                if expanded {
                    if let note {
                        Label(note, systemImage: "sparkles")
                            .font(.caption).italic()
                            .foregroundStyle(.secondary)
                    }
                    LoggedList(meals: meals, onDelete: onDelete)
                }
            }
            .padding(.bottom, isLast ? 0 : 14)
        }
        .sensoryFeedback(.selection, trigger: expanded)
    }

    /// Title and time; what it was on the second line only when it fits whole.
    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(group.title).font(.headline)
                let clock = Text(time, format: .dateTime.hour().minute())
                Group {
                    if expanded {
                        clock
                    } else {
                        ViewThatFits(in: .horizontal) {
                            Text("\(clock) · \(note ?? LoggedItem.group(meals).map(\.name).joined(separator: ", "))")
                            clock
                        }
                    }
                }
                .font(.caption).foregroundStyle(.secondary)
                .lineLimit(1)
            }
            Spacer(minLength: 6)
            Text("\(Int(kcal)) kcal")
                .font(.subheadline.weight(.semibold).monospacedDigit()).fontDesign(.rounded)
                .contentTransition(.numericText(value: kcal))
                .layoutPriority(1)
            Image(systemName: "chevron.down")
                .font(.caption.weight(.bold)).foregroundStyle(.tertiary)
                .rotationEffect(.degrees(expanded ? 0 : -90))
        }
        .lineLimit(1)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint(expanded ? "Pliega" : "Muestra los alimentos")
    }
}

struct MealRow: View {
    let meal: MealEntry

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 5) {
                    Text(meal.name).font(.subheadline.weight(.medium)).lineLimit(2)
                    if let icon = sourceIcon {
                        Image(systemName: icon).font(.caption2).foregroundStyle(.tertiary)
                    }
                }
                HStack(spacing: 6) {
                    Text(foodAmountText(meal.quantity, meal.unit, measure: meal.measure))
                    Text("·")
                    Text(Date(timeIntervalSince1970: meal.eatenAt / 1000), format: .dateTime.hour().minute())
                    if let stimulants {
                        Text("·")
                        Text(stimulants)
                    }
                }
                .font(.caption).foregroundStyle(.secondary)
                .lineLimit(1)
            }
            Spacer(minLength: 8)
            // The numbers keep their width; a long food name wraps instead.
            VStack(alignment: .trailing, spacing: 3) {
                Text("\(Int(meal.kcal)) kcal").font(.subheadline.weight(.semibold).monospacedDigit()).fontDesign(.rounded)
                MacroLine(macros: meal.macros)
            }
            .lineLimit(1)
            .layoutPriority(1)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    /// "80 mg cafeína", "13 g alcohol", when the entry has them.
    private var stimulants: String? {
        var parts: [String] = []
        if let mg = meal.caffeineMg, mg > 0 { parts.append("\(Int(mg)) mg cafeína") }
        if let g = meal.alcoholG, g > 0 { parts.append("\(g.formatted(.number.precision(.fractionLength(0...1)))) g alcohol") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
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

/// One more thing a row's long-press offers, next to Eliminar.
struct RowAction: Identifiable {
    let title: String
    let systemImage: String
    let run: () -> Void
    var id: String { title }
}

/// Swipe left to reveal a delete button; long-press offers it too, after `actions`.
struct SwipeToDelete<Content: View>: View {
    let onDelete: () -> Void
    var actions: [RowAction] = []
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

            // Only covers the delete button while swiped: at rest the card shows through.
            content
                .background(.background.secondary.opacity(offset == 0 ? 0 : 1))
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
            ForEach(actions) { Button($0.title, systemImage: $0.systemImage, action: $0.run) }
            Button("Eliminar", systemImage: "trash", role: .destructive, action: onDelete)
        }
        .sensoryFeedback(.impact(weight: .light), trigger: offset == -reveal)
    }
}

// MARK: - Previews

private let previewMeals = [
    MealEntry(id: "1", date: "2026-10-01", eatenAt: 1_790_830_800_000, slot: .desayuno, name: "Avena con leche",
              quantity: 1, unit: .serving, kcal: 385, protein: 17, carbs: 58, fat: 9, fiber: 7, source: "plan"),
    MealEntry(id: "2", date: "2026-10-01", eatenAt: 1_790_848_800_000, slot: .comida, name: "Big Mac (McDonald's)",
              quantity: 1, unit: .serving, kcal: 590, protein: 25, carbs: 45, fat: 34, fiber: 3, source: "agent",
              note: "Big Mac y papas medianas"),
    MealEntry(id: "3", date: "2026-10-01", eatenAt: 1_790_848_800_000, slot: .comida, name: "Papas fritas medianas (McDonald's)",
              quantity: 111, unit: .g, kcal: 320, protein: 4, carbs: 43, fat: 15, fiber: 4, source: "agent",
              note: "Big Mac y papas medianas"),
    MealEntry(id: "4", date: "2026-10-01", eatenAt: 1_790_859_600_000, slot: .snack, name: "Café con leche",
              quantity: 240, unit: .ml, kcal: 90, protein: 5, carbs: 7, fat: 4, fiber: 0, source: "manual",
              measure: Measure(amount: 1, unit: .taza), caffeineMg: 80),
    MealEntry(id: "5", date: "2026-10-01", eatenAt: 1_790_877_600_000, slot: .snack, name: "Almendras",
              quantity: 30, unit: .g, kcal: 174, protein: 6, carbs: 7, fat: 15, fiber: 4, source: "agent",
              measure: Measure(amount: 1, unit: .puño)),
]

private let previewWater = WaterDay(date: "2026-10-01", totalMl: 250, goalMl: 3700, goalSource: "weight",
                                    entries: [WaterEntry(id: "w", date: "2026-10-01", loggedAt: 0, amountMl: 250, source: "manual")],
                                    settings: .standard)

@MainActor private func previewToday(_ day: NutritionDay) -> some View {
    NutritionTodaySection(day: day, store: NutritionStore(), sheet: .constant(nil), showPlan: {}, addWater: { _ in },
                          undoWater: {}, copyPrevious: {}, draftForCoach: { _ in })
}

#Preview("Hoy · con datos") {
    NarrowPreview {
        previewToday(NutritionDay(summary: previewNutritionSummary, meals: previewMeals, plan: nil, water: previewWater))
    }
}

// A day like a real one: breakfast and lunch changed, the snack as planned, dinner pending, two extras.

private func previewTime(_ hour: Int, _ minute: Int) -> Double {
    let base = NutritionDate.date("2026-10-01")!
    return (base.addingTimeInterval(Double(hour * 3600 + minute * 60)).timeIntervalSince1970 * 1000).rounded()
}

private func previewItem(_ id: String, _ name: String, _ quantity: Double, _ unit: FoodUnit, _ kcal: Double) -> DietPlanItem {
    DietPlanItem(id: id, name: name, quantity: quantity, unit: unit, kcal: kcal, protein: kcal * 0.07, carbs: kcal * 0.1, fat: kcal * 0.03, fiber: 2)
}

private func previewEntry(_ id: String, _ slotId: String?, _ slot: MealSlot, _ name: String, _ quantity: Double, _ unit: FoodUnit,
                          _ kcal: Double, _ p: Double, _ c: Double, _ f: Double, at time: Double, dish: DishRef? = nil,
                          measure: Measure? = nil) -> MealEntry {
    MealEntry(id: id, date: "2026-10-01", eatenAt: time, slot: slot, name: name, quantity: quantity, unit: unit, kcal: kcal,
              protein: p, carbs: c, fat: f, fiber: 1, source: "manual", slotId: slotId, measure: measure, dish: dish)
}

private let tortitas = DishRef(id: "d1", name: "Tortitas de carne con queso y arroz", savedDishId: nil)

private let previewDayMeals = [
    previewEntry("e1", "t1", .desayuno, "Vualá Big relleno de chocolate", 75, .g, 369, 5, 41, 21, at: previewTime(11, 11),
                 measure: Measure(amount: 1, unit: .unidad)),
    previewEntry("e2", nil, .snack, "Coca-Cola Zero", 355, .ml, 1, 0, 0, 0, at: previewTime(12, 30)),
    previewEntry("e3", "t2", .comida, "Tortitas de carne de res", 160, .g, 390, 32, 2, 28, at: previewTime(14, 41), dish: tortitas),
    previewEntry("e4", "t2", .comida, "Queso amarillo", 40, .g, 150, 9, 1, 12, at: previewTime(14, 41), dish: tortitas),
    previewEntry("e5", "t2", .comida, "Arroz blanco", 180, .g, 230, 4, 50, 1, at: previewTime(14, 41), dish: tortitas),
    previewEntry("e6", "t3", .merienda, "Proteína whey", 30, .g, 120, 24, 3, 2, at: previewTime(17, 6)),
    previewEntry("e7", "t3", .merienda, "Fresas", 150, .g, 48, 1, 11, 0, at: previewTime(17, 6)),
    previewEntry("e8", "t3", .merienda, "Leche descremada", 250, .ml, 179, 17, 25, 1, at: previewTime(17, 6)),
    previewEntry("e9", nil, .snack, "Coca-Cola Zero", 355, .ml, 1, 0, 0, 0, at: previewTime(18, 40)),
]

private func previewReal(_ ids: [String], label: String, asPlanned: Bool) -> RealMeal {
    let parts = previewDayMeals.filter { ids.contains($0.id) }
    return RealMeal(label: label, entryIds: ids,
                    macros: NutritionMacros(kcal: parts.reduce(0) { $0 + $1.kcal }, protein: parts.reduce(0) { $0 + $1.protein },
                                            carbs: parts.reduce(0) { $0 + $1.carbs }, fat: parts.reduce(0) { $0 + $1.fat }, fiber: 3),
                    eatenAt: parts.first?.eatenAt ?? 0, asPlanned: asPlanned)
}

private let previewDaySlots = [
    PlanSlot(id: "t1", date: "2026-10-01", slot: .desayuno, kind: .items, name: "Sándwich de huevo y pavo", items: [
        previewItem("a", "Pan integral", 60, .g, 150), previewItem("b", "Huevos enteros", 100, .g, 143),
        previewItem("c", "Jamón de pavo", 60, .g, 66), previewItem("d", "Queso panela", 30, .g, 75),
    ], macros: NutritionMacros(kcal: 434, protein: 33, carbs: 26, fat: 20, fiber: 4), status: .replaced, entryIds: ["e1"],
             real: previewReal(["e1"], label: "Vualá Big relleno de chocolate", asPlanned: false)),
    PlanSlot(id: "t2", date: "2026-10-01", slot: .comida, kind: .recipe, name: "Pasta boloñesa", recipeId: "r1", items: [
        previewItem("e", "Pasta boloñesa", 1, .serving, 640),
    ], macros: NutritionMacros(kcal: 640, protein: 38, carbs: 78, fat: 18, fiber: 6), status: .replaced, entryIds: ["e3", "e4", "e5"],
             cookMinutes: 30, real: previewReal(["e3", "e4", "e5"], label: tortitas.name, asPlanned: false)),
    PlanSlot(id: "t3", date: "2026-10-01", slot: .merienda, kind: .items, name: "Batido de proteína con fresas", items: [
        previewItem("f", "Proteína whey", 30, .g, 120), previewItem("g", "Fresas", 150, .g, 48), previewItem("h", "Leche descremada", 250, .ml, 179),
    ], macros: NutritionMacros(kcal: 347, protein: 42, carbs: 39, fat: 3, fiber: 3), status: .eaten, entryIds: ["e6", "e7", "e8"],
             real: previewReal(["e6", "e7", "e8"], label: "Batido de proteína con fresas", asPlanned: true)),
    PlanSlot(id: "t4", date: "2026-10-01", slot: .cena, kind: .items, name: "Quesadillas de pollo", items: [
        previewItem("i", "Tortillas de maíz", 3, .serving, 180), previewItem("j", "Pechuga de pollo", 120, .g, 198),
        previewItem("k", "Queso Oaxaca", 40, .g, 155),
    ], macros: NutritionMacros(kcal: 533, protein: 44, carbs: 40, fat: 20, fiber: 5), status: .planned, entryIds: []),
]

private let previewPlanDay = DietDay(date: "2026-10-01", label: "Día A", slots: previewDaySlots,
                                     planned: NutritionMacros(kcal: 1_954, protein: 157, carbs: 183, fat: 61, fiber: 18),
                                     shiftKcal: 0, goalKcal: 2_000,
                                     asPlanned: NutritionMacros(kcal: 1_925, protein: 150, carbs: 180, fat: 60, fiber: 18),
                                     real: NutritionMacros(kcal: 1_525, protein: 92, carbs: 133, fat: 65, fiber: 10),
                                     extraIds: ["e2", "e9"])

/// Hoy with a plan as the screen lays it out: hero with water, the meals, the extras.
private struct PreviewPlanDay: View {
    var body: some View {
        let summary = NutritionSummary(date: "2026-10-01", totals: previewPlanDay.real!, targets: previewNutritionSummary.targets,
                                       remaining: nil, bySlot: [:], entries: previewDayMeals.count)
        Card { MacroHero(summary: summary) {}.padding(.vertical, 6) }
        WaterCard(water: previewWater, onAdd: { _ in }, onUndo: {}, onCustom: {}, onSettings: {}, onShowEntries: {})
        TodayPlanCard(day: previewPlanDay, horizon: nil, meals: previewDayMeals, showPlan: {}, onAction: { _, _ in },
                      onMove: { _, _ in }) { _ in }
        ExtrasCard(extras: previewDayMeals.filter { $0.slotId == nil }, moveTargets: previewDaySlots, onMove: { _, _ in }) { _ in }
    }
}

#Preview("Hoy · plan") {
    NarrowPreview { PreviewPlanDay() }
}

#Preview("Hoy · plan · 375 pt · XXL") {
    NarrowPreview(dynamicType: .xxLarge) { PreviewPlanDay() }
}

#Preview("Hoy · plan · 440 pt · claro") {
    ScrollView {
        VStack(spacing: 16) { PreviewPlanDay() }.padding()
    }
    .frame(width: 440)
    .background(Color(.systemGroupedBackground))
    .preferredColorScheme(.light)
}

#Preview("Hoy · vacío · 375 pt · XXL") {
    let empty = NutritionSummary(date: "2026-10-01", totals: .zero, targets: previewNutritionSummary.targets,
                                 remaining: nil, bySlot: [:], entries: 0)
    NarrowPreview(dynamicType: .xxLarge) {
        previewToday(NutritionDay(summary: empty, meals: [], plan: nil, water: previewWater))
    }
}

#Preview("Siguiente · 375 pt · XXL") {
    NarrowPreview(dynamicType: .xxLarge) {
        Card {
            NextMealLine(meal: DietPlanForDay.Meal(slot: .desayuno, name: nil, items: [
                DietPlanItem(id: "p", name: "Pan integral", quantity: 60, unit: .g, kcal: 150, protein: 6, carbs: 28, fat: 2, fiber: 4),
                DietPlanItem(id: "h", name: "Huevos enteros", quantity: 2, unit: .serving, kcal: 156, protein: 13, carbs: 1, fat: 11, fiber: 0),
            ], change: "scaled")) {}
        }
        MealTimeline(meals: previewMeals) { _ in }
    }
}
