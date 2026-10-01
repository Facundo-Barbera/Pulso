import SwiftUI

/// Dieta · Hoy: the macro hero, water in one row, then today's planned meals
/// as calm rows with their status (eaten, swapped, skipped) and quick changes,
/// and whatever was eaten besides the plan as a timeline.
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

    private var planDay: DietDay? { store.planDay.flatMap { $0.slots.isEmpty ? nil : $0 } }
    /// Entries not tied to one of today's slots: snacks, extras, anything logged off the plan.
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
            TodayPlanCard(day: planDay, horizon: store.horizon, meals: day.meals, showPlan: showPlan, onAction: onAction) { meal in
                Task { await store.delete(meal) }
            }
        }
        if !extras.isEmpty {
            MealTimeline(meals: extras, title: planDay == nil ? "Comidas" : "Además del plan") { meal in
                Task { await store.delete(meal) }
            }
        } else if planDay == nil {
            emptyDay
        }
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

/// Today's planned meals, one calm row each, with what was logged against them.
private struct TodayPlanCard: View {
    let day: DietDay
    let horizon: DietHorizon?
    let meals: [MealEntry]
    let showPlan: () -> Void
    let onAction: (SlotAction, PlanSlot) -> Void
    let onDelete: (MealEntry) -> Void

    var body: some View {
        Card {
            Button(action: showPlan) {
                HStack {
                    CardTitle(text: "Tu plan de hoy", systemImage: "list.bullet.clipboard")
                    Spacer(minLength: 4)
                    Text(day.pending == 0 ? "Resuelto" : "\(day.pending) \(day.pending == 1 ? "pendiente" : "pendientes")")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(day.pending == 0 ? Theme.body : .secondary)
                        .contentTransition(.numericText())
                    Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(.tertiary)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Abre el plan")
            VStack(spacing: 0) {
                ForEach(day.slots) { slot in
                    PlanSlotRow(slot: slot, source: horizon?.source(of: slot), recipeId: horizon?.recipeId(of: slot),
                                entries: meals.filter { $0.slotId == slot.id }, isLast: slot.id == day.slots.last?.id,
                                onAction: { onAction($0, slot) }, onDeleteEntry: onDelete)
                }
            }
        }
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
    private var offPlan: Bool { meals.contains { $0.offPlan == true } }
    private var time: Date { Date(timeIntervalSince1970: (meals.map(\.eatenAt).min() ?? 0) / 1000) }
    private var note: String? { meals.compactMap(\.note).first }
    private var kcal: Double { meals.reduce(0) { $0 + $1.kcal } }
    private var tint: Color { offPlan ? Theme.carbs : Theme.energy }

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
                    ForEach(meals) { meal in
                        SwipeToDelete { onDelete(meal) } content: { MealRow(meal: meal) }
                        if meal.id != meals.last?.id { Divider() }
                    }
                }
            }
            .padding(.bottom, isLast ? 0 : 14)
        }
        .sensoryFeedback(.selection, trigger: expanded)
    }

    /// Title, a dot when off the plan, the time; what it was on the second line only when it fits whole.
    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(group.title).font(.headline)
                    if offPlan {
                        Circle().fill(Theme.carbs).frame(width: 7, height: 7)
                            .accessibilityLabel("Fuera del plan")
                    }
                }
                let clock = Text(time, format: .dateTime.hour().minute())
                Group {
                    if expanded {
                        clock
                    } else {
                        ViewThatFits(in: .horizontal) {
                            Text("\(clock) · \(note ?? meals.map(\.name).joined(separator: ", "))")
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

/// Swipe left to reveal a delete button; long-press offers it too.
struct SwipeToDelete<Content: View>: View {
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

// MARK: - Previews

private let previewMeals = [
    MealEntry(id: "1", date: "2026-10-01", eatenAt: 1_790_830_800_000, slot: .desayuno, name: "Avena con leche",
              quantity: 1, unit: .serving, kcal: 385, protein: 17, carbs: 58, fat: 9, fiber: 7, source: "plan"),
    MealEntry(id: "2", date: "2026-10-01", eatenAt: 1_790_848_800_000, slot: .comida, name: "Big Mac (McDonald's)",
              quantity: 1, unit: .serving, kcal: 590, protein: 25, carbs: 45, fat: 34, fiber: 3, source: "agent",
              offPlan: true, note: "Big Mac y papas medianas"),
    MealEntry(id: "3", date: "2026-10-01", eatenAt: 1_790_848_800_000, slot: .comida, name: "Papas fritas medianas (McDonald's)",
              quantity: 111, unit: .g, kcal: 320, protein: 4, carbs: 43, fat: 15, fiber: 4, source: "agent",
              offPlan: true, note: "Big Mac y papas medianas"),
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

#Preview("Hoy · plan · 375 pt · XXL") {
    NarrowPreview(dynamicType: .xxLarge) {
        Card { MacroHero(summary: previewNutritionSummary) {} }
        TodayPlanCard(day: previewHorizon.days[0], horizon: previewHorizon, meals: [], showPlan: {}, onAction: { _, _ in }) { _ in }
        MealTimeline(meals: Array(previewMeals.suffix(2)), title: "Además del plan") { _ in }
    }
}

#Preview("Hoy · plan · claro") {
    NarrowPreview {
        TodayPlanCard(day: previewHorizon.days[0], horizon: previewHorizon, meals: [], showPlan: {}, onAction: { _, _ in }) { _ in }
    }
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
