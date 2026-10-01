import SwiftUI

/// Manual entry, with frequent foods on top for one-tap logging.
struct QuickAddView: View {
    let store: NutritionStore
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
                                            Text("\(foodQuantityText(food.quantity, food.unit)) · \(Int(food.kcal)) kcal")
                                                .font(.caption).foregroundStyle(.secondary)
                                        }
                                    }
                                    .buttonStyle(.bordered)
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
                        .frame(width: 160)
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
                                .buttonStyle(.bordered).controlSize(.small)
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
        let input = MealInput(name: food.name, slot: slot, quantity: food.quantity, unit: food.unit, macros: food.macros,
                              source: food.barcode == nil ? "manual" : "barcode", barcode: food.barcode)
        if await store.log(input) { dismiss() }
    }
}

/// Daily kcal and macro targets. The Coach usually sets them; this is the manual override.
struct TargetsView: View {
    let store: NutritionStore
    @Environment(\.dismiss) private var dismiss
    @State private var targets = NutritionTargets(kcal: 2000, protein: 140, carbs: 220, fat: 65, fiber: 28)

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    row("Energía", "kcal", $targets.kcal, Theme.energy)
                    row("Proteína", "g", $targets.protein, Theme.protein)
                    row("Carbohidratos", "g", $targets.carbs, Theme.carbs)
                    row("Grasa", "g", $targets.fat, Theme.fat)
                    row("Fibra", "g", $targets.fiber, .secondary)
                } footer: {
                    let fromMacros = Int(targets.protein * 4 + targets.carbs * 4 + targets.fat * 9)
                    Text("Los macros suman \(fromMacros) kcal.")
                }
            }
            .navigationTitle("Objetivos diarios")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar") {
                        Task {
                            await store.saveTargets(targets)
                            dismiss()
                        }
                    }
                }
            }
            .onAppear { if let current = store.targets { targets = current } }
        }
    }

    private func row(_ title: String, _ unit: String, _ value: Binding<Double>, _ color: Color) -> some View {
        HStack {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(title)
            Spacer()
            TextField(title, value: value, format: .number.precision(.fractionLength(0)))
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 80)
            Text(unit).foregroundStyle(.secondary).frame(width: 34, alignment: .leading)
        }
    }
}
