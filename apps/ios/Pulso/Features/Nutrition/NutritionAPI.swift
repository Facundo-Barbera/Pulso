import Foundation

/// `/api/mobile/nutrition/*`.
extension PulsoAPI {
    private struct MealResponse: Decodable { var meal: MealEntry }
    private struct MealsResponse: Decodable { var meals: [MealEntry] }
    private struct HistoryResponse: Decodable { var days: [NutritionSummary] }
    private struct FrequentResponse: Decodable { var foods: [FrequentFood] }
    private struct TargetsResponse: Decodable { var targets: NutritionTargets? }
    private struct ProductResponse: Decodable { var product: FoodProduct? }
    private struct Deleted: Decodable { var deleted: String }

    private func get<Response: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> Response {
        var request = makeRequest(path, method: "GET")
        if !query.isEmpty { request.url = request.url?.appending(queryItems: query) }
        return try await perform(request)
    }

    func nutritionDay(_ date: String) async throws -> NutritionDay {
        try await get("api/mobile/nutrition/day", query: [URLQueryItem(name: "date", value: date)])
    }

    func nutritionHistory(days: Int, to: String) async throws -> [NutritionSummary] {
        let response: HistoryResponse = try await get("api/mobile/nutrition/history", query: [
            URLQueryItem(name: "days", value: String(days)), URLQueryItem(name: "to", value: to),
        ])
        return response.days
    }

    func frequentFoods() async throws -> [FrequentFood] {
        let response: FrequentResponse = try await get("api/mobile/nutrition/frequent")
        return response.foods
    }

    func logMeal(_ input: MealInput) async throws -> MealEntry {
        let response: MealResponse = try await call("api/mobile/nutrition/meals", method: "POST", body: input)
        return response.meal
    }

    func deleteMeal(_ id: String) async throws {
        let _: Deleted = try await call("api/mobile/nutrition/meals/\(id)", method: "DELETE")
    }

    func copyMeals(from: String, to: String) async throws -> [MealEntry] {
        let response: MealsResponse = try await call("api/mobile/nutrition/meals/copy", method: "POST", body: ["from": from, "to": to])
        return response.meals
    }

    func eatPlanItem(_ itemId: String, date: String) async throws -> MealEntry {
        let response: MealResponse = try await call("api/mobile/nutrition/plan/eat", method: "POST", body: ["itemId": itemId, "date": date])
        return response.meal
    }

    func setTargets(_ targets: NutritionTargets) async throws -> NutritionTargets? {
        let response: TargetsResponse = try await call("api/mobile/nutrition/targets", method: "PUT", body: targets)
        return response.targets
    }

    func lookupBarcode(_ code: String) async throws -> FoodProduct? {
        let response: ProductResponse = try await get("api/mobile/nutrition/barcode/\(code)")
        return response.product
    }
}
