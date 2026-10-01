import SwiftUI

/// What a dish row can do, set once by the Dieta tab so every list of entries gets it.
struct DishActions {
    var save: (DishRef) -> Void = { _ in }
    var add: (MealInput, DishRef) async -> Bool = { _, _ in false }
    var update: (MealEntry, Double) async -> Bool = { _, _ in false }
}

extension EnvironmentValues {
    @Entry var dishActions = DishActions()
}

/// Entries as the person thinks of them: dishes folded to one line, foods on their own as before.
struct LoggedList: View {
    let meals: [MealEntry]
    let onDelete: ((MealEntry) -> Void)?

    var body: some View {
        let items = LoggedItem.group(meals)
        ForEach(items) { item in
            switch item {
            case .food(let meal):
                if let onDelete {
                    SwipeToDelete { onDelete(meal) } content: { MealRow(meal: meal) }
                } else {
                    MealRow(meal: meal)
                }
            case .dish(let dish, let parts):
                DishRow(dish: dish, parts: parts, onDelete: onDelete)
            }
            if item.id != items.last?.id { Divider() }
        }
    }
}

/// A dish eaten: its name and total; open it for the components (tap one to change
/// its amount, swipe to delete), add one, or keep it in Mis platillos.
struct DishRow: View {
    let dish: DishRef
    let parts: [MealEntry]
    let onDelete: ((MealEntry) -> Void)?
    @Environment(\.dishActions) private var actions
    @State private var expanded = false
    @State private var editing: MealEntry?
    @State private var adding = false

    private var kcal: Double { parts.reduce(0) { $0 + $1.kcal } }
    private var protein: Double { parts.reduce(0) { $0 + $1.protein } }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button { withAnimation(.snappy) { expanded.toggle() } } label: { header }
                .buttonStyle(.plain)
            if expanded {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(parts) { meal in
                        Button { editing = meal } label: { MealRow(meal: meal) }
                            .buttonStyle(.plain)
                            .accessibilityHint("Cambia la cantidad")
                            .modifier(DeletableIf(onDelete: onDelete.map { delete in { delete(meal) } }))
                        Divider()
                    }
                    HStack(spacing: 8) {
                        Button("Añadir", systemImage: "plus") { adding = true }
                        Spacer(minLength: 4)
                        if dish.savedDishId == nil {
                            Button("Guardar como platillo", systemImage: "bookmark") { actions.save(dish) }
                        } else {
                            Label("En Mis platillos", systemImage: "bookmark.fill").foregroundStyle(.secondary)
                        }
                    }
                    .font(.footnote.weight(.semibold))
                    .buttonStyle(.borderless)
                    .padding(.top, 8)
                }
                .padding(.leading, 14)
                .overlay(alignment: .leading) { Rectangle().fill(.quaternary).frame(width: 2) }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(.vertical, 4)
        .sensoryFeedback(.selection, trigger: expanded)
        .sheet(item: $editing) { meal in
            ComponentAmountSheet(meal: meal) { factor in await actions.update(meal, factor) }
                .presentationDetents([.medium])
        }
        .sheet(isPresented: $adding) {
            ComponentForm(title: "Añadir a \(dish.name)", slot: parts.first?.slot ?? .comida) { input in await actions.add(input, dish) }
                .presentationDetents([.large])
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "fork.knife.circle.fill")
                .font(.title3)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(Theme.energy)
            VStack(alignment: .leading, spacing: 3) {
                Text(dish.name).font(.subheadline.weight(.semibold)).lineLimit(2)
                Text("\(parts.count) \(parts.count == 1 ? "ingrediente" : "ingredientes") · \(Int(protein.rounded())) g proteína")
                    .font(.caption.monospacedDigit()).fontDesign(.rounded)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Text("\(Int(kcal)) kcal")
                .font(.subheadline.weight(.semibold).monospacedDigit()).fontDesign(.rounded)
                .contentTransition(.numericText(value: kcal))
                .layoutPriority(1)
            Image(systemName: "chevron.down")
                .font(.caption.weight(.bold)).foregroundStyle(.tertiary)
                .rotationEffect(.degrees(expanded ? 0 : -90))
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint(expanded ? "Pliega" : "Muestra los ingredientes")
    }
}

/// Swipe to delete only where deleting is offered.
private struct DeletableIf: ViewModifier {
    let onDelete: (() -> Void)?

    func body(content: Content) -> some View {
        if let onDelete {
            SwipeToDelete(onDelete: onDelete) { content }
        } else {
            content
        }
    }
}

/// One component's amount, corrected: its macros follow in proportion.
struct ComponentAmountSheet: View {
    let meal: MealEntry
    let onSave: (Double) async -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var amount: Double = 0
    @State private var saving = false

    /// What the person said ("2 latas") when there is a measure, else the normalized amount.
    private var base: Double { meal.measure?.amount ?? meal.quantity }
    private var unitText: String { meal.measure.map { $0.unit.rawValue } ?? meal.unit.label }
    private var factor: Double { base > 0 ? amount / base : 1 }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        TextField("Cantidad", value: $amount, format: .number.precision(.fractionLength(0...2)))
                            .keyboardType(.decimalPad)
                            .font(.title2.weight(.semibold).monospacedDigit()).fontDesign(.rounded)
                        Text(unitText).foregroundStyle(.secondary)
                    }
                } header: {
                    Text(meal.name)
                } footer: {
                    Text("\(Int((meal.kcal * factor).rounded())) kcal · \(Int((meal.protein * factor).rounded())) g proteína")
                        .monospacedDigit()
                        .contentTransition(.numericText())
                }
            }
            .navigationTitle("Cantidad")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar") {
                        Task {
                            saving = true
                            if await onSave(factor) { dismiss() }
                            saving = false
                        }
                    }
                    .disabled(amount <= 0 || amount == base || saving)
                }
            }
            .onAppear { amount = base }
        }
    }
}

/// A food for a dish, typed in: name, amount and the macros of that amount.
struct ComponentForm: View {
    let title: String
    let slot: MealSlot
    let onSave: (MealInput) async -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var quantity: Double = 100
    @State private var unit = FoodUnit.g
    @State private var kcal: Double?
    @State private var protein: Double?
    @State private var carbs: Double?
    @State private var fat: Double?
    @State private var saving = false

    private var estimatedKcal: Double { (protein ?? 0) * 4 + (carbs ?? 0) * 4 + (fat ?? 0) * 9 }
    private var input: MealInput {
        MealInput(name: name.trimmingCharacters(in: .whitespaces), slot: slot, quantity: quantity, unit: unit,
                  macros: NutritionMacros(kcal: kcal ?? estimatedKcal.rounded(), protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0, fiber: 0))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Ingrediente") {
                    TextField("Nombre", text: $name)
                    HStack {
                        TextField("Cantidad", value: $quantity, format: .number.precision(.fractionLength(0...1)))
                            .keyboardType(.decimalPad)
                        Picker("", selection: $unit) {
                            ForEach(FoodUnit.allCases, id: \.self) { Text($0.label).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .frame(maxWidth: 180)
                    }
                }
                Section("Macros de esta cantidad") {
                    field("Proteína (g)", $protein, Theme.protein)
                    field("Carbohidratos (g)", $carbs, Theme.carbs)
                    field("Grasa (g)", $fat, Theme.fat)
                    field(kcal == nil && estimatedKcal > 0 ? "Energía (≈ \(Int(estimatedKcal)) kcal)" : "Energía (kcal)", $kcal, Theme.energy)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Añadir") {
                        Task {
                            saving = true
                            if await onSave(input) { dismiss() }
                            saving = false
                        }
                    }
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
}

/// A saved dish, this time: a portion (½ to 2) and anything left out.
struct DishLogSheet: View {
    let dish: SavedDish
    let onLog: (Double, [Int]) async -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var scale: Double = 1
    @State private var removed: Set<Int> = []
    @State private var saving = false

    private let portions: [(Double, String)] = [(0.5, "½"), (1, "1"), (1.5, "1½"), (2, "2")]
    private var kcal: Double {
        dish.components.enumerated().filter { !removed.contains($0.offset) }.reduce(0) { $0 + $1.element.kcal } * scale
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 4) {
                        Text("\(Int(kcal.rounded()))")
                            .font(.system(size: 44, weight: .bold, design: .rounded).monospacedDigit())
                            .contentTransition(.numericText(value: kcal))
                        Text("kcal").font(.subheadline).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                    Picker("Porción", selection: $scale.animation(.snappy)) {
                        ForEach(portions, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    .pickerStyle(.segmented)
                } header: {
                    Text("Porción")
                }
                Section {
                    ForEach(Array(dish.components.enumerated()), id: \.offset) { i, c in
                        Toggle(isOn: Binding(get: { !removed.contains(i) }, set: { on in
                            withAnimation(.snappy) { if on { removed.remove(i) } else { removed.insert(i) } }
                        })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(c.name).lineLimit(2)
                                Text("\(c.amountText) · \(Int((c.kcal * scale).rounded())) kcal")
                                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                            }
                        }
                    }
                } header: {
                    Text("Ingredientes")
                } footer: {
                    Text("Solo esta vez: tu platillo guardado no cambia.")
                }
            }
            .navigationTitle(dish.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Registrar") {
                        Task {
                            saving = true
                            if await onLog(scale, removed.sorted()) { dismiss() }
                            saving = false
                        }
                    }
                    .disabled(saving || removed.count == dish.components.count)
                }
            }
            .sensoryFeedback(.selection, trigger: scale)
        }
    }
}

/// «Crear platillo»: name it (or let the Mac), add its foods from the frequent ones
/// or by hand, and log it as one meal — optionally kept in Mis platillos.
struct DishBuilderView: View {
    let store: NutritionStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var slot = MealSlot.forHour(Calendar.current.component(.hour, from: .now))
    @State private var parts: [MealInput] = []
    @State private var keep = true
    @State private var typing = false
    @State private var saving = false

    private var kcal: Double { parts.reduce(0) { $0 + $1.kcal } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Nombre (opcional)", text: $name, prompt: Text("Batido de proteína con fresas"))
                    Picker("Momento", selection: $slot) {
                        ForEach(MealSlot.allCases) { Label($0.title, systemImage: $0.systemImage).tag($0) }
                    }
                } footer: {
                    Text("Sin nombre, se nombra solo por lo que lleva.")
                }
                Section {
                    if parts.isEmpty {
                        Label("Añade lo que lleva", systemImage: "fork.knife")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(Array(parts.enumerated()), id: \.offset) { _, part in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(part.name)
                                Text(foodAmountText(part.quantity, part.unit, measure: part.measure))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 8)
                            Text("\(Int(part.kcal)) kcal").font(.subheadline.monospacedDigit()).fontDesign(.rounded)
                        }
                    }
                    .onDelete { parts.remove(atOffsets: $0) }
                    Button("Escribir un ingrediente", systemImage: "square.and.pencil") { typing = true }
                } header: {
                    Text(parts.isEmpty ? "Ingredientes" : "Ingredientes · \(Int(kcal)) kcal")
                        .contentTransition(.numericText())
                }
                if !store.allFrequent.isEmpty {
                    Section("De tus frecuentes") {
                        ForEach(store.allFrequent) { food in
                            Button {
                                withAnimation(.snappy) { parts.append(food.input(slot: slot)) }
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(food.name).foregroundStyle(.primary)
                                        Text("\(food.amountText) · \(Int(food.kcal)) kcal").font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer(minLength: 8)
                                    Image(systemName: "plus.circle.fill").font(.title3).foregroundStyle(Theme.energy)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                Section {
                    Toggle("Guardar en Mis platillos", systemImage: "bookmark", isOn: $keep)
                }
            }
            .navigationTitle("Crear platillo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Registrar") {
                        Task {
                            saving = true
                            let trimmed = name.trimmingCharacters(in: .whitespaces)
                            if await store.logDish(name: trimmed.isEmpty ? nil : trimmed, components: parts, slot: slot, keep: keep) { dismiss() }
                            saving = false
                        }
                    }
                    .disabled(parts.isEmpty || saving)
                }
            }
            .sheet(isPresented: $typing) {
                ComponentForm(title: "Ingrediente", slot: slot) { input in
                    withAnimation(.snappy) { parts.append(input) }
                    return true
                }
            }
            .sensoryFeedback(.selection, trigger: parts.count)
        }
    }
}

// MARK: - Previews

private let previewShake = DishRef(id: "d", name: "Batido de proteína con fresas", savedDishId: nil)

#Preview("Platillo · 375 pt · XXL") {
    NarrowPreview(dynamicType: .xxLarge) {
        Card {
            LoggedList(meals: [
                MealEntry(id: "1", date: "2026-10-01", eatenAt: 1_790_870_700_000, slot: .snack,
                          name: "Proteína whey (1 scoop 25 g) con leche Lala 100 +Proteína Light (500 ml)", quantity: 500, unit: .ml,
                          kcal: 320, protein: 50, carbs: 28, fat: 6, fiber: 0, source: "agent", dish: previewShake),
                MealEntry(id: "2", date: "2026-10-01", eatenAt: 1_790_870_700_000, slot: .snack, name: "Fresas (5 medianas, en el batido)",
                          quantity: 60, unit: .g, kcal: 27, protein: 0.5, carbs: 6, fat: 0.2, fiber: 1, source: "agent", dish: previewShake),
                MealEntry(id: "3", date: "2026-10-01", eatenAt: 1_790_877_600_000, slot: .snack, name: "Almendras",
                          quantity: 30, unit: .g, kcal: 174, protein: 6, carbs: 7, fat: 15, fiber: 4, source: "agent"),
            ]) { _ in }
        }
    }
}

#Preview("Ajustar platillo") {
    DishLogSheet(dish: SavedDish(id: "s", name: "Batido de proteína", slot: nil, components: [
        DishComponent(name: "Proteína whey", quantity: 25, unit: .g, kcal: 100, protein: 20, carbs: 3, fat: 1.5, fiber: 0),
        DishComponent(name: "Leche Lala 100 Proteína Light", quantity: 500, unit: .ml, kcal: 220, protein: 30, carbs: 25, fat: 5, fiber: 0),
    ], macros: NutritionMacros(kcal: 320, protein: 50, carbs: 28, fat: 6.5, fiber: 0), uses: 4)) { _, _ in true }
}
