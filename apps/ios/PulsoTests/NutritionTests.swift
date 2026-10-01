import XCTest
@testable import Pulso

final class NutritionTests: XCTestCase {
    func testDecodesTheDayResponse() throws {
        let json = #"""
        {"summary":{"date":"2026-10-01","totals":{"kcal":250,"protein":46,"carbs":0,"fat":5,"fiber":0},
          "targets":null,"remaining":null,"bySlot":{"comida":{"kcal":250,"protein":46,"carbs":0,"fat":5,"fiber":0}},"entries":1},
         "meals":[{"id":"m1","date":"2026-10-01","eatenAt":1790836454882,"slot":"comida","name":"Pollo","quantity":150,"unit":"g",
          "kcal":250,"protein":46,"carbs":0,"fat":5,"fiber":0,"source":"plan","barcode":null,"planItemId":"i1"}],
         "plan":{"plan":{"id":"p1","name":"Plan","notes":null,"startsOn":"2026-10-01","active":true,"createdAt":1,
          "days":[{"label":"A","meals":[{"slot":"comida","name":null,"items":[{"id":"i1","name":"Pollo","quantity":150,"unit":"g",
          "kcal":250,"protein":46,"carbs":0,"fat":5,"fiber":0}]}]}]},
          "dayIndex":0,"day":{"label":"A","meals":[{"slot":"comida","name":null,"items":[{"id":"i1","name":"Pollo","quantity":150,
          "unit":"g","kcal":250,"protein":46,"carbs":0,"fat":5,"fiber":0}]}]},"eatenItemIds":["i1"]}}
        """#
        let day = try JSONDecoder().decode(NutritionDay.self, from: Data(json.utf8))
        XCTAssertEqual(day.meals.first?.slot, .comida)
        XCTAssertEqual(day.summary.bySlot["comida"]?.kcal, 250)
        XCTAssertEqual(day.plan?.eatenItemIds, ["i1"])
    }

    func testMealInputOmitsUnsetOptionals() throws {
        let input = MealInput(name: "Manzana", slot: .snack, quantity: 1, unit: .serving, macros: .zero)
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any]
        XCTAssertNil(object?["barcode"])
        XCTAssertNil(object?["date"])
        XCTAssertEqual(object?["unit"] as? String, "serving")
        XCTAssertEqual(object?["source"] as? String, "manual")
    }

    func testPortionScalesPer100g() {
        let product = FoodProduct(barcode: "1", name: "Yogur", brand: nil,
                                  per100g: NutritionMacros(kcal: 61, protein: 3.5, carbs: 4.66, fat: 3.1, fiber: 0),
                                  servingGrams: 125, imageUrl: nil)
        XCTAssertEqual(product.macros(grams: 125), NutritionMacros(kcal: 76, protein: 4.4, carbs: 5.8, fat: 3.9, fiber: 0))
    }

    func testDayKeyRoundTrips() {
        let date = NutritionDate.date("2026-03-29")!
        XCTAssertEqual(NutritionDate.string(date), "2026-03-29")
    }

    func testOnTargetIsWithinTenPercent() {
        let targets = NutritionTargets(kcal: 2000, protein: 0, carbs: 0, fat: 0, fiber: 0)
        func day(_ kcal: Double) -> NutritionSummary {
            NutritionSummary(date: "2026-10-01", totals: NutritionMacros(kcal: kcal, protein: 0, carbs: 0, fat: 0, fiber: 0),
                             targets: targets, remaining: nil, bySlot: [:], entries: 1)
        }
        XCTAssertTrue(AdherenceChart.onTarget(day(2150)))
        XCTAssertFalse(AdherenceChart.onTarget(day(2300)))
    }
}
