import SwiftUI

/// What can be done with a planned meal. Each one is a plan change the Mac can undo.
enum SlotAction: CaseIterable {
    case eaten, replaced, skipped, noCook

    var title: String {
        switch self {
        case .eaten: "Me lo comí"
        case .replaced: "Lo cambié por…"
        case .skipped: "Me lo salté"
        case .noCook: "Hoy no cocino"
        }
    }

    var systemImage: String {
        switch self {
        case .eaten: "checkmark.circle"
        case .replaced: "arrow.left.arrow.right"
        case .skipped: "minus.circle"
        case .noCook: "frying.pan"
        }
    }

    static func available(for slot: PlanSlot) -> [SlotAction] {
        guard slot.isPlanned else { return [] }
        return allCases.filter { $0 != .noCook || slot.needsCooking }
    }
}

extension SlotStatus {
    var tint: Color {
        switch self {
        case .planned: Theme.energy
        case .eaten: Theme.body
        case .replaced: Theme.carbs
        case .skipped: .secondary
        }
    }
}

/// One meal of the dated plan on a timeline: the slot, what it is and where it
/// comes from, its status. Tap to open the foods; swipe right for "Me lo comí",
/// left for "Me lo salté", long-press for every change. Without `onAction` it only reads.
struct PlanSlotRow: View {
    let slot: PlanSlot
    /// "Porción del prep · 2 de 4", "Receta rápida · 10 min", "Comer fuera".
    var source: String?
    /// The recipe behind it: its own, or the batch's for a prep portion.
    var recipeId: String?
    /// Log entries tied to the slot: eaten as planned, or eaten instead.
    var entries: [MealEntry] = []
    var isLast = false
    var onAction: ((SlotAction) -> Void)?
    var onDeleteEntry: ((MealEntry) -> Void)?

    @State private var expanded = false
    @State private var drag: CGFloat = 0
    private let trigger: CGFloat = 90

    private var actions: [SlotAction] { onAction == nil ? [] : SlotAction.available(for: slot) }
    private var tint: Color { slot.status.tint }
    private var muted: Bool { slot.status == .skipped || slot.status == .replaced }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
                Image(systemName: slot.isPlanned ? slot.slot.systemImage : slot.status.systemImage)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(tint)
                    .frame(width: 32, height: 32)
                    .background(tint.opacity(0.15), in: .circle)
                    .contentTransition(.symbolEffect(.replace))
                if !isLast {
                    Rectangle().fill(.quaternary).frame(width: 2).frame(maxHeight: .infinity)
                }
            }
            VStack(alignment: .leading, spacing: 10) {
                swipeable(header)
                if expanded { details.transition(.opacity.combined(with: .move(edge: .top))) }
            }
            .padding(.bottom, isLast ? 0 : 14)
        }
        .animation(.snappy, value: slot.status)
        .sensoryFeedback(.selection, trigger: expanded)
        .sensoryFeedback(.success, trigger: slot.status) { _, new in new == .eaten }
    }

    // MARK: Header

    private var header: some View {
        Button { withAnimation(.snappy) { expanded.toggle() } } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(slot.slot.title).font(.headline)
                        if !slot.isPlanned {
                            Text(slot.status.title)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(tint)
                        }
                        if slot.adjusted != nil && slot.isPlanned {
                            Image(systemName: "sparkles").font(.caption).foregroundStyle(Theme.training)
                                .accessibilityLabel("Ajustado por el Coach")
                        }
                    }
                    Text(slot.status == .replaced ? "Por \(slot.replacedBy ?? "otra cosa")" : slot.what)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .strikethrough(slot.status == .skipped, color: .secondary)
                        .lineLimit(expanded ? nil : 2)
                        .multilineTextAlignment(.leading)
                    if let source, slot.status != .replaced {
                        Label(source, systemImage: sourceSymbol)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 6)
                Text("\(Int(slot.macros.kcal)) kcal")
                    .font(.subheadline.weight(.semibold).monospacedDigit()).fontDesign(.rounded)
                    .foregroundStyle(muted ? .tertiary : .primary)
                    .contentTransition(.numericText(value: slot.macros.kcal))
                    .lineLimit(1)
                    .layoutPriority(1)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityValue(slot.status.title)
        .accessibilityHint(expanded ? "Pliega" : "Muestra qué lleva")
        .accessibilityActions {
            ForEach(actions, id: \.self) { action in Button(action.title) { onAction?(action) } }
        }
    }

    private var sourceSymbol: String {
        switch slot.kind {
        case .prep: "takeoutbag.and.cup.and.straw"
        case .recipe: "frying.pan"
        case .eatOut: "fork.knife"
        case .items: "list.bullet"
        }
    }

    // MARK: Details

    @ViewBuilder
    private var details: some View {
        if let note = slot.note {
            Label(note, systemImage: "sparkles").font(.caption).italic().foregroundStyle(.secondary)
        }
        if entries.isEmpty {
            VStack(spacing: 6) {
                ForEach(slot.current) { item in
                    HStack(alignment: .firstTextBaseline) {
                        Text(item.name).font(.subheadline)
                        Spacer(minLength: 8)
                        Text(foodQuantityText(item.quantity, item.unit))
                            .font(.caption.monospacedDigit()).fontDesign(.rounded)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        } else {
            ForEach(entries) { meal in
                if let onDeleteEntry {
                    SwipeToDelete { onDeleteEntry(meal) } content: { MealRow(meal: meal) }
                } else {
                    MealRow(meal: meal)
                }
            }
        }
        if let recipeId = recipeId ?? slot.recipeId {
            NavigationLink { RecipeDetailView(recipeId: recipeId) } label: {
                Label("Ver receta", systemImage: "book")
                    .font(.subheadline.weight(.medium))
            }
        }
        if let first = actions.first {
            AdaptiveStack(horizontalAlignment: .leading, spacing: 8) {
                Button(first.title, systemImage: first.systemImage) { onAction?(first) }
                    .buttonStyle(.glassProminent)
                    .tint(Theme.body)
                if actions.count > 1 {
                    Menu {
                        menuItems(Array(actions.dropFirst()))
                    } label: {
                        Label("Otro cambio", systemImage: "ellipsis")
                    }
                    .buttonStyle(.glass)
                }
            }
            .controlSize(.small)
            .lineLimit(1)
        }
    }

    private func menuItems(_ items: [SlotAction]) -> some View {
        ForEach(items, id: \.self) { action in
            Button(action.title, systemImage: action.systemImage) { onAction?(action) }
        }
    }

    // MARK: Swipe

    /// Right past the threshold eats it, left skips it; both are undoable from the toast.
    @ViewBuilder
    private func swipeable(_ content: some View) -> some View {
        if actions.isEmpty {
            content
        } else {
            ZStack {
                HStack {
                    swipeHint(.eaten, Theme.body).opacity(drag > 12 ? 1 : 0)
                    Spacer()
                    swipeHint(.skipped, .secondary).opacity(drag < -12 ? 1 : 0)
                }
                content
                    // The card's own fill, so the row covers the hints in light mode too.
                    .background(.background.secondary)
                    .offset(x: drag)
                    .gesture(
                        DragGesture(minimumDistance: 20)
                            .onChanged { value in
                                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                                drag = max(-trigger - 30, min(trigger + 30, value.translation.width))
                            }
                            .onEnded { value in
                                let width = value.translation.width
                                withAnimation(.snappy) { drag = 0 }
                                if width > trigger { onAction?(.eaten) } else if width < -trigger { onAction?(.skipped) }
                            }
                    )
            }
            .contextMenu { menuItems(actions) }
            .sensoryFeedback(.impact(weight: .light), trigger: abs(drag) > trigger)
        }
    }

    private func swipeHint(_ action: SlotAction, _ color: Color) -> some View {
        Label(action.title, systemImage: action.systemImage)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(color)
            .labelStyle(.iconOnly)
            .scaleEffect(abs(drag) > trigger ? 1.25 : 1)
            .padding(.horizontal, 8)
    }
}

// MARK: - Previews

let previewSlots = [
    PlanSlot(id: "s1", date: "2026-10-01", slot: .desayuno, kind: .items, name: nil, items: [
        DietPlanItem(id: "i1", name: "Avena", quantity: 60, unit: .g, kcal: 230, protein: 8, carbs: 40, fat: 4, fiber: 6),
        DietPlanItem(id: "i2", name: "Plátano", quantity: 1, unit: .serving, kcal: 105, protein: 1, carbs: 27, fat: 0, fiber: 3),
    ], macros: NutritionMacros(kcal: 335, protein: 9, carbs: 67, fat: 4, fiber: 9), status: .replaced, entryIds: ["e1"],
             replacedBy: "Vualá de jamón y queso"),
    PlanSlot(id: "s2", date: "2026-10-01", slot: .comida, kind: .prep, name: "Pollo con arroz", prepId: "b1", portions: 1, items: [
        DietPlanItem(id: "i3", name: "Pollo con arroz", quantity: 1, unit: .serving, kcal: 620, protein: 48, carbs: 70, fat: 14, fiber: 4),
    ], macros: NutritionMacros(kcal: 620, protein: 48, carbs: 70, fat: 14, fiber: 4), status: .planned, entryIds: [], cookMinutes: 0),
    PlanSlot(id: "s3", date: "2026-10-01", slot: .merienda, kind: .items, name: nil, items: [
        DietPlanItem(id: "i4", name: "Yogur griego", quantity: 170, unit: .g, kcal: 160, protein: 15, carbs: 6, fat: 8, fiber: 0),
    ], macros: NutritionMacros(kcal: 160, protein: 15, carbs: 6, fat: 8, fiber: 0), status: .skipped, entryIds: []),
    PlanSlot(id: "s4", date: "2026-10-01", slot: .cena, kind: .recipe, name: "Salmón al horno con patatas", recipeId: "r2", portions: 1, items: [
        DietPlanItem(id: "i5", name: "Salmón al horno con patatas", quantity: 1, unit: .serving, kcal: 580, protein: 38, carbs: 45, fat: 24, fiber: 5),
    ], macros: NutritionMacros(kcal: 580, protein: 38, carbs: 45, fat: 24, fiber: 5), status: .planned, entryIds: [], cookMinutes: 35),
]

let previewHorizon = DietHorizon(
    planId: "p1", planName: "Definición suave", from: "2026-10-01", to: "2026-10-07", horizonDays: 7,
    days: (0..<7).map { offset in
        let date = NutritionDate.string(Calendar.current.date(byAdding: .day, value: offset, to: NutritionDate.date("2026-10-01")!)!)
        return DietDay(date: date, label: "Día \(["A", "B", "C"][offset % 3])",
                       slots: previewSlots.map { var s = $0; s.date = date; if offset > 0 { s.status = .planned }; return s },
                       planned: NutritionMacros(kcal: 1_695, protein: 110, carbs: 188, fat: 50, fiber: 18), shiftKcal: 0, goalKcal: 2_200)
    },
    preps: [PrepBatch(id: "b1", recipeId: "r1", recipeName: "Pollo con arroz", cookDate: "2026-10-01", portions: 4, status: .planned,
                      slotIds: ["s0", "s2", "s5", "s6"], eaten: 1, leftover: 0)],
    lastRevision: PlanRevision(id: "rv1", op: "skip", summary: "Salté la merienda del miércoles.", dates: ["2026-10-01"],
                               createdAt: 1_790_850_000_000)
)

#Preview("Comidas del plan · 375 pt · XXL") {
    NarrowPreview(dynamicType: .xxLarge) {
        Card {
            ForEach(previewSlots) { slot in
                PlanSlotRow(slot: slot, source: previewHorizon.source(of: slot), isLast: slot.id == previewSlots.last?.id) { _ in }
            }
        }
    }
}

#Preview("Comidas del plan · claro") {
    NarrowPreview {
        Card {
            ForEach(previewSlots) { slot in
                PlanSlotRow(slot: slot, source: previewHorizon.source(of: slot), isLast: slot.id == previewSlots.last?.id) { _ in }
            }
        }
    }
    .preferredColorScheme(.light)
}
