import XCTest
@testable import Pulso

final class DishTests: XCTestCase {
    private func entry(_ id: String, _ name: String, kcal: Double, dish: DishRef? = nil) -> MealEntry {
        MealEntry(id: id, date: "2026-10-01", eatenAt: 1_790_870_700_000, slot: .comida, name: name, quantity: 100, unit: .g,
                  kcal: kcal, protein: kcal / 10, carbs: 0, fat: 0, fiber: 0, source: "agent", dish: dish)
    }

    func testDecodesDishesAndOlderEntriesWithoutThem() throws {
        let json = #"""
        {"summary":{"date":"2026-10-01","totals":{"kcal":347,"protein":50,"carbs":34,"fat":6,"fiber":1},
          "targets":null,"remaining":null,"bySlot":{},"entries":2},
         "meals":[{"id":"m1","date":"2026-10-01","eatenAt":1,"slot":"snack","name":"Proteína whey","quantity":500,"unit":"ml",
          "kcal":320,"protein":50,"carbs":28,"fat":6,"fiber":0,"source":"agent","barcode":null,"planItemId":null,
          "dish":{"id":"d1","name":"Batido de proteína con fresas","savedDishId":null}},
          {"id":"m2","date":"2026-10-01","eatenAt":1,"slot":"snack","name":"Manzana","quantity":1,"unit":"serving",
          "kcal":27,"protein":0,"carbs":6,"fat":0,"fiber":1,"source":"manual","barcode":null,"planItemId":null}],
         "plan":null,
         "dishes":[{"id":"s1","name":"Batido de proteína","slot":null,"recipeId":null,"uses":3,"lastUsedAt":1,"createdAt":1,"updatedAt":1,
          "macros":{"kcal":320,"protein":50,"carbs":28,"fat":6,"fiber":0},
          "components":[{"name":"Proteína whey","quantity":25,"unit":"g","measure":null,"barcode":null,"kcal":100,"protein":20,"carbs":3,
          "fat":1.5,"fiber":0,"caffeineMg":null,"alcoholG":null}]}]}
        """#
        let day = try JSONDecoder().decode(NutritionDay.self, from: Data(json.utf8))
        XCTAssertEqual(day.meals[0].dish?.name, "Batido de proteína con fresas")
        XCTAssertNil(day.meals[1].dish)
        XCTAssertEqual(day.dishes?.first?.uses, 3)
        XCTAssertEqual(day.dishes?.first?.components.first?.unit, .g)
    }

    func testGroupsADishsComponentsWhereItsFirstOneIs() {
        let lunch = DishRef(id: "d", name: "Tortitas de carne con queso y arroz")
        let items = LoggedItem.group([
            entry("1", "Queso amarillo", kcal: 130, dish: lunch),
            entry("2", "Agua mineral", kcal: 0),
            entry("3", "Arroz blanco cocido", kcal: 210, dish: lunch),
        ])
        XCTAssertEqual(items.map(\.name), ["Tortitas de carne con queso y arroz", "Agua mineral"])
        guard case .dish(_, let parts) = items[0] else { return XCTFail("expected a dish") }
        XCTAssertEqual(parts.map(\.id), ["1", "3"])
    }

    func testCorrectingAComponentScalesItsMacrosAndMeasure() {
        var milk = entry("1", "Leche", kcal: 220)
        milk.unit = .ml
        milk.quantity = 500
        milk.measure = Measure(amount: 500, unit: .ml)
        let input = milk.input(scaledBy: 0.6)
        XCTAssertEqual(input.quantity, 300, accuracy: 0.001)
        XCTAssertEqual(input.measure?.amount ?? 0, 300, accuracy: 0.001)
        XCTAssertEqual(input.kcal, 132)
        XCTAssertEqual(input.date, "2026-10-01")
    }
}
