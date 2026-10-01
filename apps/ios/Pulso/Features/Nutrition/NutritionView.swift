import SwiftUI

/// The Dieta tab, in three parts under a sticky day header:
/// Hoy (macros, water, what's left, the day's meals), Plan (the plan as the
/// Coach adjusted it, with "comido" ticks) and Progreso (the week).
/// Adding food lives in a floating glass bar on Hoy.
struct NutritionView: View {
    let model: PulsoModel
    @State private var store = NutritionStore()
    @State private var section = DietSection.hoy
    @State private var sheet: Sheet?
    @State private var toast: String?
    @Environment(\.askCoach) private var askCoach

    enum Sheet: String, Identifiable {
        case quickAdd, scan, targets, water, waterAmount
        var id: String { rawValue }
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 16, pinnedViews: [.sectionHeaders]) {
                Section {
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
                } header: {
                    DayHeader(store: store, section: $section)
                }
            }
            .padding(.horizontal)
            // The add bar is a safe-area inset, so the scroll already ends above it.
            .padding(.bottom, 24)
            .animation(.snappy, value: store.day)
            .animation(.snappy, value: section)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Dieta")
        .toolbar { toolbar }
        .refreshable { await store.load() }
        .task { await store.load() }
        .safeAreaInset(edge: .bottom) {
            if section == .hoy { addBar.transition(.move(edge: .bottom).combined(with: .opacity)) }
        }
        .sheet(item: $sheet, onDismiss: { Task { await store.load() } }) { sheet in
            switch sheet {
            case .quickAdd: QuickAddView(store: store).presentationDetents([.medium, .large])
            case .scan: BarcodeScanView(store: store).presentationDetents([.large])
            case .targets: TargetsView(store: store).presentationDetents([.medium, .large])
            case .water:
                if let water = store.water {
                    WaterSettingsSheet(water: water) { settings in Task { await store.saveWaterSettings(settings) } }
                        .presentationDetents([.medium, .large])
                }
            case .waterAmount:
                WaterAmountSheet(settings: store.water?.settings ?? .standard) { ml in Task { await store.addWater(ml: ml) } }
                    .presentationDetents([.height(280)])
            }
        }
        .overlay(alignment: .top) {
            if let toast {
                Text(toast)
                    .font(.subheadline.weight(.semibold))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 18).padding(.vertical, 10)
                    .glassEffect()
                    .padding(.horizontal)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .sensoryFeedback(.success, trigger: store.day?.meals.count ?? 0) { old, new in new > old }
        .sensoryFeedback(.selection, trigger: section)
    }

    @ViewBuilder
    private func content(_ day: NutritionDay) -> some View {
        switch section {
        case .hoy:
            NutritionTodaySection(day: day, store: store, sheet: $sheet, showPlan: { section = .plan },
                                  copyPrevious: { Task { await copyPrevious() } }, draftForCoach: { askCoach($0, send: false) })
                .transition(.opacity)
        case .plan:
            NutritionPlanSection(day: day, store: store, askCoach: { askCoach($0) })
                .transition(.opacity)
        case .progreso:
            NutritionProgressSection(week: store.week, water: store.weekWater, settings: day.water?.settings ?? .standard,
                                     waterGoal: day.water?.goalMl)
                .transition(.opacity)
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ShoppingListToolbarItem()
        ToolbarItem(placement: .topBarTrailing) {
            Menu("Más", systemImage: "ellipsis") {
                Button("Copiar el día anterior", systemImage: "doc.on.doc") { Task { await copyPrevious() } }
                Button("Objetivos diarios", systemImage: "target") { sheet = .targets }
                Button("Ajustes de agua", systemImage: "drop") { sheet = .water }
                    .disabled(store.water == nil)
            }
        }
    }

    /// The glass quick-add bar floating over Hoy. At large text the scan
    /// button drops its title so both still fit a 375 pt phone.
    private var addBar: some View {
        GlassEffectContainer(spacing: 12) {
            ViewThatFits(in: .horizontal) {
                addButtons(scanTitle: true)
                addButtons(scanTitle: false)
            }
        }
        .controlSize(.large)
        .padding(.horizontal)
        .padding(.bottom, 8)
    }

    private func addButtons(scanTitle: Bool) -> some View {
        HStack(spacing: 12) {
            Button { sheet = .scan } label: {
                Group {
                    if scanTitle {
                        Label("Escanear", systemImage: "barcode.viewfinder")
                    } else {
                        Label("Escanear", systemImage: "barcode.viewfinder").labelStyle(.iconOnly)
                    }
                }
                .padding(.horizontal, 6).padding(.vertical, 4)
            }
            .buttonStyle(.glass)
            Button { sheet = .quickAdd } label: {
                Label("Añadir comida", systemImage: "plus")
                    .fontWeight(.semibold)
                    .lineLimit(1)
                    .padding(.horizontal, 6).padding(.vertical, 4)
            }
            .buttonStyle(.glassProminent)
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

/// Pinned above the content: the day with its arrows (tap the day to go back
/// to today) and the Hoy · Plan · Progreso switch.
private struct DayHeader: View {
    let store: NutritionStore
    @Binding var section: DietSection

    private var dayTitle: String {
        if store.isToday { return "Hoy" }
        if Calendar.current.isDateInYesterday(store.date) { return "Ayer" }
        return store.date.formatted(.dateTime.weekday(.wide)).capitalized
    }

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 4) {
                arrow("Día anterior", "chevron.left", days: -1)
                Spacer(minLength: 4)
                Button { Task { await store.goToToday() } } label: {
                    VStack(spacing: 0) {
                        Text(dayTitle).font(.headline)
                            .contentTransition(.interpolate)
                        Text(store.date.formatted(.dateTime.day().month(.wide)))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                }
                .buttonStyle(.plain)
                .disabled(store.isToday)
                .accessibilityHint(store.isToday ? "" : "Vuelve a hoy")
                Spacer(minLength: 4)
                arrow("Día siguiente", "chevron.right", days: 1)
                    .disabled(store.isToday)
            }
            Picker("Sección", selection: $section) {
                ForEach(DietSection.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
        }
        .padding(10)
        .glassEffect(.regular, in: .rect(cornerRadius: 24))
        .padding(.top, 4)
        .animation(.snappy, value: store.dateKey)
        .sensoryFeedback(.selection, trigger: store.dateKey)
    }

    private func arrow(_ title: String, _ symbol: String, days: Int) -> some View {
        Button { Task { await store.shift(days: days) } } label: {
            Image(systemName: symbol)
                .font(.body.weight(.semibold))
                .frame(width: 40, height: 40)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
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
        DayHeader(store: NutritionStore(), section: .constant(.plan))
    }
}
