import SwiftUI

/// "Registrar": every way to add food from one place. Search the frequent foods
/// (or type a new one), jump to scanning, a snack or drink, or the plan, and eat
/// the next planned meal in one tap. Logging a frequent food keeps the sheet
/// open, so a breakfast of three things is three taps.
struct RegisterSheet: View {
    let foods: [FrequentFood]
    /// The next planned meal of today, for "Comí lo del plan".
    let nextMeal: DietPlanForDay.Meal?
    /// "Registrar lo que comí": the planned meal what is logged here is the real meal of.
    var replacing: PlanSlot? = nil
    let onLog: (MealInput) async -> Bool
    let onEatPlan: (DietPlanForDay.Meal) async -> Bool
    let onRoute: (Route) -> Void

    enum Route: Equatable {
        /// `photo`: the Coach, camera open, to log what it sees.
        case scan, snack, plan, photo
        /// The manual form, with what was typed as the name.
        case manual(String)
    }

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var slot = MealSlot.forHour(Calendar.current.component(.hour, from: .now))
    @State private var didPreset = false
    @State private var logged: Set<String> = []
    @State private var busy = false
    @State private var planEaten = false

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }
    private var matches: [FrequentFood] {
        trimmed.isEmpty ? foods : foods.filter { $0.name.localizedStandardContains(trimmed) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            chip("Foto de comida", "camera.fill") { onRoute(.photo) }
                            chip("Escanear", "barcode.viewfinder") { onRoute(.scan) }
                            chip("Snack o bebida", "cup.and.saucer.fill") { onRoute(.snack) }
                            if replacing == nil { chip("Del plan", "list.bullet.clipboard") { onRoute(.plan) } }
                            chip("A mano", "square.and.pencil") { onRoute(.manual(trimmed)) }
                        }
                        .padding(.horizontal, 2)
                    }
                    .scrollClipDisabled()
                    .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
                    Picker("Momento", selection: $slot) {
                        ForEach(MealSlot.allCases) { Label($0.title, systemImage: $0.systemImage).tag($0) }
                    }
                }

                if let replacing {
                    Section {
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Tu \(replacing.slot.title.lowercased()) de verdad")
                                    .font(.subheadline.weight(.semibold))
                                Text("Planeado: \(replacing.what)").font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                        } icon: {
                            Image(systemName: "fork.knife").foregroundStyle(Theme.body)
                        }
                    } footer: {
                        Text("Registra lo que comiste; al cerrar, es lo que comiste en esa comida.")
                    }
                } else if trimmed.isEmpty, let nextMeal, !planEaten {
                    planSection(nextMeal)
                }

                if !matches.isEmpty {
                    Section(trimmed.isEmpty ? "Frecuentes" : "Resultados") {
                        ForEach(matches) { food in foodRow(food) }
                    }
                }

                if !trimmed.isEmpty {
                    Section {
                        Button { onRoute(.manual(trimmed)) } label: {
                            Label("Añadir «\(trimmed)» a mano", systemImage: "square.and.pencil")
                        }
                    } footer: {
                        if matches.isEmpty { Text("No está entre tus frecuentes. Escribe sus macros o cuéntaselo al Coach.") }
                    }
                } else if foods.isEmpty && nextMeal == nil {
                    Section {
                        ContentUnavailableView("Aún no hay frecuentes", systemImage: "fork.knife",
                                               description: Text("Lo que registres aparecerá aquí para añadirlo en un toque."))
                    }
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Buscar o escribir un alimento")
            .navigationTitle(replacing == nil ? "Registrar" : "Lo cambié por…")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(logged.isEmpty && !planEaten ? "Cerrar" : "Listo") { dismiss() }
                }
            }
            .onAppear {
                guard !didPreset, let replacing else { return }
                slot = replacing.slot
                didPreset = true
            }
            .sensoryFeedback(.success, trigger: logged.count) { old, new in new > old }
            .sensoryFeedback(.success, trigger: planEaten) { _, new in new }
        }
    }

    // MARK: Parts

    private func chip(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .fixedSize()
                .padding(.vertical, 2)
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
    }

    private func planSection(_ meal: DietPlanForDay.Meal) -> some View {
        let kcal = Int(meal.items.reduce(0) { $0 + $1.kcal })
        return Section {
            ForEach(meal.items) { item in
                HStack {
                    Text(item.name)
                    Spacer(minLength: 8)
                    Text(foodQuantityText(item.quantity, item.unit))
                        .font(.subheadline.monospacedDigit()).fontDesign(.rounded)
                        .foregroundStyle(.secondary)
                }
            }
            Button {
                Task {
                    busy = true
                    if await onEatPlan(meal) { withAnimation(.snappy) { planEaten = true } }
                    busy = false
                }
            } label: {
                Label("Comí lo del plan", systemImage: "checkmark.circle.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.body)
            .disabled(busy)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        } header: {
            Text("Siguiente en tu plan · \(meal.slot.title) · \(kcal) kcal")
        }
    }

    private func foodRow(_ food: FrequentFood) -> some View {
        let done = logged.contains(food.id)
        return Button {
            Task {
                busy = true
                if await onLog(food.input(slot: slot)) { withAnimation(.snappy) { _ = logged.insert(food.id) } }
                busy = false
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: food.measure?.unit.systemImage ?? (food.unit == .ml ? "drop.fill" : "fork.knife"))
                    .font(.subheadline)
                    .foregroundStyle(Theme.energy)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(food.name).foregroundStyle(.primary)
                    Text("\(food.amountText) · \(Int(food.kcal)) kcal")
                        .font(.caption.monospacedDigit()).fontDesign(.rounded)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Image(systemName: done ? "checkmark.circle.fill" : "plus.circle.fill")
                    .font(.title2)
                    .foregroundStyle(done ? Theme.body : Theme.energy)
                    .contentTransition(.symbolEffect(.replace))
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityLabel(done ? "\(food.name), añadido" : "Añadir \(food.name)")
    }
}

// MARK: - Previews

private let previewFoods = [
    FrequentFood(name: "Café con leche", quantity: 240, unit: .ml, measure: Measure(amount: 1, unit: .taza), slot: .snack,
                 count: 12, kcal: 90, protein: 5, carbs: 7, fat: 4, fiber: 0),
    FrequentFood(name: "Avena con leche", quantity: 1, unit: .serving, slot: .desayuno, count: 8,
                 kcal: 385, protein: 17, carbs: 58, fat: 9, fiber: 7),
    FrequentFood(name: "Almendras", quantity: 30, unit: .g, measure: Measure(amount: 1, unit: .puño), slot: .snack,
                 count: 5, kcal: 174, protein: 6, carbs: 7, fat: 15, fiber: 4),
]

#Preview("Registrar") {
    RegisterSheet(
        foods: previewFoods,
        nextMeal: DietPlanForDay.Meal(slot: .desayuno, name: nil, items: [
            DietPlanItem(id: "p", name: "Pan integral", quantity: 60, unit: .g, kcal: 150, protein: 6, carbs: 28, fat: 2, fiber: 4),
            DietPlanItem(id: "h", name: "Huevos enteros", quantity: 2, unit: .serving, kcal: 156, protein: 13, carbs: 1, fat: 11, fiber: 0),
        ]),
        onLog: { _ in true }, onEatPlan: { _ in true }, onRoute: { _ in }
    )
}

#Preview("Lo cambié por… · XXL") {
    RegisterSheet(foods: previewFoods, nextMeal: nil, replacing: previewSlots[1], onLog: { _ in true }, onEatPlan: { _ in true }, onRoute: { _ in })
        .dynamicTypeSize(.xxLarge)
}

#Preview("Registrar · vacío · XXL") {
    RegisterSheet(foods: [], nextMeal: nil, onLog: { _ in true }, onEatPlan: { _ in true }, onRoute: { _ in })
        .dynamicTypeSize(.xxLarge)
}
