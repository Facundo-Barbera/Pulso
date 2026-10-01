import Foundation

/// `/api/mobile/nutrition/*`.
extension PulsoAPI {
    private struct MealResponse: Decodable { var meal: MealEntry }
    private struct MealsResponse: Decodable { var meals: [MealEntry] }
    private struct HistoryResponse: Decodable { var days: [NutritionSummary]; var water: [String: Double]? }
    private struct WaterLogged: Decodable { var entry: WaterEntry; var day: WaterDay }
    private struct WaterSettingsResponse: Decodable { var settings: WaterSettings }
    private struct Cleared: Decodable { var cleared: Bool }
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

    /// Daily summaries, and water ml by `YYYY-MM-DD` (days without water are absent).
    func nutritionHistory(days: Int, to: String) async throws -> (days: [NutritionSummary], water: [String: Double]) {
        let response: HistoryResponse = try await get("api/mobile/nutrition/history", query: [
            URLQueryItem(name: "days", value: String(days)), URLQueryItem(name: "to", value: to),
        ])
        return (response.days, response.water ?? [:])
    }

    /// Foods logged most lately; `snacks` keeps snacks and drinks only.
    func frequentFoods(snacks: Bool = false) async throws -> [FrequentFood] {
        let response: FrequentResponse = try await get("api/mobile/nutrition/frequent",
                                                       query: snacks ? [URLQueryItem(name: "kind", value: "snack")] : [])
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

    /// "Me lo comí" on a dated slot; the Mac logs what it holds and links it.
    func eatSlot(_ slotId: String) async throws -> [MealEntry] {
        let response: MealsResponse = try await call("api/mobile/nutrition/plan/eat", method: "POST", body: ["slotId": slotId])
        return response.meals
    }

    func setTargets(_ targets: NutritionTargets) async throws -> NutritionTargets? {
        let response: TargetsResponse = try await call("api/mobile/nutrition/targets", method: "PUT", body: targets)
        return response.targets
    }

    func lookupBarcode(_ code: String) async throws -> FoodProduct? {
        let response: ProductResponse = try await get("api/mobile/nutrition/barcode/\(code)")
        return response.product
    }

    // MARK: Water

    func logWater(ml: Double, date: String, loggedAt: Double) async throws -> (entry: WaterEntry, day: WaterDay) {
        struct Body: Encodable { var amountMl: Double; var date: String; var loggedAt: Int64 }
        let response: WaterLogged = try await call("api/mobile/nutrition/water", method: "POST",
                                                   body: Body(amountMl: ml, date: date, loggedAt: Int64(loggedAt)))
        return (response.entry, response.day)
    }

    func deleteWater(_ id: String) async throws {
        let _: Deleted = try await call("api/mobile/nutrition/water/\(id)", method: "DELETE")
    }

    func saveWaterSettings(_ settings: WaterSettings) async throws -> WaterSettings {
        // goalMl is sent even when nil: null means "automatic".
        struct Body: Encodable {
            var settings: WaterSettings
            enum Keys: String, CodingKey { case goalMl, unit, glassMl, bottleMl }
            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: Keys.self)
                try c.encode(settings.goalMl, forKey: .goalMl)
                try c.encode(settings.unit, forKey: .unit)
                try c.encode(settings.glassMl, forKey: .glassMl)
                try c.encode(settings.bottleMl, forKey: .bottleMl)
            }
        }
        let response: WaterSettingsResponse = try await call("api/mobile/nutrition/water/settings", method: "PUT", body: Body(settings: settings))
        return response.settings
    }

    // MARK: Plan adjustment

    /// "Volver al plan": drops the Coach's adjustment for the day.
    func clearAdjustment(date: String) async throws {
        var request = makeRequest("api/mobile/nutrition/plan/adjustment", method: "DELETE")
        request.url = request.url?.appending(queryItems: [URLQueryItem(name: "date", value: date)])
        let _: Cleared = try await perform(request)
    }
}
