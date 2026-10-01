import Foundation

/// `/api/mobile/nutrition/dishes/*` and `/meals/dish/*`: dishes eaten and Mis platillos.
/// A `MealInput` doubles as a component: the Mac ignores its slot and time.
extension PulsoAPI {
    private struct DishResponse: Decodable { var dish: SavedDish }
    private struct DishMeals: Decodable { var meals: [MealEntry] }
    private struct MealResponse: Decodable { var meal: MealEntry }
    private struct Deleted: Decodable { var deleted: String }

    /// «Guardar como platillo»: a dish eaten, as it was eaten.
    func saveLoggedDish(_ dishId: String) async throws -> SavedDish {
        let response: DishResponse = try await call("api/mobile/nutrition/dishes", method: "POST", body: ["loggedDishId": dishId])
        return response.dish
    }

    /// One portion of a plan recipe as a saved dish.
    func saveRecipeAsDish(_ recipeId: String) async throws -> SavedDish {
        let response: DishResponse = try await call("api/mobile/nutrition/dishes", method: "POST", body: ["recipeId": recipeId])
        return response.dish
    }

    func deleteSavedDish(_ id: String) async throws {
        let _: Deleted = try await call("api/mobile/nutrition/dishes/\(id)", method: "DELETE")
    }

    /// Logs a saved dish: `scale` 0.5 for half, components at `removed` (indices) left out this time.
    func logSavedDish(_ id: String, scale: Double, removed: [Int], slot: MealSlot?, eatenAt: Double, date: String, slotId: String?) async throws -> [MealEntry] {
        struct Override: Encodable { var component: Int; var remove = true }
        struct Body: Encodable { var scale: Double; var overrides: [Override]; var slot: MealSlot?; var eatenAt: Double; var date: String; var slotId: String? }
        let body = Body(scale: scale, overrides: removed.map { Override(component: $0) }, slot: slot, eatenAt: eatenAt, date: date, slotId: slotId)
        let response: DishMeals = try await call("api/mobile/nutrition/dishes/\(id)/log", method: "POST", body: body)
        return response.meals
    }

    /// «Crear platillo»: foods eaten together, logged as one dish (named from the foods when `name` is nil).
    func logDish(name: String?, components: [MealInput], slot: MealSlot, eatenAt: Double, date: String, slotId: String?) async throws -> [MealEntry] {
        struct Body: Encodable { var name: String?; var components: [MealInput]; var slot: MealSlot; var eatenAt: Double; var date: String; var slotId: String? }
        let response: DishMeals = try await call("api/mobile/nutrition/meals/dish", method: "POST",
                                                 body: Body(name: name, components: components, slot: slot, eatenAt: eatenAt, date: date, slotId: slotId))
        return response.meals
    }

    /// Adds foods to a dish eaten, at its time and meal.
    func addToDish(_ dishId: String, components: [MealInput]) async throws -> [MealEntry] {
        let response: DishMeals = try await call("api/mobile/nutrition/meals/dish/\(dishId)", method: "PATCH", body: ["add": components])
        return response.meals
    }

    /// Corrects one entry (a dish component keeps its dish, time and meal). The entry gets a new id.
    func updateMeal(_ id: String, _ input: MealInput) async throws -> MealEntry {
        let response: MealResponse = try await call("api/mobile/nutrition/meals/\(id)", method: "PUT", body: input)
        return response.meal
    }
}
