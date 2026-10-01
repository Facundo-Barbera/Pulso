import SwiftUI

/// Dieta · Hoy: the macro hero, what's left with the next planned meal,
/// water, and the day's meals as a timeline of collapsible slots.
struct NutritionTodaySection: View {
    let day: NutritionDay
    let store: NutritionStore
    @Binding var sheet: NutritionView.Sheet?
    let showPlan: () -> Void
    let copyPrevious: () -> Void
    /// Opens the Coach with this text waiting in the composer.
    let draftForCoach: (String) -> Void

    var body: some View {
        Card {
            MacroHero(summary: day.summary) { sheet = .targets }
                .padding(.vertical, 6)
        }
        if let remaining = day.summary.remaining {
            RemainingCard(remaining: remaining, next: nextMeal, adjusted: day.plan?.adjustment != nil, onOpenPlan: showPlan)
        }
        if let water = day.water {
            WaterCard(
                water: water,
                onAdd: { ml in Task { await store.addWater(ml: ml) } },
                onUndo: { Task { await store.undoWater() } },
                onCustom: { sheet = .waterAmount },
                onSettings: { sheet = .water }
            )
        }
        if day.meals.isEmpty {
            emptyDay
        } else {
            MealTimeline(meals: day.meals) { meal in
                Task { await store.delete(meal) }
            }
        }
    }

    /// The first planned meal with nothing logged in its slot yet.
    private var nextMeal: DietPlanForDay.Meal? {
        guard let plan = day.plan else { return nil }
        let logged = Set(day.meals.map(\.slot))
        return plan.meals.first { meal in !logged.contains(meal.slot) && !meal.items.allSatisfy { store.isEaten($0) } }
    }

    private var emptyDay: some View {
        Card {
            VStack(spacing: 12) {
                Image(systemName: "fork.knife.circle.fill")
                    .font(.system(size: 52))
                    .foregroundStyle(Theme.energy.gradient)
                    .symbolEffect(.bounce, value: store.dateKey)
                Text(store.isToday ? "Cuéntale al Coach qué comiste" : "Nada registrado este día")
                    .font(.headline)
                    .multilineTextAlignment(.center)
                // Side by side these need ~410 pt; a 375 pt card has ~310, so they stack.
                AdaptiveStack {
                    Button("Copiar el día anterior", systemImage: "doc.on.doc", action: copyPrevious)
                        .buttonStyle(.glass)
                    if store.isToday {
                        Button("Contarle al Coach", systemImage: "sparkles") { draftForCoach("A las \(Date.now.formatted(date: .omitted, time: .shortened)) comí ") }
                            .buttonStyle(.glassProminent)
                    }
                }
                .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
        }
    }
}

/// "Te quedan": the day's remaining macros, and the next meal of the plan.
private struct RemainingCard: View {
    let remaining: NutritionMacros
    let next: DietPlanForDay.Meal?
    let adjusted: Bool
    let onOpenPlan: () -> Void

    var body: some View {
        Card {
            CardTitle(text: remaining.kcal >= 0 ? "Te quedan" : "Te pasaste", systemImage: "chart.pie")
            HStack(spacing: 8) {
                tile("kcal", remaining.kcal, Theme.energy)
                tile("Prot.", remaining.protein, Theme.protein)
                tile("Carbos", remaining.carbs, Theme.carbs)
                tile("Grasa", remaining.fat, Theme.fat)
            }
            if let next {
                Divider().padding(.vertical, 2)
                Button(action: onOpenPlan) {
                    HStack(spacing: 12) {
                        Image(systemName: next.slot.systemImage)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.body)
                            .frame(width: 34, height: 34)
                            .background(Theme.body.opacity(0.14), in: .circle)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Text("Siguiente: \(next.slot.title)").font(.subheadline.weight(.semibold))
                                if next.adjusted {
                                    Image(systemName: "sparkles").font(.caption).foregroundStyle(Theme.training)
                                        .accessibilityLabel("Ajustado por el Coach")
                                }
                            }
                            Text(next.items.map(\.name).joined(separator: ", "))
                                .font(.caption).foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 6)
                        Text("\(Int(next.items.reduce(0) { $0 + $1.kcal })) kcal")
                            .font(.caption.weight(.semibold).monospacedDigit()).fontDesign(.rounded)
                            .foregroundStyle(.secondary)
                        Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(.tertiary)
                    }
                    .lineLimit(1)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Abre el plan")
            }
        }
    }

    private func tile(_ title: String, _ value: Double, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text(abs(value), format: .number.precision(.fractionLength(0)))
                .font(.headline.monospacedDigit())
                .foregroundStyle(value < 0 ? Theme.energy : .primary)
                .contentTransition(.numericText(value: value))
            Text(title).font(.caption2).foregroundStyle(.secondary)
        }
        .fontDesign(.rounded)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(color.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .animation(.snappy, value: value)
    }
}

/// The day's meals, slot by slot down a timeline. Each slot folds to one line
/// (time, what, kcal); open it for the foods, swipe one to delete it. Snacks
/// and drinks are their own dots, where they happened, however many a day.
struct MealTimeline: View {
    let meals: [MealEntry]
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
                CardTitle(text: "Comidas", systemImage: "clock")
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

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(group.title).font(.headline)
                HStack(spacing: 4) {
                    Text(time, format: .dateTime.hour().minute())
                    if offPlan {
                        Text("· Fuera del plan").foregroundStyle(Theme.carbs)
                    }
                    if !expanded {
                        Text("· \(note ?? meals.map(\.name).joined(separator: ", "))")
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

#Preview("Hoy · 375 pt · XXL") {
    NarrowPreview(dynamicType: .xxLarge) {
        RemainingCard(remaining: previewNutritionSummary.remaining!,
                      next: DietPlanForDay.Meal(slot: .merienda, name: nil, items: [
                          DietPlanItem(id: "y", name: "Yogur griego", quantity: 255, unit: .g, kcal: 240, protein: 22, carbs: 9, fat: 12, fiber: 0),
                      ], change: "scaled"),
                      adjusted: true) {}
        MealTimeline(meals: previewMeals) { _ in }
    }
}

#Preview("Hoy · 375 pt") {
    NarrowPreview {
        MealTimeline(meals: previewMeals) { _ in }
    }
}
