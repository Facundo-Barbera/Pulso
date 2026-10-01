import SwiftUI

/// "Snack o bebida": something between meals, in the measure the person would
/// say (a taza, a lata, un puño) with a stepper, and the frequent ones one tap
/// away. Macros are entered per one unit (or per 100 g / ml) and scaled.
struct SnackAddView: View {
    let store: NutritionStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var slot = MealSlot.snack
    @State private var unit = MeasureUnit.taza
    @State private var amount: Double = 1
    /// g or ml in one household unit; nil means its default (for unidad, a plain count).
    @State private var size: Double?
    @State private var kcal: Double?
    @State private var protein: Double?
    @State private var carbs: Double?
    @State private var fat: Double?
    @State private var fiber: Double?
    @State private var caffeine: Double?
    /// % vol, for drinks.
    @State private var abv: Double?
    @State private var saving = false

    private var measure: Measure {
        Measure(amount: amount, unit: unit, size: unit.isHousehold && size != unit.defaultSize ? size : nil)
    }

    private var perHundred: Bool { unit == .g || unit == .ml }
    /// How many of the "per" amounts the macros were entered for.
    private var factor: Double { perHundred ? amount / 100 : amount }
    private var perText: String { perHundred ? "Por 100 \(unit.rawValue)" : "Por 1 \(unit.label())" }

    private var caffeineTotal: Double? { caffeine.map { ($0 * factor).rounded() } }
    private var alcoholTotal: Double? {
        let q = measure.quantity
        guard q.unit == .ml, let abv, abv > 0 else { return nil }
        return (q.amount * abv / 100 * 0.789 * 10).rounded() / 10
    }

    /// Totals for the amount; kcal from the macros (and alcohol, 7 kcal/g) when left blank.
    private var totals: NutritionMacros {
        var per = NutritionMacros(kcal: kcal ?? 0, protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0, fiber: fiber ?? 0)
        if kcal == nil { per.kcal = per.protein * 4 + per.carbs * 4 + per.fat * 9 }
        var total = per.scaled(by: factor)
        if kcal == nil { total.kcal += ((alcoholTotal ?? 0) * 7).rounded() }
        return total
    }

    var body: some View {
        NavigationStack {
            Form {
                if !store.frequentSnacks.isEmpty {
                    Section("Frecuentes") { frequent }
                }
                Section { hero }
                Section {
                    TextField(placeholder, text: $name)
                        .textInputAutocapitalization(.sentences)
                    Picker("Momento", selection: $slot) {
                        ForEach(MealSlot.allCases) { Text($0.title).tag($0) }
                    }
                    sizeRow
                }
                Section {
                    field("Energía (kcal)", $kcal, Theme.energy)
                    field("Proteína (g)", $protein, Theme.protein)
                    field("Carbohidratos (g)", $carbs, Theme.carbs)
                    field("Grasa (g)", $fat, Theme.fat)
                    field("Fibra (g)", $fiber, .secondary)
                    field("Cafeína (mg)", $caffeine, .brown)
                    if measure.quantity.unit == .ml {
                        field("Alcohol (% vol.)", $abv, Theme.training)
                    }
                } header: {
                    Text(perText)
                } footer: {
                    Label("Las bebidas no suman a tu objetivo de agua.", systemImage: "drop")
                }
            }
            .navigationTitle("Snack o bebida")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar") { Task { await save() } }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || amount <= 0 || saving)
                }
            }
            .sensoryFeedback(.selection, trigger: unit)
            .sensoryFeedback(trigger: amount) { old, new in new > old ? .increase : .decrease }
        }
    }

    // MARK: Parts

    private var frequent: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            GlassEffectContainer(spacing: 8) {
                HStack {
                    ForEach(store.frequentSnacks) { food in
                        Button { Task { await logFrequent(food) } } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Label(food.name, systemImage: food.measure?.unit.systemImage ?? (food.unit == .ml ? "drop.fill" : "carrot.fill"))
                                    .font(.subheadline.weight(.semibold))
                                Text("\(food.amountText) · \(Int(food.kcal)) kcal")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            .lineLimit(1)
                        }
                        .buttonStyle(.glass)
                        .disabled(saving)
                    }
                }
            }
        }
        .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
    }

    /// The amount, big, between − and +; what it comes to; and the unit chips.
    private var hero: some View {
        VStack(spacing: 14) {
            HStack(spacing: 18) {
                stepButton("Menos", "minus", by: -unit.step)
                    .disabled(amount - unit.step < unit.step / 2)
                VStack(spacing: 0) {
                    Text(amount, format: .number.precision(.fractionLength(0...1)))
                        .font(.system(size: 56, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .contentTransition(.numericText(value: amount))
                    Text(unit.label(amount))
                        .font(.headline).foregroundStyle(.secondary)
                        .contentTransition(.interpolate)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .frame(minWidth: 120)
                stepButton("Más", "plus", by: unit.step)
            }
            Text(readout)
                .font(.subheadline.weight(.semibold).monospacedDigit()).fontDesign(.rounded)
                .foregroundStyle(.secondary)
                .contentTransition(.numericText())
            ScrollView(.horizontal, showsIndicators: false) {
                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        ForEach(MeasureUnit.allCases) { unitChip($0) }
                    }
                    .padding(.horizontal, 2)
                }
            }
            .scrollClipDisabled()
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .animation(.snappy, value: amount)
        .animation(.snappy, value: unit)
    }

    /// "= 710 ml · 278 kcal": the normalized amount when it differs from what is shown, and the energy.
    private var readout: String {
        let q = measure.quantity
        var parts: [String] = []
        if unit.isHousehold && q.unit != .serving { parts.append("= \(foodQuantityText(q.amount, q.unit))") }
        if totals.kcal > 0 { parts.append("\(Int(totals.kcal)) kcal") }
        return parts.isEmpty ? " " : parts.joined(separator: " · ")
    }

    private func stepButton(_ title: String, _ symbol: String, by step: Double) -> some View {
        Button(title, systemImage: symbol) { amount = max(unit.step, amount + step) }
            .labelStyle(.iconOnly)
            .font(.title2.weight(.bold))
            .frame(width: 44, height: 44)
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
    }

    @ViewBuilder
    private func unitChip(_ option: MeasureUnit) -> some View {
        let chip = Button { select(option) } label: {
            Label(option.label(), systemImage: option.systemImage)
                .font(.subheadline.weight(.semibold))
                .padding(.vertical, 2)
        }
        if option == unit {
            chip.buttonStyle(.glassProminent)
        } else {
            chip.buttonStyle(.glass)
        }
    }

    /// The exact amount for g and ml; the size of one unit for the rest, with common ones a tap away.
    @ViewBuilder
    private var sizeRow: some View {
        if perHundred {
            numberRow("Cantidad exacta", unit.rawValue, value: Binding(get: { amount }, set: { amount = max(0, $0 ?? 0) }))
        } else if unit.isHousehold {
            numberRow(unit == .unidad ? "Peso por unidad" : "Tamaño de 1 \(unit.label())", unit.base.rawValue,
                      value: Binding(get: { size ?? unit.defaultSize }, set: { size = $0 }))
            if !sizePresets.isEmpty {
                HStack(spacing: 8) {
                    ForEach(sizePresets, id: \.self) { preset in
                        Button("\(Int(preset)) \(unit.base.rawValue)") { size = preset }
                            .buttonStyle(.bordered)
                            .tint((size ?? unit.defaultSize) == preset ? Theme.energy : .secondary)
                            .controlSize(.small)
                    }
                }
            }
        }
    }

    private var sizePresets: [Double] {
        switch unit {
        case .taza: [200, 240, 300]
        case .vaso: [200, 250, 330]
        case .lata: [250, 330, 355, 500]
        case .botella: [330, 500, 750, 1000]
        default: []
        }
    }

    private var placeholder: String {
        switch unit {
        case .taza: "Qué, p. ej. Café con leche"
        case .vaso: "Qué, p. ej. Zumo de naranja"
        case .lata: "Qué, p. ej. Coca-Cola"
        case .botella: "Qué, p. ej. Cerveza"
        case .cucharada: "Qué, p. ej. Crema de cacahuete"
        case .cucharadita: "Qué, p. ej. Azúcar"
        case .unidad: "Qué, p. ej. Galleta Oreo"
        case .puño, .g: "Qué, p. ej. Almendras"
        case .ml: "Qué, p. ej. Leche"
        case .serving: "Qué, p. ej. Barrita de proteína"
        }
    }

    private func numberRow(_ title: String, _ suffix: String, value: Binding<Double?>) -> some View {
        HStack {
            Text(title)
            Spacer(minLength: 8)
            TextField(title, value: value, format: .number.precision(.fractionLength(0...1)))
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 90)
            Text(suffix).foregroundStyle(.secondary)
        }
    }

    private func field(_ title: String, _ value: Binding<Double?>, _ color: Color) -> some View {
        HStack {
            Circle().fill(color).frame(width: 8, height: 8)
            TextField(title, value: value, format: .number.precision(.fractionLength(0...1)))
                .keyboardType(.decimalPad)
        }
    }

    // MARK: Actions

    private func select(_ option: MeasureUnit) {
        guard option != unit else { return }
        unit = option
        amount = option.defaultAmount
        size = nil
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let input = MealInput(name: name.trimmingCharacters(in: .whitespaces), slot: slot, measure: measure, macros: totals,
                              caffeineMg: caffeineTotal, alcoholG: alcoholTotal)
        if await store.log(input) { dismiss() }
    }

    private func logFrequent(_ food: FrequentFood) async {
        saving = true
        defer { saving = false }
        if await store.log(food.input(slot: slot)) { dismiss() }
    }
}

#Preview {
    SnackAddView(store: NutritionStore())
}
