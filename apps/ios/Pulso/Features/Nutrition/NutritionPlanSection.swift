import SwiftUI

/// Dieta · Plan: the active plan's day as it should be eaten now — with the
/// Coach's adjustment laid over it — one card per meal with "comido" ticks.
struct NutritionPlanSection: View {
    let day: NutritionDay
    let store: NutritionStore
    let askCoach: (String) -> Void

    var body: some View {
        if let plan = day.plan {
            PlanHeaderCard(plan: plan, store: store)
            if let adjustment = plan.adjustment {
                AdjustmentCard(adjustment: adjustment) { Task { await store.clearAdjustment() } }
                    .transition(.blurReplace)
            }
            ForEach(plan.meals) { meal in
                PlanMealCard(meal: meal, store: store)
            }
        } else {
            Card {
                EmptyStateView(systemImage: "list.bullet.clipboard", title: "Sin plan de comidas",
                               message: "El Coach arma uno con tus objetivos y lo adapta a lo que vas comiendo.",
                               tint: Theme.body, actionTitle: "Plan con el Coach") {
                    askCoach("Arma mi plan de comidas según mis objetivos y preferencias")
                }
            }
        }
    }
}

/// The plan's name and day, how much of it is eaten, and its notes.
private struct PlanHeaderCard: View {
    let plan: DietPlanForDay
    let store: NutritionStore
    @State private var notesExpanded = false

    private var items: [DietPlanItem] { plan.meals.flatMap(\.items) }
    private var eatenCount: Int { items.filter { store.isEaten($0) }.count }

    var body: some View {
        Card {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    CardTitle(text: plan.day.label, systemImage: "list.bullet.clipboard")
                    Text(plan.plan.name).font(.title3.weight(.semibold)).lineLimit(2)
                }
                Spacer(minLength: 8)
                Gauge(value: Double(eatenCount), in: 0...Double(max(items.count, 1))) {
                    EmptyView()
                } currentValueLabel: {
                    Text("\(eatenCount)/\(items.count)").fontDesign(.rounded)
                }
                .gaugeStyle(.accessoryCircularCapacity)
                .tint(Theme.body)
                .accessibilityLabel("\(eatenCount) de \(items.count) comidos")
            }
            if let notes = plan.plan.notes, !notes.isEmpty {
                Button { withAnimation(.snappy) { notesExpanded.toggle() } } label: {
                    Text(notes)
                        .font(.footnote).foregroundStyle(.secondary)
                        .lineLimit(notesExpanded ? nil : 2)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
            }
        }
        .sensoryFeedback(.success, trigger: !items.isEmpty && eatenCount == items.count) { _, new in new }
    }
}

/// "Ajustado por el Coach": what changed today and why, and a way back to the plan.
private struct AdjustmentCard: View {
    let adjustment: DayAdjustment
    let onRevert: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .symbolEffect(.bounce, value: adjustment.createdAt)
                Text("Ajustado por el Coach").font(.subheadline.weight(.semibold))
                Spacer(minLength: 4)
                Text(Date(timeIntervalSince1970: adjustment.createdAt / 1000), format: .dateTime.hour().minute())
                    .font(.caption).foregroundStyle(.secondary)
            }
            .foregroundStyle(Theme.training)
            Text(adjustment.summary).font(.subheadline)
            if let note = adjustment.note {
                Text(note).font(.footnote).foregroundStyle(.secondary)
            }
            Button("Volver al plan", systemImage: "arrow.uturn.backward", action: onRevert)
                .buttonStyle(.glass)
                .controlSize(.small)
        }
        .padding(Theme.padding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular.tint(Theme.training.opacity(0.12)), in: .rect(cornerRadius: Theme.corner))
    }
}

/// One meal of the plan: its items with a "comido" tap, and a badge when the Coach changed it.
private struct PlanMealCard: View {
    let meal: DietPlanForDay.Meal
    let store: NutritionStore

    private var kcal: Double { meal.items.reduce(0) { $0 + $1.kcal } }
    private var done: Bool { meal.items.allSatisfy { store.isEaten($0) } }

    var body: some View {
        Card {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Label {
                    Text(meal.name ?? meal.slot.title).font(.headline).lineLimit(2)
                } icon: {
                    Image(systemName: done ? "checkmark.circle.fill" : meal.slot.systemImage)
                        .foregroundStyle(done ? Theme.body : .secondary)
                        .contentTransition(.symbolEffect(.replace))
                }
                Spacer(minLength: 6)
                Text("\(Int(kcal)) kcal")
                    .font(.subheadline.weight(.semibold).monospacedDigit()).fontDesign(.rounded)
                    .foregroundStyle(.secondary)
                    .contentTransition(.numericText(value: kcal))
                    .layoutPriority(1)
            }
            if meal.name != nil || meal.adjusted {
                HStack(spacing: 6) {
                    if meal.name != nil {
                        Text(meal.slot.title).font(.caption).foregroundStyle(.secondary)
                    }
                    if meal.adjusted {
                        GlassChip(meal.change == "swapped" ? "Cambiado por el Coach" : "Ajustado por el Coach",
                                  systemImage: "sparkles", tint: Theme.training)
                    }
                }
            }
            ForEach(meal.items) { item in
                PlanItemRow(item: item, eaten: store.isEaten(item)) {
                    Task { await store.eat(item) }
                }
                if item.id != meal.items.last?.id { Divider() }
            }
        }
        .opacity(done ? 0.75 : 1)
        .animation(.snappy, value: done)
    }
}

struct PlanItemRow: View {
    let item: DietPlanItem
    let eaten: Bool
    let onEat: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.name).strikethrough(eaten, color: .secondary).foregroundStyle(eaten ? .secondary : .primary)
                // "1,5 porciones · 1.250 kcal" plus the macros is wider than a 375 pt card: macros go below.
                AdaptiveStack(horizontalAlignment: .leading, spacing: 6) {
                    Text("\(foodQuantityText(item.quantity, item.unit)) · \(Int(item.kcal)) kcal")
                    MacroLine(macros: item.macros)
                }
                .font(.caption).foregroundStyle(.secondary)
                .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button(action: onEat) {
                Image(systemName: eaten ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(eaten ? Theme.body : .secondary)
                    .contentTransition(.symbolEffect(.replace))
                    .symbolEffect(.bounce, value: eaten)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.plain)
            .disabled(eaten)
            .accessibilityLabel(eaten ? "Comido" : "Marcar como comido")
        }
        .sensoryFeedback(.success, trigger: eaten) { _, new in new }
    }
}

// MARK: - Previews

private let previewAdjustment = DayAdjustment(
    date: "2026-10-01", factor: 1.5,
    meals: [AdjustedMeal(slot: .cena, name: "Merluza con patata y brócoli", items: [], change: "swapped")],
    projected: NutritionMacros(kcal: 1_755, protein: 97, carbs: 190, fat: 70, fiber: 20),
    summary: "Merienda al 150 % y cena con cambios. Cierras el día en 1755 de 2200 kcal (faltan 445) y 97 de 160 g de proteína.",
    note: "Comida más grasa de lo previsto: cena más ligera y rica en proteína.", createdAt: 1_790_849_000_000
)

#Preview("Plan · 375 pt · XXL") {
    NarrowPreview(dynamicType: .xxLarge) {
        AdjustmentCard(adjustment: previewAdjustment) {}
        Card {
            PlanItemRow(item: DietPlanItem(id: "p1", name: "Avena con plátano, nueces y miel", quantity: 1.5, unit: .serving,
                                           kcal: 1_250, protein: 32, carbs: 168, fat: 41, fiber: 12), eaten: false) {}
        }
    }
}
