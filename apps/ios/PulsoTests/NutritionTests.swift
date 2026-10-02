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

    func testDrinksOfferTheirPackageInMlAndLogItAsSaid() {
        let coke = FoodProduct(barcode: "1", name: "Coca-Cola", brand: nil, per100g: .zero, servingGrams: nil, imageUrl: nil,
                               liquid: true, packageSize: 600, packageKind: "botella")
        XCTAssertEqual(coke.unit, .ml)
        XCTAssertEqual(coke.portions.map(\.title), ["Botella (600 ml)", "Vaso (250 ml)", "Media (300 ml)"])
        XCTAssertEqual(coke.defaultPortion.measure, Measure(amount: 1, unit: .botella, size: 600))
        let can = FoodProduct(barcode: "2", name: "Lata", brand: nil, per100g: .zero, servingGrams: 355, imageUrl: nil,
                              liquid: true, packageSize: 355, packageKind: "lata")
        XCTAssertEqual(can.portions.map(\.title), ["Lata (355 ml)", "Vaso (250 ml)", "Media (\(177.5.formatted()) ml)"])
        XCTAssertEqual(can.defaultPortion.measure, Measure(amount: 1, unit: .lata))
    }

    func testSolidsUseTheLabelAndOldProductsReadAsGrams() {
        let cereal = FoodProduct(barcode: "3", name: "Cereal", brand: nil, per100g: .zero, servingGrams: 30, imageUrl: nil, packageSize: 375)
        XCTAssertEqual(cereal.portions.map(\.amount), [30, 15, 375])
        XCTAssertEqual(cereal.defaultPortion.amount, 30)
        let bare = try? JSONDecoder().decode(FoodProduct.self, from: Data(#"{"barcode":"4","name":"X","per100g":{"kcal":1,"protein":0,"carbs":0,"fat":0,"fiber":0}}"#.utf8))
        XCTAssertEqual(bare?.unit, .g)
        XCTAssertEqual(bare?.portions.map(\.amount), [100, 30])
    }

    func testADrinkBetweenMealsIsASnack() {
        XCTAssertEqual(MealSlot.forDrink(hour: 11), .snack)
        XCTAssertEqual(MealSlot.forDrink(hour: 17), .snack)
        XCTAssertEqual(MealSlot.forDrink(hour: 14), .comida)
        XCTAssertEqual(MealSlot.forDrink(hour: 8), .desayuno)
    }

    func testDayKeyRoundTrips() {
        let date = NutritionDate.date("2026-03-29")!
        XCTAssertEqual(NutritionDate.string(date), "2026-03-29")
    }

    func testDecodesZonesAndCountsTheDayInZone() throws {
        let json = #"""
        {"date":"2026-10-01","totals":{"kcal":1950,"protein":118,"carbs":175,"fat":82,"fiber":5},
         "targets":{"kcal":2100,"protein":160,"carbs":210,"fat":70,"fiber":29,"updatedAt":1,
          "zones":{"kcal":{"kind":"range","min":1890,"max":2210,"custom":false},"protein":{"kind":"min","min":150,"max":188,"custom":true},
           "carbs":{"kind":"range","min":168,"max":231,"custom":false},"fat":{"kind":"range","min":56,"max":77,"custom":false},
           "fiber":{"kind":"min","min":29,"max":36,"custom":false}}},
         "remaining":null,"bySlot":{},"entries":2,"caffeineMg":0,"alcoholG":0,
         "zones":{"kcal":{"kind":"range","min":1890,"max":2210,"custom":false,"value":1950,"target":2100,"status":"inZone"},
          "protein":{"kind":"min","min":150,"max":188,"custom":true,"value":118,"target":160,"status":"below"},
          "carbs":{"kind":"range","min":168,"max":231,"custom":false,"value":175,"target":210,"status":"inZone"},
          "fat":{"kind":"range","min":56,"max":77,"custom":false,"value":82,"target":70,"status":"above"},
          "fiber":{"kind":"min","min":29,"max":36,"custom":false,"value":5,"target":29,"status":"below"}},
         "inZone":false}
        """#
        let day = try JSONDecoder().decode(NutritionSummary.self, from: Data(json.utf8))
        XCTAssertEqual(day.targets?.zones?["protein"]?.kind, .min)
        XCTAssertEqual(day.zones?["fat"]?.status, .above)
        XCTAssertFalse(AdherenceChart.onTarget(day)) // kcal in zone, protein short: not a day in zone
        XCTAssertEqual(day.zones?["protein"]?.line("g"), "Faltan 32 g")
        XCTAssertEqual(day.zones?["fat"]?.line("g"), "Te pasaste 5 g")
        XCTAssertEqual(day.zones?["kcal"]?.line("kcal"), "En tu zona")
        XCTAssertEqual(day.zones?["protein"]?.range("g"), "mín. 150 g")
        XCTAssertEqual(day.zones?["protein"].map { $0.laps($0.max!) } ?? 0, 188 / 206.8, accuracy: 0.001)
    }

    func testOnTargetFallsBackToTenPercentOnOlderEngines() {
        let targets = NutritionTargets(kcal: 2000, protein: 0, carbs: 0, fat: 0, fiber: 0)
        func day(_ kcal: Double) -> NutritionSummary {
            NutritionSummary(date: "2026-10-01", totals: NutritionMacros(kcal: kcal, protein: 0, carbs: 0, fat: 0, fiber: 0),
                             targets: targets, remaining: nil, bySlot: [:], entries: 1)
        }
        XCTAssertTrue(AdherenceChart.onTarget(day(2150)))
        XCTAssertFalse(AdherenceChart.onTarget(day(2300)))
    }
}

final class MeasureTests: XCTestCase {
    func testHouseholdUnitsConvertWithTheirDefaults() {
        XCTAssertEqual(Measure(amount: 2, unit: .lata).quantity.amount, 710)
        XCTAssertEqual(Measure(amount: 2, unit: .lata).quantity.unit, .ml)
        XCTAssertEqual(Measure(amount: 0.5, unit: .taza).quantity.amount, 120)
        XCTAssertEqual(Measure(amount: 1, unit: .puño).quantity.unit, .g)
        XCTAssertEqual(Measure(amount: 1, unit: .lata, size: 330).quantity.amount, 330)
    }

    func testCountsWithoutAWeightAreServings() {
        XCTAssertEqual(Measure(amount: 2, unit: .unidad).quantity.unit, .serving)
        XCTAssertEqual(Measure(amount: 2, unit: .unidad, size: 11).quantity.amount, 22)
        XCTAssertEqual(Measure(amount: 250, unit: .ml).quantity.unit, .ml)
    }

    func testAmountTextShowsWhatWasSaidAndWhatItCameTo() {
        XCTAssertEqual(foodAmountText(710, .ml, measure: Measure(amount: 2, unit: .lata)), "2 latas · 710 ml")
        XCTAssertEqual(foodAmountText(2, .serving, measure: Measure(amount: 2, unit: .unidad)), "2 unidades")
        XCTAssertEqual(foodAmountText(30, .g, measure: Measure(amount: 30, unit: .g)), "30 g")
        XCTAssertEqual(foodAmountText(250, .ml, measure: nil), "250 ml")
    }

    func testMealInputSendsTheMeasure() throws {
        let input = MealInput(name: "Coca-Cola", slot: .snack, measure: Measure(amount: 1, unit: .lata), macros: .zero, caffeineMg: 34)
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any]
        XCTAssertEqual(object?["quantity"] as? Double, 355)
        XCTAssertEqual(object?["unit"] as? String, "ml")
        XCTAssertEqual((object?["measure"] as? [String: Any])?["unit"] as? String, "lata")
        XCTAssertEqual(object?["caffeineMg"] as? Double, 34)
        XCTAssertNil(object?["alcoholG"])
    }

    func testDecodesMeasuresAndToleratesUnknownUnits() throws {
        let json = #"""
        [{"id":"a","date":"2026-10-01","eatenAt":1,"slot":"snack","name":"Cerveza","quantity":330,"unit":"ml","kcal":140,"protein":1,
          "carbs":11,"fat":0,"fiber":0,"source":"agent","measure":{"amount":1,"unit":"lata","size":330},"caffeineMg":null,"alcoholG":13},
         {"id":"b","date":"2026-10-01","eatenAt":2,"slot":"snack","name":"X","quantity":1,"unit":"oz","kcal":1,"protein":0,
          "carbs":0,"fat":0,"fiber":0,"source":"manual","measure":{"amount":1,"unit":"jarra","size":null}}]
        """#
        let meals = try JSONDecoder().decode([MealEntry].self, from: Data(json.utf8))
        XCTAssertEqual(meals[0].measure, Measure(amount: 1, unit: .lata, size: 330))
        XCTAssertEqual(meals[0].alcoholG, 13)
        XCTAssertEqual(meals[1].unit, .g)
        XCTAssertEqual(meals[1].measure?.unit, .unidad)
    }

    func testSnacksAnHourApartAreSeparateMoments() {
        func meal(_ id: String, _ slot: MealSlot, minutes: Double, unit: FoodUnit = .g) -> MealEntry {
            MealEntry(id: id, date: "2026-10-01", eatenAt: minutes * 60_000, slot: slot, name: id, quantity: 1, unit: unit,
                      kcal: 10, protein: 0, carbs: 0, fat: 0, fiber: 0, source: "manual")
        }
        let moments = MealTimeline.moments([
            meal("cafe", .snack, minutes: 600, unit: .ml), meal("galleta", .snack, minutes: 610),
            meal("comida", .comida, minutes: 840), meal("cerveza", .snack, minutes: 1200, unit: .ml),
        ])
        XCTAssertEqual(moments.map { $0.meals.map(\.id) }, [["cafe", "galleta"], ["comida"], ["cerveza"]])
        XCTAssertEqual(moments.last?.title, "Bebida")
        XCTAssertEqual(moments.first?.title, "Snack")
    }
}

final class WaterTests: XCTestCase {
    private let settings = WaterSettings(goalMl: nil, unit: .vaso, glassMl: 250, bottleMl: 750)

    func testCountsInThePersonsUnit() {
        XCTAssertEqual(settings.count(750), 3)
        XCTAssertEqual(settings.count(750, in: .botella), 1)
        XCTAssertEqual(settings.count(330, in: .ml), 330)
        XCTAssertEqual(settings.ml(per: .botella), 750)
    }

    func testFormatsGlassesBottlesAndLitres() {
        XCTAssertEqual(settings.format(250), "1 vaso")
        XCTAssertEqual(settings.format(2_750), "11 vasos")
        // Decimals follow the phone's locale ("1,5" in Spanish).
        XCTAssertEqual(settings.format(1_125, in: .botella), "\(1.5.formatted()) botellas")
        XCTAssertEqual(settings.format(600), "\(2.5.formatted()) vasos") // 2.4 rounds to the nearest half
        XCTAssertEqual(WaterSettings.litres(330), "330 ml")
        XCTAssertEqual(WaterSettings.litres(1_250), "\(1.25.formatted()) L")
        XCTAssertEqual(WaterSettings.litres(2_000), "2 L")
    }

    func testProgressReadsInThePersonsUnit() {
        let glasses = WaterSettings(goalMl: nil, unit: .vaso, glassMl: 250, bottleMl: 500)
        XCTAssertEqual(glasses.progress(250, of: 3_700), "1 de 15 vasos")
        XCTAssertEqual(glasses.quickAddMl, 250)
        let millilitres = WaterSettings(goalMl: nil, unit: .ml, glassMl: 250, bottleMl: 500)
        XCTAssertEqual(millilitres.progress(750, of: 2_000), "750 ml de 2 L")
        let bottles = WaterSettings(goalMl: nil, unit: .botella, glassMl: 250, bottleMl: 500)
        XCTAssertEqual(bottles.quickAddMl, 500)
    }

    func testPresetsUseTheirSizesAndAddALitre() {
        XCTAssertEqual(WaterPreset.presets(settings).map(\.ml), [250, 750, 1_000])
        var litreBottle = settings
        litreBottle.bottleMl = 1_000
        XCTAssertEqual(WaterPreset.presets(litreBottle).map(\.ml), [250, 1_000])
    }

    func testDecodesTheWaterDayAndProgress() throws {
        let json = #"""
        {"date":"2026-10-01","totalMl":1500,"goalMl":2000,"goalSource":"weight",
         "entries":[{"id":"w1","date":"2026-10-01","loggedAt":1,"amountMl":1500,"source":"agent"}],
         "settings":{"goalMl":null,"unit":"botella","glassMl":250,"bottleMl":500}}
        """#
        let day = try JSONDecoder().decode(WaterDay.self, from: Data(json.utf8))
        XCTAssertEqual(day.settings.unit, .botella)
        XCTAssertNil(day.settings.goalMl)
        XCTAssertEqual(day.progress, 0.75)
        XCTAssertEqual(day.leftMl, 500)
    }

    func testAdjustmentReplacesPlannedMealsBySlot() {
        let item = { (id: String, kcal: Double) in DietPlanItem(id: id, name: id, quantity: 100, unit: .g, kcal: kcal, protein: 0, carbs: 0, fat: 0, fiber: 0) }
        let day = DietPlanDay(label: "A", meals: [
            DietPlanMeal(slot: .comida, name: "Pollo", items: [item("c", 700)]),
            DietPlanMeal(slot: .cena, name: "Salmón", items: [item("n", 600)]),
        ])
        let plan = DietPlan(id: "p", name: "Plan", notes: nil, startsOn: "2026-10-01", active: true, createdAt: 0, days: [day])
        let adjustment = DayAdjustment(date: "2026-10-01", factor: 0.5,
                                       meals: [AdjustedMeal(slot: .cena, name: nil, items: [item("n", 300)], change: "scaled")],
                                       projected: .zero, summary: "", note: nil, createdAt: 0)
        let meals = DietPlanForDay(plan: plan, dayIndex: 0, day: day, eatenItemIds: [], adjustment: adjustment).meals
        XCTAssertEqual(meals.map(\.slot), [.comida, .cena])
        XCTAssertFalse(meals[0].adjusted)
        XCTAssertTrue(meals[1].adjusted)
        XCTAssertEqual(meals[1].name, "Salmón") // keeps the planned dish name when only portions changed
        XCTAssertEqual(meals[1].items.first?.kcal, 300)
    }

    func testWeekAveragesCountOnlyLoggedDays() {
        let targets = NutritionTargets(kcal: 2000, protein: 150, carbs: 0, fat: 0, fiber: 0)
        func day(_ kcal: Double, entries: Int) -> NutritionSummary {
            NutritionSummary(date: "2026-10-01", totals: NutritionMacros(kcal: kcal, protein: kcal / 20, carbs: 0, fat: 0, fiber: 0),
                             targets: targets, remaining: nil, bySlot: [:], entries: entries)
        }
        let averages = WeekAverages(week: [day(2000, entries: 2), day(3000, entries: 1), day(0, entries: 0)], water: ["a": 1000, "b": 2000])
        XCTAssertEqual(averages.kcal, 2500)
        XCTAssertEqual(averages.protein, 125)
        XCTAssertEqual(averages.onTarget, 1)
        XCTAssertEqual(averages.logged, 2)
        XCTAssertEqual(averages.waterMl, 1500)
    }
}
