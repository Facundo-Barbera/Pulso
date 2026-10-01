import Foundation

/// The dish (platillo) an entry is a component of: foods eaten together as one thing.
struct DishRef: Codable, Equatable, Hashable {
    var id: String
    var name: String
    /// The saved dish it was logged from, if any.
    var savedDishId: String?
}

/// One food of a saved dish at its default portion. Macros are totals for its amount.
struct DishComponent: Codable, Equatable {
    var name: String
    var quantity: Double
    var unit: FoodUnit
    var measure: Measure?
    var barcode: String?
    var kcal: Double
    var protein: Double
    var carbs: Double
    var fat: Double
    var fiber: Double
    var caffeineMg: Double?
    var alcoholG: Double?

    var amountText: String { foodAmountText(quantity, unit, measure: measure) }
}

/// Mis platillos: a dish logged in one tap, optionally scaled or with something left out.
struct SavedDish: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    /// The meal it is usually eaten as; nil when it varies.
    var slot: MealSlot?
    var components: [DishComponent]
    var macros: NutritionMacros
    var recipeId: String?
    var uses: Int
    var lastUsedAt: Double?
}

/// A day's entries as the person sees them: a dish with its components, or a food on its own.
enum LoggedItem: Identifiable, Equatable {
    case food(MealEntry)
    case dish(DishRef, [MealEntry])

    var id: String {
        switch self {
        case .food(let meal): meal.id
        case .dish(let dish, _): dish.id
        }
    }

    var name: String {
        switch self {
        case .food(let meal): meal.name
        case .dish(let dish, _): dish.name
        }
    }

    /// In eating order; a dish where its first component is.
    static func group(_ meals: [MealEntry]) -> [LoggedItem] {
        var items: [LoggedItem] = []
        for meal in meals {
            guard let dish = meal.dish else {
                items.append(.food(meal))
                continue
            }
            if let i = items.firstIndex(where: { $0.id == dish.id }), case .dish(let ref, let parts) = items[i] {
                items[i] = .dish(ref, parts + [meal])
            } else {
                items.append(.dish(dish, [meal]))
            }
        }
        return items
    }
}

extension MealEntry {
    /// This entry as it would be logged again (for a one-off correction of its amount).
    func input(scaledBy factor: Double) -> MealInput {
        let m = macros
        let scaled = NutritionMacros(kcal: (m.kcal * factor).rounded(), protein: m.protein * factor, carbs: m.carbs * factor,
                                     fat: m.fat * factor, fiber: m.fiber * factor)
        var input = MealInput(name: name, slot: slot, quantity: quantity * factor, unit: unit, macros: scaled, source: source, barcode: barcode,
                              measure: measure.map { Measure(amount: $0.amount * factor, unit: $0.unit, size: $0.size) },
                              caffeineMg: caffeineMg.map { $0 * factor }, alcoholG: alcoholG.map { $0 * factor })
        input.eatenAt = eatenAt
        input.date = date
        return input
    }
}
