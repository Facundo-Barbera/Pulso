import SwiftUI

/// The day's water in one row: a small ring, "1 de 15 vasos", and one button
/// that adds their glass. Hold it for a bottle, a litre, another amount,
/// undo and the water settings. Tapping the count lists the day's glasses.
struct WaterCard: View {
    let water: WaterDay
    let onAdd: (Double) -> Void
    let onUndo: () -> Void
    let onCustom: () -> Void
    let onSettings: () -> Void
    let onShowEntries: () -> Void

    private var settings: WaterSettings { water.settings }
    private var done: Bool { water.totalMl >= water.goalMl }

    var body: some View {
        Card {
            // At large text the button drops below rather than squeezing the count.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 14) {
                    summary
                    Spacer(minLength: 8)
                    addButton
                }
                VStack(alignment: .leading, spacing: 12) {
                    summary
                    addButton
                }
            }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: water.totalMl) { old, new in new > old }
        .sensoryFeedback(.success, trigger: done) { _, new in new }
    }

    private var summary: some View {
        Button(action: onShowEntries) { summaryContent }
            .buttonStyle(.plain)
            .accessibilityHint("Muestra el agua de hoy para borrar un registro")
    }

    private var summaryContent: some View {
        HStack(spacing: 14) {
            ZStack {
                ProgressRing(progress: water.progress, color: Theme.water, lineWidth: 6)
                Image(systemName: done ? "checkmark" : "drop.fill")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Theme.water)
                    .contentTransition(.symbolEffect(.replace))
            }
            .frame(width: 44, height: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text("Agua").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Text(settings.progress(water.totalMl, of: water.goalMl))
                    .font(.title3.weight(.semibold)).fontDesign(.rounded)
                    .monospacedDigit()
                    .contentTransition(.numericText(value: water.totalMl))
                    .fixedSize()
            }
            .animation(.snappy, value: water.totalMl)
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(done ? "Objetivo cumplido" : "Quedan \(settings.format(water.leftMl))")
    }

    private var addButton: some View {
        let ml = settings.quickAddMl
        return Menu {
            ForEach(WaterPreset.presets(settings).filter { $0.ml != ml }) { preset in
                Button("\(preset.title) · \(WaterSettings.litres(preset.ml))", systemImage: preset.systemImage) { onAdd(preset.ml) }
            }
            Button("Otra cantidad…", systemImage: "plus.circle", action: onCustom)
            Divider()
            if let last = water.entries.last {
                Button("Deshacer +\(WaterSettings.litres(last.amountMl))", systemImage: "arrow.uturn.backward", action: onUndo)
            }
            Button("Ajustes de agua", systemImage: "slider.horizontal.3", action: onSettings)
        } label: {
            Label(quickAddTitle(ml), systemImage: "plus")
                .font(.subheadline.weight(.semibold))
                .fixedSize()
        } primaryAction: {
            onAdd(ml)
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .tint(Theme.water)
        .accessibilityHint("Mantén pulsado para otras cantidades y ajustes")
    }

    /// "1 vaso", "1 botella" or "250 ml", in how they count.
    private func quickAddTitle(_ ml: Double) -> String {
        switch settings.unit {
        case .ml: WaterSettings.litres(ml)
        case .vaso: "1 vaso"
        case .botella: "1 botella"
        }
    }
}

/// "Otra cantidad": an amount in ml, glasses or bottles.
struct WaterAmountSheet: View {
    let settings: WaterSettings
    let onAdd: (Double) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var amount: Double = 1
    @State private var unit: WaterUnit = .vaso
    @FocusState private var focused: Bool

    private var ml: Double { amount * settings.ml(per: unit) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        TextField("Cantidad", value: $amount, format: .number.precision(.fractionLength(0...2)))
                            .keyboardType(.decimalPad)
                            .focused($focused)
                            .font(.system(.title2, design: .rounded, weight: .semibold))
                        Text(unit == .ml ? "ml" : unit.title.lowercased()).foregroundStyle(.secondary)
                    }
                    Picker("Unidad", selection: $unit) {
                        ForEach(WaterUnit.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    Text(unit == .ml ? " " : "\(WaterSettings.litres(ml)) en total")
                }
            }
            .navigationTitle("Otra cantidad")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Añadir") {
                        onAdd(ml)
                        dismiss()
                    }
                    .disabled(ml <= 0 || ml > 5000)
                }
            }
            .onAppear {
                unit = settings.unit
                amount = unit == .ml ? 330 : 1
                focused = true
            }
            .onChange(of: unit) { _, new in amount = new == .ml ? 330 : 1 }
        }
    }
}

/// How the person counts water, their glass and bottle, and the daily goal.
struct WaterSettingsSheet: View {
    let water: WaterDay
    let onSave: (WaterSettings) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var settings = WaterSettings.standard
    @State private var automatic = true
    @State private var goal: Double = 2000

    private static let bottles: [Double] = [330, 500, 750, 1000, 1500]

    var body: some View {
        NavigationStack {
            Form {
                Section("Cuento el agua en") {
                    Picker("Unidad", selection: $settings.unit) {
                        ForEach(WaterUnit.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }
                Section("Mis envases") {
                    Stepper(value: $settings.glassMl, in: 100...600, step: 25) {
                        LabeledContent("Vaso", value: WaterSettings.litres(settings.glassMl))
                    }
                    Picker("Botella", selection: $settings.bottleMl) {
                        ForEach(Self.bottles, id: \.self) { Text(WaterSettings.litres($0)).tag($0) }
                    }
                }
                Section {
                    Toggle("Automático", isOn: $automatic.animation(.snappy))
                    if !automatic {
                        Stepper(value: $goal, in: 1000...6000, step: 250) {
                            LabeledContent("Objetivo", value: settings.format(goal, in: .ml))
                        }
                    }
                } header: {
                    Text("Objetivo diario")
                } footer: {
                    Text(automatic ? "35 ml por kg de tu peso más reciente, entre 2 y 3,7 L, o 2 L si Pulso aún no lo sabe." : "Equivale a \(settings.format(goal)).")
                }
            }
            .navigationTitle("Agua")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar") {
                        var saved = settings
                        saved.goalMl = automatic ? nil : goal
                        onSave(saved)
                        dismiss()
                    }
                }
            }
            .onAppear {
                settings = water.settings
                if !Self.bottles.contains(settings.bottleMl) { settings.bottleMl = 500 }
                automatic = water.settings.goalMl == nil
                goal = water.goalMl
            }
        }
    }
}


#Preview("Agua · 375 pt · XXL") {
    let water = WaterDay(date: "2026-10-01", totalMl: 250, goalMl: 3700, goalSource: "weight",
                         entries: [WaterEntry(id: "1", date: "2026-10-01", loggedAt: 0, amountMl: 250, source: "manual")],
                         settings: .standard)
    NarrowPreview(dynamicType: .xxLarge) {
        WaterCard(water: water, onAdd: { _ in }, onUndo: {}, onCustom: {}, onSettings: {}, onShowEntries: {})
    }
}

#Preview("Agua · 375 pt") {
    let water = WaterDay(date: "2026-10-01", totalMl: 1800, goalMl: 2000, goalSource: "default", entries: [],
                         settings: WaterSettings(goalMl: nil, unit: .ml, glassMl: 300, bottleMl: 1000))
    NarrowPreview {
        WaterCard(water: water, onAdd: { _ in }, onUndo: {}, onCustom: {}, onSettings: {}, onShowEntries: {})
    }
}
