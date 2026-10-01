import SwiftUI

/// The day's water: a glass that fills, the total in the person's unit, one-tap
/// presets of their own glass and bottle, another amount, and undo.
struct WaterCard: View {
    let water: WaterDay
    let onAdd: (Double) -> Void
    let onUndo: () -> Void
    let onCustom: () -> Void
    let onSettings: () -> Void

    private var settings: WaterSettings { water.settings }
    private var done: Bool { water.totalMl >= water.goalMl }

    var body: some View {
        Card {
            HStack {
                CardTitle(text: "Agua", systemImage: "drop.fill")
                Spacer()
                Button("Ajustes de agua", systemImage: "slider.horizontal.3", action: onSettings)
                    .labelStyle(.iconOnly)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(minWidth: 32, minHeight: 32)
            }
            HStack(alignment: .center, spacing: 18) {
                WaterGlass(progress: water.progress)
                    .frame(width: 58, height: 84)
                VStack(alignment: .leading, spacing: 3) {
                    Text(settings.format(water.totalMl))
                        .font(.system(.title, design: .rounded, weight: .bold))
                        .contentTransition(.numericText(value: water.totalMl))
                    Text("de \(settings.format(water.goalMl))")
                        .font(.subheadline).foregroundStyle(.secondary)
                    Label(done ? "Objetivo cumplido" : "Quedan \(settings.format(water.leftMl))",
                          systemImage: done ? "checkmark.seal.fill" : "drop")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(done ? Theme.body : Theme.water)
                        .symbolEffect(.bounce, value: done)
                        .padding(.top, 2)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .animation(.snappy, value: water.totalMl)
                Spacer(minLength: 0)
            }
            presets
            if let last = water.entries.last {
                Button(action: onUndo) {
                    Label("Deshacer +\(WaterSettings.litres(last.amountMl))", systemImage: "arrow.uturn.backward")
                        .font(.footnote.weight(.medium))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .transition(.opacity)
            }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: water.totalMl) { old, new in new > old }
        .sensoryFeedback(.success, trigger: done) { _, new in new }
    }

    /// Glass, bottle, a litre and "Otra"; two per row when four don't fit (375 pt at large text).
    private var presets: some View {
        GlassEffectContainer(spacing: 8) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 72), spacing: 8)], spacing: 8) {
                ForEach(WaterPreset.presets(settings)) { preset in
                    Button { onAdd(preset.ml) } label: {
                        VStack(spacing: 2) {
                            Image(systemName: preset.systemImage).font(.subheadline)
                            Text(WaterSettings.litres(preset.ml)).font(.caption.weight(.semibold).monospacedDigit())
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.glass)
                    .tint(Theme.water)
                    .accessibilityLabel("Añadir \(preset.title.lowercased()), \(WaterSettings.litres(preset.ml))")
                }
                Button(action: onCustom) {
                    VStack(spacing: 2) {
                        Image(systemName: "plus").font(.subheadline)
                        Text("Otra").font(.caption.weight(.semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 4)
                }
                .buttonStyle(.glass)
                .accessibilityLabel("Otra cantidad")
            }
            .lineLimit(1)
        }
    }
}

/// A glass that fills to `progress`, sloshing a little each time it changes.
struct WaterGlass: View {
    let progress: Double
    @State private var phase: Double = 0

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        ZStack {
            shape.fill(Theme.water.opacity(0.10))
            WaterWave(level: min(progress, 1), phase: phase)
                .fill(LinearGradient(colors: [Theme.water.opacity(0.75), Theme.water], startPoint: .top, endPoint: .bottom))
            shape.strokeBorder(Theme.water.opacity(0.35), lineWidth: 1.5)
        }
        .clipShape(shape)
        .onChange(of: progress) {
            withAnimation(.snappy(duration: 0.9)) { phase += .pi * 2 }
        }
        .animation(.snappy(duration: 0.8), value: progress)
        .accessibilityElement()
        .accessibilityLabel("Agua")
        .accessibilityValue(Text(progress, format: .percent.precision(.fractionLength(0))))
    }
}

/// The water's surface: a gentle sine whose height decays as the slosh settles.
private struct WaterWave: Shape {
    var level: Double
    var phase: Double

    var animatableData: AnimatablePair<Double, Double> {
        get { AnimatablePair(level, phase) }
        set { (level, phase) = (newValue.first, newValue.second) }
    }

    func path(in rect: CGRect) -> Path {
        // Waves only while the phase is between turns; still water is flat.
        let settle = sin(phase.truncatingRemainder(dividingBy: .pi * 2) / 2)
        let amplitude = level > 0 && level < 1 ? 4 * abs(settle) : 0
        let top = rect.maxY - rect.height * level
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        for x in stride(from: rect.minX, through: rect.maxX, by: 2) {
            let y = top + amplitude * sin(x / rect.width * .pi * 2 + phase)
            path.addLine(to: CGPoint(x: x, y: y))
        }
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.closeSubpath()
        return path
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
                    Text(automatic ? "35 ml por kg de tu peso más reciente, o 2 L si Pulso aún no lo sabe." : "Equivale a \(settings.format(goal)).")
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
    let water = WaterDay(date: "2026-10-01", totalMl: 1250, goalMl: 2750, goalSource: "weight",
                         entries: [WaterEntry(id: "1", date: "2026-10-01", loggedAt: 0, amountMl: 250, source: "manual")],
                         settings: .standard)
    NarrowPreview(dynamicType: .xxLarge) {
        WaterCard(water: water, onAdd: { _ in }, onUndo: {}, onCustom: {}, onSettings: {})
    }
}

#Preview("Agua · 375 pt") {
    let water = WaterDay(date: "2026-10-01", totalMl: 1800, goalMl: 2000, goalSource: "default", entries: [],
                         settings: WaterSettings(goalMl: nil, unit: .ml, glassMl: 300, bottleMl: 1000))
    NarrowPreview {
        WaterCard(water: water, onAdd: { _ in }, onUndo: {}, onCustom: {}, onSettings: {})
    }
}
