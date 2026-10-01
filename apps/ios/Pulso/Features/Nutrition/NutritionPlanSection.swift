import SwiftUI

/// Dieta · Plan: the dated plan over its horizon. A strip of dates picks the
/// day; the hero is that day's kcal; then the batch to cook that day, its meals
/// and the latest change with its undo. Adjustments happen talking to the Coach
/// (the bar under the screen), not by regenerating anything here.
struct NutritionPlanSection: View {
    let store: NutritionStore
    let askCoach: (String) -> Void
    let onAction: (SlotAction, PlanSlot) -> Void
    let onChange: (PlanChange) -> Void
    @Binding var selected: String

    var body: some View {
        if let horizon = store.horizon {
            let day = horizon.day(selected) ?? horizon.days.first
            WeekStrip(horizon: horizon, selected: $selected)
            if let day {
                DayHero(day: day)
                ForEach(horizon.preps(cookingOn: day.date)) { batch in
                    PrepSessionCard(batch: batch) { cooked in
                        Task { if let change = await store.apply(.prepCooked(batch, cooked)) { onChange(change) } }
                    }
                }
                mealsCard(day, horizon: horizon)
            }
            ChangesCard(store: store, last: horizon.lastRevision) { revision in
                Task { if let change = await store.undo(revision.id) { onChange(change) } }
            }
        } else if store.day?.plan != nil {
            Card {
                EmptyStateView(systemImage: "calendar.badge.exclamationmark", title: "No se pudo cargar tu plan",
                               message: "La Mac no devolvió los próximos días.", tint: Theme.body, actionTitle: "Reintentar") {
                    Task { await store.load() }
                }
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

    @ViewBuilder
    private func mealsCard(_ day: DietDay, horizon: DietHorizon) -> some View {
        let isToday = day.date == NutritionDate.string(.now)
        Card {
            CardTitle(text: "Comidas", systemImage: "fork.knife")
            if day.slots.isEmpty {
                EmptyStateView(systemImage: "calendar.day.timeline.left", title: "Día sin comidas planeadas",
                               message: "Pídele al Coach que llene este día.", tint: Theme.body)
            } else {
                VStack(spacing: 0) {
                    ForEach(day.slots) { slot in
                        PlanSlotRow(slot: slot, source: horizon.source(of: slot), recipeId: horizon.recipeId(of: slot),
                                    isLast: slot.id == day.slots.last?.id,
                                    onAction: isToday ? { onAction($0, slot) } : nil)
                    }
                }
            }
        }
    }
}

/// The horizon's dates in one scrollable row: weekday, day number, and a mark
/// for done days and cooking days. Dates first; the rotation label is secondary.
private struct WeekStrip: View {
    let horizon: DietHorizon
    @Binding var selected: String

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(horizon.days) { day in
                    DayPill(day: day, cooking: !horizon.preps(cookingOn: day.date).isEmpty, selected: day.date == selected) {
                        withAnimation(.snappy) { selected = day.date }
                    }
                }
            }
            .padding(.vertical, 2)
        }
        .scrollIndicators(.hidden)
        .scrollClipDisabled()
        .sensoryFeedback(.selection, trigger: selected)
    }
}

private struct DayPill: View {
    let day: DietDay
    let cooking: Bool
    let selected: Bool
    let action: () -> Void

    private var date: Date { day.day ?? .now }
    private var isToday: Bool { Calendar.current.isDateInToday(date) }

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Text(isToday ? "Hoy" : date.formatted(.dateTime.weekday(.abbreviated)).capitalized)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(selected ? Theme.body : .secondary)
                Text(date, format: .dateTime.day())
                    .font(.title3.weight(.bold)).fontDesign(.rounded)
                mark.font(.caption2).frame(height: 12)
            }
            .lineLimit(1)
            .frame(minWidth: 48)
            .padding(.horizontal, 6).padding(.vertical, 10)
            .background {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(selected ? AnyShapeStyle(Theme.body.opacity(0.18)) : AnyShapeStyle(.background.secondary))
            }
            .overlay {
                if selected { RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.body.opacity(0.5), lineWidth: 1) }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(date.formatted(.dateTime.weekday(.wide).day().month(.wide)))
        .accessibilityValue(cooking ? "Día de cocinar" : day.pending == 0 && !day.slots.isEmpty ? "Hecho" : "")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    @ViewBuilder
    private var mark: some View {
        if cooking {
            Image(systemName: "frying.pan.fill").foregroundStyle(Theme.energy)
        } else if !day.slots.isEmpty && day.pending == 0 {
            Image(systemName: "checkmark").foregroundStyle(Theme.body)
        } else {
            Circle().fill(.quaternary).frame(width: 5, height: 5)
        }
    }
}

/// The selected date as the title, its planned kcal against the goal as the number.
private struct DayHero: View {
    let day: DietDay

    private var title: String {
        guard let date = day.day else { return day.date }
        let text = date.formatted(.dateTime.weekday(.wide).day().month(.wide))
        return Calendar.current.isDateInToday(date) ? "Hoy · \(text)" : text
    }

    private var caption: String {
        var parts = ["de \(Int(day.goalKcal).formatted()) kcal"]
        if day.shiftKcal != 0 { parts.append(day.shiftKcal > 0 ? "+\(Int(day.shiftKcal)) compensado" : "\(Int(day.shiftKcal)) compensado") }
        parts.append(day.label)
        return parts.joined(separator: " · ")
    }

    private var progress: Double { day.slots.isEmpty ? 0 : Double(day.done) / Double(day.slots.count) }

    var body: some View {
        HeroCard(title: title, systemImage: "calendar", value: Int(day.planned.kcal).formatted(), unit: "kcal",
                 caption: caption, tint: Theme.body) {
            if !day.slots.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ProgressView(value: progress).tint(Theme.body)
                    Text(day.pending == 0 ? "Día resuelto" : "\(day.done) de \(day.slots.count) comidas resueltas")
                        .font(.caption).foregroundStyle(.secondary)
                        .contentTransition(.numericText())
                }
                .animation(.snappy, value: progress)
            }
        }
    }
}

/// "Cocinar: Pollo con arroz ×4" on its day, and "Ya lo cociné" once it's done.
struct PrepSessionCard: View {
    let batch: PrepBatch
    let onCooked: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Image(systemName: batch.cooked ? "checkmark.seal.fill" : "frying.pan.fill")
                    .foregroundStyle(batch.cooked ? Theme.body : Theme.energy)
                    .contentTransition(.symbolEffect(.replace))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Cocinar: \(batch.recipeName) ×\(batch.portions)").font(.headline)
                    Text(detail).font(.caption).foregroundStyle(.secondary)
                }
            }
            AdaptiveStack(horizontalAlignment: .leading, spacing: 8) {
                if batch.cooked {
                    Button("No lo cociné", systemImage: "arrow.uturn.backward") { onCooked(false) }
                        .buttonStyle(.glass)
                } else {
                    Button("Ya lo cociné", systemImage: "checkmark") { onCooked(true) }
                        .buttonStyle(.glassProminent)
                        .tint(Theme.energy)
                }
                NavigationLink { RecipeDetailView(recipeId: batch.recipeId) } label: {
                    Label("Receta", systemImage: "book")
                }
                .buttonStyle(.glass)
            }
            .controlSize(.small)
            .lineLimit(1)
        }
        .padding(Theme.padding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular.tint((batch.cooked ? Theme.body : Theme.energy).opacity(0.12)), in: .rect(cornerRadius: Theme.corner))
        .sensoryFeedback(.success, trigger: batch.cooked) { _, new in new }
    }

    private var detail: String {
        let used = batch.portions - batch.leftover
        var parts = ["\(used) de \(batch.portions) porciones con día"]
        if batch.leftover > 0 { parts.append("\(batch.leftover) libres") }
        if batch.cooked { parts.insert("Cocinado", at: 0) }
        return parts.joined(separator: " · ")
    }
}

/// The latest change, undoable in place, and the way to every change.
private struct ChangesCard: View {
    let store: NutritionStore
    let last: PlanRevision?
    let onUndo: (PlanRevision) -> Void

    var body: some View {
        Card {
            NavigationLink { PlanChangesView(store: store) } label: {
                HStack {
                    CardTitle(text: "Cambios", systemImage: "clock.arrow.circlepath")
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(.tertiary)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            if let last, last.isLive {
                Text(last.summary).font(.subheadline)
                HStack {
                    Text(last.created, format: .relative(presentation: .named))
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Deshacer", systemImage: "arrow.uturn.backward") { onUndo(last) }
                        .buttonStyle(.glass)
                        .controlSize(.small)
                }
            } else {
                Text("Lo que cambies con el Coach queda aquí, y se puede deshacer.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

/// The quiet bar under Plan: adjustments are mostly a conversation.
struct CoachPlanBar: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: "bubble.left.and.text.bubble.right.fill")
                    .foregroundStyle(Theme.training)
                Text("Cuéntale al Coach qué cambió hoy")
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 4)
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title3)
                    .foregroundStyle(Theme.training)
            }
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 16).padding(.vertical, 12)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .capsule)
        .padding(.horizontal)
        .padding(.bottom, 8)
        .accessibilityHint("Abre el Coach con el plan de hoy como contexto")
    }
}

// MARK: - Previews

#Preview("Plan · piezas · 375 pt · XXL") {
    NarrowPreview(dynamicType: .xxLarge) {
        WeekStrip(horizon: previewHorizon, selected: .constant("2026-10-01"))
        DayHero(day: previewHorizon.days[0])
        PrepSessionCard(batch: previewHorizon.preps[0]) { _ in }
        CoachPlanBar {}
    }
}

#Preview("Plan · piezas · claro") {
    NarrowPreview {
        WeekStrip(horizon: previewHorizon, selected: .constant("2026-10-02"))
        DayHero(day: previewHorizon.days[1])
        PrepSessionCard(batch: { var b = previewHorizon.preps[0]; b.status = .cooked; return b }()) { _ in }
        CoachPlanBar {}
    }
    .preferredColorScheme(.light)
}
