import SwiftUI

/// The Dieta tab: Hoy (the macro hero, water and today's planned meals with
/// their status), Plan (the dated plan over its horizon) and Progreso (the week),
/// under a plain section switch. Everything that adds food starts from one
/// floating "Registrar" button on Hoy; changes to the plan come back as a toast
/// with its undo, and the Coach bar on Plan is where most of them start.
struct NutritionView: View {
    let model: PulsoModel
    @State private var store = NutritionStore()
    @State private var section = DietSection.hoy
    @State private var sheet: Sheet?
    @State private var toast: Toast?
    @State private var showShopping = false
    /// What was typed in Registrar when it hands over to the manual form.
    @State private var draftName = ""
    /// The day open on Plan.
    @State private var planDate = NutritionDate.string(.now)
    @Environment(\.askCoach) private var askCoach

    enum Sheet: String, Identifiable {
        case register, quickAdd, snack, scan, targets, water, waterAmount, waterEntries
        var id: String { rawValue }
    }

    /// A short message at the top, optionally with an undo.
    struct Toast: Identifiable, Equatable {
        let id = UUID()
        var message: String
        var undo: (() -> Void)?
        static func == (a: Toast, b: Toast) -> Bool { a.id == b.id }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                VStack(spacing: 6) {
                    Picker("Sección", selection: $section) {
                        ForEach(DietSection.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    if section != .plan { DaySwitcher(store: store) }
                }
                if let day = store.day {
                    content(day)
                } else if store.loading {
                    ProgressView().controlSize(.large).padding(.top, 120)
                } else {
                    EmptyStateView(systemImage: "fork.knife.circle", title: "Sin conexión con la Mac",
                                   message: "No se pudo cargar tu dieta.", tint: Theme.energy, actionTitle: "Reintentar") {
                        Task { await store.load() }
                    }
                    .padding(.top, 40)
                }
            }
            .padding(.horizontal)
            // The Registrar button is a safe-area inset, so the scroll already ends above it.
            .padding(.bottom, 24)
            .animation(.snappy, value: store.day)
            .animation(.snappy, value: store.horizon)
            .animation(.snappy, value: section)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Dieta")
        .toolbar { toolbar }
        .navigationDestination(isPresented: $showShopping) { ShoppingListView() }
        .refreshable { await store.load() }
        .task { await store.load() }
        .safeAreaInset(edge: .bottom) {
            if section == .hoy && store.day != nil {
                registerButton.transition(.move(edge: .bottom).combined(with: .opacity))
            } else if section == .plan && store.horizon != nil {
                CoachPlanBar { askCoach(coachDraft, send: false) }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .sheet(item: $sheet, onDismiss: { Task { await store.load() } }) { sheet in
            switch sheet {
            case .register:
                RegisterSheet(foods: store.allFrequent, nextMeal: store.isToday ? store.nextMeal : nil, replacing: store.replacing,
                              onLog: { await store.log($0) }, onEatPlan: { await store.eat($0) }, onRoute: route)
                    .presentationDetents([.large])
            case .quickAdd: QuickAddView(store: store, initialName: draftName).presentationDetents([.medium, .large])
            case .snack: SnackAddView(store: store).presentationDetents([.large])
            case .scan: BarcodeScanView(store: store).presentationDetents([.large])
            case .targets: TargetsView(store: store).presentationDetents([.medium, .large])
            case .water:
                if let water = store.water {
                    WaterSettingsSheet(water: water) { settings in Task { await store.saveWaterSettings(settings) } }
                        .presentationDetents([.medium, .large])
                }
            case .waterAmount:
                WaterAmountSheet(settings: store.water?.settings ?? .standard) { ml in addWater(ml) }
                    .presentationDetents([.height(280)])
            case .waterEntries:
                WaterEntriesSheet(store: store).presentationDetents([.medium, .large])
            }
        }
        // "Lo cambié por…": once Registrar (or the form it handed over to) closes, what was logged replaces the slot.
        .onChange(of: sheet) { _, new in
            guard new == nil, store.replacing != nil else { return }
            Task { if let change = await store.finishReplacing() { showChange(change) } }
        }
        .overlay(alignment: .top) {
            if let toast { ToastView(toast: toast) { self.toast = nil } }
        }
        .sensoryFeedback(.success, trigger: store.day?.meals.count ?? 0) { old, new in new > old }
        .sensoryFeedback(.selection, trigger: section)
    }

    @ViewBuilder
    private func content(_ day: NutritionDay) -> some View {
        switch section {
        case .hoy:
            NutritionTodaySection(day: day, store: store, sheet: $sheet, showPlan: { section = .plan },
                                  addWater: addWater, undoWater: { Task { await store.undoWater() } },
                                  copyPrevious: { Task { await copyPrevious() } }, draftForCoach: { askCoach($0, send: false) },
                                  onAction: act)
                .transition(.opacity)
        case .plan:
            NutritionPlanSection(store: store, askCoach: { askCoach($0) }, onAction: act, onChange: showChange, selected: $planDate)
                .transition(.opacity)
        case .progreso:
            NutritionProgressSection(week: store.week, water: store.weekWater, settings: day.water?.settings ?? .standard,
                                     waterGoal: day.water?.goalMl)
                .transition(.opacity)
        }
    }

    /// One toolbar control: the shopping list and the settings that used to sit around the screen.
    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu("Más", systemImage: "ellipsis") {
                Button("Lista de compras", systemImage: "cart") { showShopping = true }
                Button("Copiar el día anterior", systemImage: "doc.on.doc") { Task { await copyPrevious() } }
                Divider()
                Button("Objetivos diarios", systemImage: "target") { sheet = .targets }
                Button("Ajustes de agua", systemImage: "drop") { sheet = .water }
                    .disabled(store.water == nil)
            }
        }
    }

    /// The single floating action on Hoy. Short enough to never truncate, even at the largest text.
    private var registerButton: some View {
        Button { sheet = .register } label: {
            Label("Registrar", systemImage: "plus")
                .font(.headline)
                .lineLimit(1)
                .fixedSize()
                .padding(.horizontal, 14).padding(.vertical, 6)
        }
        .buttonStyle(.glassProminent)
        .controlSize(.large)
        .padding(.bottom, 8)
    }

    /// Registrar hands over to the scanner, the snack form, the plan or the manual form.
    private func route(_ route: RegisterSheet.Route) {
        switch route {
        case .scan: sheet = .scan
        case .snack: sheet = .snack
        case .manual(let name):
            draftName = name
            sheet = .quickAdd
        case .plan:
            sheet = nil
            section = .plan
        case .photo:
            sheet = nil
            CoachLauncher.shared.photo("Registra esto")
        }
    }

    /// A quick change on a planned meal. Each answers with a toast that can undo it.
    private func act(_ action: SlotAction, on slot: PlanSlot) {
        switch action {
        case .eaten:
            Task {
                let eaten = await store.eat(slot)
                guard !eaten.isEmpty else { return }
                show("\(slot.slot.title): como en el plan") { Task { await store.deleteMeals(eaten.map(\.id)) } }
            }
        case .replaced:
            store.beginReplacing(slot)
            sheet = .register
        case .ateOut:
            Task { if let change = await store.apply(.ateOut(slot)) { showChange(change) } }
        case .skipped:
            Task { if let change = await store.apply(.skip(slot)) { showChange(change) } }
        case .noCook:
            Task { if let change = await store.apply(.noTimeToCook(slot)) { showChange(change) } }
        }
    }

    /// The Mac's Spanish summary of a plan change, with "Deshacer" reverting that revision.
    private func showChange(_ change: PlanChange) {
        show(change.summary) {
            Task { if let undone = await store.undo(change.revision.id) { show(undone.summary) } }
        }
    }

    /// What the Coach bar leaves in the composer: the day, so the Coach reads the right slots.
    private var coachDraft: String {
        let today = NutritionDate.string(.now)
        guard planDate != today, let date = NutritionDate.date(planDate) else { return "Hoy cambió algo en mi dieta: " }
        return "Sobre mi dieta del \(date.formatted(.dateTime.weekday(.wide).day().month(.wide))): "
    }

    private func addWater(_ ml: Double) {
        Task {
            guard let entry = await store.addWater(ml: ml) else { return }
            show("+\(WaterSettings.litres(ml)) de agua") { Task { await store.removeWater(entry) } }
        }
    }

    private func copyPrevious() async {
        let copied = await store.copyPreviousDay()
        show(copied == 0 ? "El día anterior está vacío" : "\(copied) alimentos copiados")
    }

    private func show(_ message: String, undo: (() -> Void)? = nil) {
        let next = Toast(message: message, undo: undo)
        withAnimation(.snappy) { toast = next }
        Task {
            // A plan change's summary is a sentence: give it time to be read and undone.
            try? await Task.sleep(for: .seconds(undo == nil ? 2.5 : 6))
            withAnimation(.snappy) { if toast == next { toast = nil } }
        }
    }
}

enum DietSection: String, CaseIterable, Identifiable {
    case hoy, plan, progreso
    var id: String { rawValue }

    var title: String {
        switch self {
        case .hoy: "Hoy"
        case .plan: "Plan"
        case .progreso: "Progreso"
        }
    }
}

/// "‹  Hoy, 1 de octubre  ›" in one quiet row. Tap the date to go back to today.
private struct DaySwitcher: View {
    let store: NutritionStore

    private var dayTitle: String {
        let date = store.date.formatted(.dateTime.day().month(.wide))
        if store.isToday { return "Hoy, \(date)" }
        if Calendar.current.isDateInYesterday(store.date) { return "Ayer, \(date)" }
        return "\(store.date.formatted(.dateTime.weekday(.wide)).capitalized), \(date)"
    }

    var body: some View {
        HStack(spacing: 4) {
            arrow("Día anterior", "chevron.left", days: -1)
            Spacer(minLength: 4)
            Button { Task { await store.goToToday() } } label: {
                HStack(spacing: 6) {
                    Text(dayTitle)
                        .contentTransition(.interpolate)
                    if !store.isToday {
                        Image(systemName: "arrow.uturn.backward.circle.fill")
                            .foregroundStyle(.tint)
                            .transition(.scale.combined(with: .opacity))
                    }
                }
                .font(.subheadline.weight(.semibold))
                .multilineTextAlignment(.center)
            }
            .buttonStyle(.plain)
            .disabled(store.isToday)
            .accessibilityHint(store.isToday ? "" : "Vuelve a hoy")
            Spacer(minLength: 4)
            arrow("Día siguiente", "chevron.right", days: 1)
                .disabled(store.isToday)
        }
        .animation(.snappy, value: store.dateKey)
        .sensoryFeedback(.selection, trigger: store.dateKey)
    }

    private func arrow(_ title: String, _ symbol: String, days: Int) -> some View {
        Button { Task { await store.shift(days: days) } } label: {
            Image(systemName: symbol)
                .font(.footnote.weight(.semibold))
                .frame(width: 44, height: 36)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .accessibilityLabel(title)
    }
}

/// The transient message at the top; with an undo it stays a little longer.
private struct ToastView: View {
    let toast: NutritionView.Toast
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Text(toast.message)
                .font(.subheadline.weight(.semibold))
                .multilineTextAlignment(.leading)
            if let undo = toast.undo {
                Button("Deshacer") {
                    undo()
                    onClose()
                }
                .font(.subheadline.weight(.bold))
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 10)
        .glassEffect()
        .padding(.horizontal)
        .transition(.move(edge: .top).combined(with: .opacity))
    }
}

// MARK: - Previews

let previewNutritionSummary = NutritionSummary(
    date: "2026-10-01",
    totals: NutritionMacros(kcal: 1_510, protein: 74, carbs: 158, fat: 64, fiber: 14),
    targets: NutritionTargets(kcal: 2_200, protein: 160, carbs: 230, fat: 70, fiber: 30),
    remaining: NutritionMacros(kcal: 690, protein: 86, carbs: 72, fat: 6, fiber: 16),
    bySlot: ["comida": NutritionMacros(kcal: 910, protein: 29, carbs: 88, fat: 49, fiber: 7)],
    entries: 3
)

#Preview("Cabecera · 375 pt · XXL") {
    NarrowPreview(dynamicType: .xxLarge) {
        Picker("Sección", selection: .constant(DietSection.hoy)) {
            ForEach(DietSection.allCases) { Text($0.title).tag($0) }
        }
        .pickerStyle(.segmented)
        DaySwitcher(store: NutritionStore())
    }
}
