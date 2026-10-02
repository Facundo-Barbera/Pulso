import SwiftUI

/// What can be done with a planned meal. Each one is a plan change the Mac can undo.
enum SlotAction: CaseIterable {
    case eaten, replaced, ateOut, skipped, noCook

    var title: String {
        switch self {
        case .eaten: "Me lo comí"
        case .replaced: "Registrar lo que comí"
        case .ateOut: "Comí fuera"
        case .skipped: "Me lo salté"
        case .noCook: "Hoy no cocino"
        }
    }

    var systemImage: String {
        switch self {
        case .eaten: "checkmark.circle"
        case .replaced: "square.and.pencil"
        case .ateOut: "storefront"
        case .skipped: "minus.circle"
        case .noCook: "frying.pan"
        }
    }

    static func available(for slot: PlanSlot) -> [SlotAction] {
        guard slot.isPlanned else { return [] }
        return allCases.filter { $0 != .noCook || slot.needsCooking }
    }
}

/// The one mark a meal shows down the timeline, so the day reads at a glance: filled
/// as planned, half for something else, hollow pending, dashed when skipped or unanswered.
enum MealMark: Equatable {
    case asPlanned, changed, pending, unanswered, skipped

    init(_ slot: PlanSlot) {
        if slot.isMissed {
            self = .unanswered
            return
        }
        switch slot.status {
        case .planned: self = .pending
        case .skipped: self = .skipped
        case .eaten: self = slot.real?.asPlanned == false ? .changed : .asPlanned
        case .replaced: self = slot.real?.asPlanned == true ? .asPlanned : .changed
        }
    }

    var systemImage: String {
        switch self {
        case .asPlanned: "circle.fill"
        case .changed: "circle.lefthalf.filled"
        case .pending: "circle"
        case .unanswered, .skipped: "circle.dashed"
        }
    }

    var tint: Color {
        switch self {
        case .asPlanned, .changed: Theme.good
        case .pending: .secondary
        case .unanswered: Theme.caution
        case .skipped: Color(.tertiaryLabel)
        }
    }

    var title: String {
        switch self {
        case .asPlanned: "Como estaba planeado"
        case .changed: "Otra cosa"
        case .pending: "Pendiente"
        case .unanswered: "Sin registrar"
        case .skipped: "Saltado"
        }
    }

    var isEaten: Bool { self == .asPlanned || self == .changed }
}

/// One meal of the day on a timeline. Folded it is the meal and its time, what was eaten
/// (or what's planned, quieter) and the kcal; something else than planned adds a small
/// «en lugar de …». Open it for the foods once, the plan behind a disclosure, and what
/// can be done. A pending meal swipes right for "Me lo comí", left for "Me lo salté";
/// long-press for every change. Without `onAction` it only reads.
struct PlanSlotRow: View {
    let slot: PlanSlot
    /// "Porción del prep · 2 de 4", "Receta rápida · 10 min", "Comer fuera".
    var source: String?
    /// The recipe behind it: its own, or the batch's for a prep portion.
    var recipeId: String?
    /// Log entries tied to the slot: eaten as planned, or eaten instead.
    var entries: [MealEntry] = []
    var isLast = false
    /// The day's other meals what was eaten can move to.
    var moveTargets: [PlanSlot] = []
    var onAction: ((SlotAction) -> Void)?
    var onDeleteEntry: ((MealEntry) -> Void)?
    var onMove: ((PlanSlot) -> Void)?
    /// Deletes everything eaten for it: the meal goes back to pending.
    var onDeleteAll: (() -> Void)?

    @Environment(\.dishActions) private var dishActions
    @State private var expanded = false
    @State private var showPlanned = false
    @State private var editing: MealEntry?
    @State private var addingToDish = false
    @State private var confirmDelete = false
    @State private var drag: CGFloat = 0
    @ScaledMetric(relativeTo: .headline) private var markHeight: CGFloat = 22
    private let trigger: CGFloat = 90

    private var mark: MealMark { MealMark(slot) }
    private var actions: [SlotAction] { onAction == nil ? [] : SlotAction.available(for: slot) }
    /// The dish everything eaten belongs to, when it's one.
    private var dish: DishRef? {
        guard let dish = entries.first?.dish, entries.allSatisfy({ $0.dish == dish }) else { return nil }
        return dish
    }
    private var hasEntryActions: Bool { !entries.isEmpty && (onDeleteAll != nil || onMove != nil) }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            rail
            VStack(alignment: .leading, spacing: 12) {
                swipeable(header)
                if mark == .unanswered, onAction != nil { missedActions }
                if expanded { details.transition(.opacity.combined(with: .move(edge: .top))) }
            }
            .padding(.bottom, isLast ? 0 : 18)
        }
        .animation(.snappy, value: slot.status)
        .animation(.snappy, value: showPlanned)
        .sensoryFeedback(.selection, trigger: expanded)
        .sensoryFeedback(.success, trigger: slot.status) { _, new in new == .eaten }
        .sheet(item: $editing) { meal in
            ComponentAmountSheet(meal: meal) { factor in await dishActions.update(meal, factor) }
                .presentationDetents([.medium])
        }
        .sheet(isPresented: $addingToDish) {
            if let dish {
                ComponentForm(title: "Añadir a \(dish.name)", slot: slot.slot) { input in await dishActions.add(input, dish) }
                    .presentationDetents([.large])
            }
        }
        .confirmationDialog("¿Borrar lo que comiste en \(slot.slot.title.lowercased())?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Borrar", role: .destructive) { onDeleteAll?() }
        } message: {
            Text("La comida vuelve a quedar pendiente.")
        }
    }

    /// The state mark joined to the next meal by a hairline.
    private var rail: some View {
        VStack(spacing: 4) {
            Image(systemName: mark.systemImage)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(mark.tint)
                .contentTransition(.symbolEffect(.replace))
                .frame(height: markHeight)
            if !isLast {
                Capsule().fill(.quaternary).frame(width: 2).frame(maxHeight: .infinity)
            }
        }
        .frame(width: 20)
        .accessibilityHidden(true)
    }

    // MARK: Header

    private var header: some View {
        Button { withAnimation(.snappy) { expanded.toggle() } } label: {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    titleLine
                    Text(slot.real?.label ?? (mark == .changed ? slot.replacedBy : nil) ?? slot.what)
                        .font(.subheadline)
                        .foregroundStyle(mark.isEaten ? .primary : .secondary)
                        .lineLimit(expanded ? nil : 2)
                        .multilineTextAlignment(.leading)
                    if mark == .changed, slot.real != nil || slot.replacedBy != nil {
                        Text("en lugar de \(slot.what)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Text("\(Int(slot.kcal).formatted()) kcal")
                    .font(.subheadline.weight(.semibold).monospacedDigit()).fontDesign(.rounded)
                    .foregroundStyle(mark == .skipped ? .tertiary : mark.isEaten ? .primary : .secondary)
                    .contentTransition(.numericText(value: slot.kcal))
                    .lineLimit(1)
                    .layoutPriority(1)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityValue(mark.title)
        .accessibilityHint(expanded ? "Pliega" : "Muestra qué lleva")
        .accessibilityActions {
            ForEach(actions, id: \.self) { action in Button(action.title) { onAction?(action) } }
        }
    }

    /// "Desayuno 11:11", or the state when nothing was eaten: «Sin registrar», «Saltado».
    private var titleLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(slot.slot.title).font(.headline)
            if let real = slot.real {
                Text(real.eaten, format: .dateTime.hour().minute())
                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            } else if mark == .unanswered || mark == .skipped {
                Text(mark.title).font(.caption.weight(.semibold)).foregroundStyle(mark == .unanswered ? Theme.caution : .secondary)
            }
            if slot.adjusted != nil && slot.isPlanned {
                Image(systemName: "sparkles").font(.caption).foregroundStyle(Theme.training)
                    .accessibilityLabel("Ajustado por el Coach")
            }
        }
        .lineLimit(1)
    }

    /// The two answers to «Sin registrar»: skipped it, or say what was eaten.
    private var missedActions: some View {
        HStack(spacing: 8) {
            Button(SlotAction.skipped.title, systemImage: SlotAction.skipped.systemImage) { onAction?(.skipped) }
            Button(SlotAction.replaced.title, systemImage: SlotAction.replaced.systemImage) { onAction?(.replaced) }
        }
        .buttonStyle(.glass)
        .controlSize(.small)
        .lineLimit(1)
        .font(.footnote.weight(.medium))
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

    /// Each thing once: what was eaten (or, still pending, what's planned), the plan behind a
    /// disclosure when it went otherwise, then what can be done.
    @ViewBuilder
    private var details: some View {
        if let note = slot.note {
            Label(note, systemImage: "sparkles").font(.caption).italic().foregroundStyle(.secondary)
        }
        if !entries.isEmpty {
            EatenFoods(entries: entries, label: slot.real?.label) { editing = $0 } onDelete: { onDeleteEntry?($0) }
        } else if slot.real == nil {
            PlannedItems(items: slot.current)
            if let source {
                Label(source, systemImage: sourceSymbol).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        if slot.real != nil, mark == .changed || entries.isEmpty { plannedDisclosure }
        if mark != .changed, let recipeId = recipeId ?? slot.recipeId {
            NavigationLink { RecipeDetailView(recipeId: recipeId) } label: {
                Label("Ver receta", systemImage: "book").font(.subheadline.weight(.medium))
            }
        }
        if let first = actions.first {
            AdaptiveStack(horizontalAlignment: .leading, spacing: 8) {
                Button(first.title, systemImage: first.systemImage) { onAction?(first) }
                    .buttonStyle(.glassProminent)
                    .tint(Theme.good)
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
        } else if hasEntryActions {
            entryActions
        }
    }

    /// "Planeado · 420 kcal ›", folded: what it replaced is already named in the row.
    private var plannedDisclosure: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { showPlanned.toggle() } label: {
                HStack(spacing: 5) {
                    Text("Planeado · \(Int(slot.macros.kcal).formatted()) kcal").monospacedDigit()
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.bold))
                        .rotationEffect(.degrees(showPlanned ? 90 : 0))
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint(showPlanned ? "Oculta el plan" : "Muestra lo planeado")
            if showPlanned {
                PlannedItems(items: slot.current)
                    .opacity(0.7)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    /// Editar, Guardar (as a dish), Mover and Borrar as four equal glass tiles.
    private var entryActions: some View {
        GlassEffectContainer(spacing: 8) {
            HStack(spacing: 8) {
                editControl
                if let dish, dish.savedDishId == nil {
                    tile("Guardar", "bookmark") { dishActions.save(dish) }
                        .accessibilityLabel("Guardar como platillo")
                }
                if onMove != nil, !moveTargets.isEmpty {
                    Menu { moveItems } label: { ActionTile(title: "Mover", systemImage: "arrow.turn.down.right") }
                        .buttonStyle(.plain)
                }
                if onDeleteAll != nil {
                    tile("Borrar", "trash", role: .destructive) { confirmDelete = true }
                }
            }
        }
    }

    /// One food: its amount. Several, or a dish: pick which, or add to the dish.
    @ViewBuilder private var editControl: some View {
        if entries.count == 1, dish == nil, let only = entries.first {
            tile("Editar", "slider.horizontal.3") { editing = only }
        } else {
            Menu { editItems } label: { ActionTile(title: "Editar", systemImage: "slider.horizontal.3") }
                .buttonStyle(.plain)
        }
    }

    @ViewBuilder private var editItems: some View {
        Section("Cambiar la cantidad") {
            ForEach(entries) { meal in Button(meal.name) { editing = meal } }
        }
        if dish != nil {
            Button("Añadir ingrediente", systemImage: "plus") { addingToDish = true }
        }
    }

    private var moveItems: some View {
        Section("Mover a") {
            ForEach(moveTargets) { target in
                Button(target.slot.title, systemImage: target.slot.systemImage) { onMove?(target) }
            }
        }
    }

    private func tile(_ title: String, _ systemImage: String, role: ButtonRole? = nil, action: @escaping () -> Void) -> some View {
        Button(role: role, action: action) { ActionTile(title: title, systemImage: systemImage, destructive: role == .destructive) }
            .buttonStyle(.plain)
    }

    private func menuItems(_ items: [SlotAction]) -> some View {
        ForEach(items, id: \.self) { action in
            Button(action.title, systemImage: action.systemImage) { onAction?(action) }
        }
    }

    /// Long-press on an eaten meal: the same four as its tiles.
    @ViewBuilder private var entryMenu: some View {
        if entries.count == 1, let only = entries.first {
            Button("Cambiar la cantidad", systemImage: "slider.horizontal.3") { editing = only }
        } else {
            Menu("Cambiar la cantidad", systemImage: "slider.horizontal.3") { editItems }
        }
        if let dish, dish.savedDishId == nil {
            Button("Guardar como platillo", systemImage: "bookmark") { dishActions.save(dish) }
        }
        if onMove != nil, !moveTargets.isEmpty {
            Menu("Mover a", systemImage: "arrow.turn.down.right") {
                ForEach(moveTargets) { target in
                    Button(target.slot.title, systemImage: target.slot.systemImage) { onMove?(target) }
                }
            }
        }
        if onDeleteAll != nil {
            Button("Borrar", systemImage: "trash", role: .destructive) { confirmDelete = true }
        }
    }

    // MARK: Swipe

    /// Right past the threshold eats it, left skips it; both are undoable from the toast.
    @ViewBuilder
    private func swipeable(_ content: some View) -> some View {
        if !actions.isEmpty {
            ZStack {
                HStack {
                    swipeHint(.eaten, Theme.good).opacity(drag > 40 ? 1 : 0)
                    Spacer()
                    swipeHint(.skipped, .secondary).opacity(drag < -40 ? 1 : 0)
                }
                // No fill of its own: the hints only show once the row has moved past them.
                content
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
        } else if hasEntryActions {
            content.contextMenu { entryMenu }
        } else {
            content
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

/// An icon over a short word on glass: one of a meal's actions, sharing the row equally.
private struct ActionTile: View {
    let title: String
    let systemImage: String
    var destructive = false

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: systemImage).font(.subheadline.weight(.semibold))
            Text(title).font(.caption2.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .foregroundStyle(destructive ? AnyShapeStyle(.red) : AnyShapeStyle(.primary))
        .frame(maxWidth: .infinity, minHeight: 44)
        .padding(.vertical, 6)
        .contentShape(.rect)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 14))
    }
}

/// What was eaten for a meal, once. A lone food is its amount and macros (its name and kcal
/// are already in the row); several are each food with its amount and kcal, then the macros.
/// Tap a food to change its amount; swipe it to delete it.
private struct EatenFoods: View {
    let entries: [MealEntry]
    var label: String?
    let onEdit: (MealEntry) -> Void
    let onDelete: (MealEntry) -> Void

    private var total: NutritionMacros {
        entries.reduce(.zero) { sum, meal in
            NutritionMacros(kcal: sum.kcal + meal.kcal, protein: sum.protein + meal.protein, carbs: sum.carbs + meal.carbs,
                            fat: sum.fat + meal.fat, fiber: sum.fiber + meal.fiber)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if entries.count == 1, let only = entries.first {
                Button { onEdit(only) } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(only.name == label ? amount(only) : "\(only.name) · \(amount(only))")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                        Spacer(minLength: 8)
                        MacroLine(macros: total)
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Cambia la cantidad")
            } else {
                VStack(spacing: 0) {
                    ForEach(entries) { meal in
                        SwipeToDelete { onDelete(meal) } content: { food(meal) }
                        if meal.id != entries.last?.id { Divider() }
                    }
                }
                HStack {
                    Spacer()
                    MacroLine(macros: total)
                }
            }
        }
    }

    private func food(_ meal: MealEntry) -> some View {
        Button { onEdit(meal) } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(meal.name).font(.subheadline).lineLimit(2).multilineTextAlignment(.leading)
                    Text(amount(meal)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 8)
                Text("\(Int(meal.kcal).formatted()) kcal")
                    .font(.caption.monospacedDigit()).fontDesign(.rounded)
                    .foregroundStyle(.secondary)
                    .layoutPriority(1)
            }
            .padding(.vertical, 6)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Cambia la cantidad")
    }

    private func amount(_ meal: MealEntry) -> String { foodAmountText(meal.quantity, meal.unit, measure: meal.measure) }
}

/// The plan's foods for a meal with their amounts.
private struct PlannedItems: View {
    let items: [DietPlanItem]

    var body: some View {
        VStack(spacing: 6) {
            ForEach(items) { item in
                HStack(alignment: .firstTextBaseline) {
                    Text(item.name).font(.subheadline)
                    Spacer(minLength: 8)
                    Text(foodQuantityText(item.quantity, item.unit))
                        .font(.caption.monospacedDigit()).fontDesign(.rounded)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

// MARK: - Previews

let previewSlots = [
    PlanSlot(id: "s1", date: "2026-10-01", slot: .desayuno, kind: .items, name: nil, items: [
        DietPlanItem(id: "i1", name: "Avena", quantity: 60, unit: .g, kcal: 230, protein: 8, carbs: 40, fat: 4, fiber: 6),
        DietPlanItem(id: "i2", name: "Plátano", quantity: 1, unit: .serving, kcal: 105, protein: 1, carbs: 27, fat: 0, fiber: 3),
    ], macros: NutritionMacros(kcal: 335, protein: 9, carbs: 67, fat: 4, fiber: 9), status: .replaced, entryIds: ["e1"],
             replacedBy: "Vualá Big",
             real: RealMeal(label: "Vualá Big", entryIds: ["e1"], macros: NutritionMacros(kcal: 369, protein: 6, carbs: 48, fat: 17, fiber: 1),
                            eatenAt: 1_790_874_660_000, asPlanned: false)),
    PlanSlot(id: "s2", date: "2026-10-01", slot: .comida, kind: .prep, name: "Pollo con arroz", prepId: "b1", portions: 1, items: [
        DietPlanItem(id: "i3", name: "Pollo con arroz", quantity: 1, unit: .serving, kcal: 620, protein: 48, carbs: 70, fat: 14, fiber: 4),
    ], macros: NutritionMacros(kcal: 620, protein: 48, carbs: 70, fat: 14, fiber: 4), status: .planned, entryIds: [], cookMinutes: 0, missed: true),
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
