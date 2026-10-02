import SwiftUI

/// Manual entry, with frequent foods on top for one-tap logging.
struct QuickAddView: View {
    let store: NutritionStore
    /// What was typed in Registrar's search, so it isn't typed twice.
    var initialName = ""
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var slot = MealSlot.forHour(Calendar.current.component(.hour, from: .now))
    @State private var quantity: Double = 100
    @State private var unit = FoodUnit.g
    @State private var kcal: Double?
    @State private var protein: Double?
    @State private var carbs: Double?
    @State private var fat: Double?
    @State private var fiber: Double?
    @State private var saving = false

    private var macros: NutritionMacros {
        NutritionMacros(kcal: kcal ?? 0, protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0, fiber: fiber ?? 0)
    }

    /// Kcal from macros when left blank: 4/4/9.
    private var estimatedKcal: Double { (protein ?? 0) * 4 + (carbs ?? 0) * 4 + (fat ?? 0) * 9 }

    var body: some View {
        NavigationStack {
            Form {
                if !store.frequent.isEmpty {
                    Section("Frecuentes") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack {
                                ForEach(store.frequent) { food in
                                    Button { Task { await logFrequent(food) } } label: {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(food.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                                            Text("\(food.amountText) · \(Int(food.kcal)) kcal")
                                                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                        }
                                    }
                                    .buttonStyle(.glass)
                                    .disabled(saving)
                                }
                            }
                        }
                        .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                    }
                }
                Section("Alimento") {
                    TextField("Nombre", text: $name)
                    Picker("Momento", selection: $slot) {
                        ForEach(MealSlot.allCases) { Text($0.title).tag($0) }
                    }
                    HStack {
                        TextField("Cantidad", value: $quantity, format: .number.precision(.fractionLength(0...1)))
                            .keyboardType(.decimalPad)
                        Picker("", selection: $unit) {
                            ForEach(FoodUnit.allCases, id: \.self) { Text($0.label).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .frame(maxWidth: 180)
                        .layoutPriority(1)
                    }
                }
                Section {
                    field("Proteína (g)", $protein, Theme.protein)
                    field("Carbohidratos (g)", $carbs, Theme.carbs)
                    field("Grasa (g)", $fat, Theme.fat)
                    field("Fibra (g)", $fiber, .secondary)
                    HStack {
                        field("Energía (kcal)", $kcal, Theme.energy)
                        if kcal == nil && estimatedKcal > 0 {
                            Button("≈ \(Int(estimatedKcal))") { kcal = estimatedKcal.rounded() }
                                .buttonStyle(.glass).controlSize(.small)
                        }
                    }
                } header: {
                    Text("Macros de esta cantidad")
                }
            }
            .navigationTitle("Añadir comida")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar") { Task { await save() } }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || quantity <= 0 || saving)
                }
            }
            .onAppear { if name.isEmpty { name = initialName } }
        }
    }

    private func field(_ title: String, _ value: Binding<Double?>, _ color: Color) -> some View {
        HStack {
            Circle().fill(color).frame(width: 8, height: 8)
            TextField(title, value: value, format: .number.precision(.fractionLength(0...1)))
                .keyboardType(.decimalPad)
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        var m = macros
        if kcal == nil { m.kcal = estimatedKcal.rounded() }
        let input = MealInput(name: name.trimmingCharacters(in: .whitespaces), slot: slot, quantity: quantity, unit: unit, macros: m)
        if await store.log(input) { dismiss() }
    }

    private func logFrequent(_ food: FrequentFood) async {
        saving = true
        defer { saving = false }
        if await store.log(food.input(slot: slot)) { dismiss() }
    }
}

/// Daily kcal and macro targets. The Coach usually sets them; this is the manual override.
struct TargetsView: View {
    let store: NutritionStore
    @Environment(\.dismiss) private var dismiss
    /// "kcal" no longer fits a fixed 34 pt at large text; the column grows with it.
    @ScaledMetric private var unitWidth: CGFloat = 38
    @ScaledMetric private var fieldWidth: CGFloat = 80
    @State private var targets = NutritionTargets(kcal: 2000, protein: 140, carbs: 220, fat: 65, fiber: 28)
    @State private var saved: NutritionTargets?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    row("Energía", "kcal", "kcal", $targets.kcal, Theme.energy)
                    row("Proteína", "protein", "g", $targets.protein, Theme.protein)
                    row("Carbohidratos", "carbs", "g", $targets.carbs, Theme.carbs)
                    row("Grasa", "fat", "g", $targets.fat, Theme.fat)
                    row("Fibra", "fiber", "g", $targets.fiber, .secondary)
                } footer: {
                    let fromMacros = Int(targets.protein * 4 + targets.carbs * 4 + targets.fat * 9)
                    Text("Los macros suman \(fromMacros) kcal. Cada objetivo tiene su zona, la franja verde de los anillos; al cambiarlo, el Coach la recalcula.")
                }
            }
            .navigationTitle("Objetivos diarios")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar") {
                        Task {
                            await store.saveTargets(keepingCustomZones(targets))
                            dismiss()
                        }
                    }
                }
            }
            .onAppear {
                if let current = store.targets {
                    targets = current
                    saved = current
                }
            }
        }
    }

    /// Sends back only the zones set by hand whose target did not change; the rest are derived again.
    private func keepingCustomZones(_ targets: NutritionTargets) -> NutritionTargets {
        var out = targets
        out.zones = saved?.zones?.filter { key, zone in zone.custom && saved?[key] == targets[key] }
        return out
    }

    private func row(_ title: String, _ key: String, _ unit: String, _ value: Binding<Double>, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Circle().fill(color).frame(width: 8, height: 8)
                Text(title).lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 8)
                TextField(title, value: value, format: .number.precision(.fractionLength(0)))
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: fieldWidth)
                Text(unit).foregroundStyle(.secondary).lineLimit(1).frame(width: unitWidth, alignment: .leading)
            }
            // The zone as it stands; once the target changes it is recalculated on save.
            if let zone = saved?.zones?[key], saved?[key] == value.wrappedValue {
                Text("Zona: \(zoneText(zone, unit))\(zone.custom ? " · a tu medida" : "")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.leading, 16)
            }
        }
    }

    private func zoneText(_ zone: TargetZone, _ unit: String) -> String {
        let n = { (v: Double?) in Int((v ?? 0).rounded()).formatted() }
        switch zone.kind {
        case .min: return "mínimo \(n(zone.min)) \(unit)"
        case .max: return "máximo \(n(zone.max)) \(unit)"
        case .range: return "\(n(zone.min))–\(n(zone.max)) \(unit)"
        }
    }
}
