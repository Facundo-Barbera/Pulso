import XCTest
@testable import Pulso

/// The dated plan as the engine sends it (fixtures captured from the engine's own horizon and ops).
final class DietTests: XCTestCase {
    private let horizonJSON = #"""
    {"planId":"f39c","planName":"Definición","from":"2026-10-01","to":"2026-10-03","horizonDays":14,"days":[{"date":"2026-10-01","label":"A","slots":[
     {"id":"7f46","planId":"f39c","date":"2026-10-01","slot":"desayuno","kind":"items","name":null,"recipeId":null,"prepId":null,"portions":null,"items":[{"name":"Avena","quantity":80,"unit":"g","kcal":300,"protein":10,"carbs":54,"fat":6,"fiber":0,"id":"b5e1"}],"adjusted":null,"macros":{"kcal":300,"protein":10,"carbs":54,"fat":6,"fiber":0},"status":"skipped","entryIds":[],"replacedBy":null,"cookMinutes":null,"note":null},
     {"id":"fd22","planId":"f39c","date":"2026-10-01","slot":"media_manana","kind":"items","name":null,"recipeId":null,"prepId":null,"portions":null,"items":[{"name":"Manzana","quantity":1,"unit":"serving","kcal":80,"protein":0,"carbs":20,"fat":0,"fiber":0,"id":"73c9"}],"adjusted":null,"macros":{"kcal":80,"protein":0,"carbs":20,"fat":0,"fiber":0},"status":"eaten","entryIds":["03d7"],"replacedBy":null,"cookMinutes":null,"note":null},
     {"id":"803f","planId":"f39c","date":"2026-10-01","slot":"comida","kind":"prep","name":"Lentejas","recipeId":"f65c","prepId":"c76f","portions":1,"items":[{"id":"79e3","name":"Lentejas","quantity":1,"unit":"serving","kcal":362.5,"protein":22.8,"carbs":52.5,"fat":1.5,"fiber":0}],"adjusted":[{"id":"79e3","name":"Lentejas","quantity":1.2,"unit":"serving","kcal":435,"protein":27.4,"carbs":63,"fat":1.8,"fiber":0}],"macros":{"kcal":435,"protein":27.4,"carbs":63,"fat":1.8,"fiber":0},"status":"planned","entryIds":[],"replacedBy":null,"cookMinutes":0,"note":null},
     {"id":"e5e8","planId":"f39c","date":"2026-10-01","slot":"cena","kind":"items","name":null,"recipeId":null,"prepId":null,"portions":null,"items":[{"name":"Salmón","quantity":200,"unit":"g","kcal":600,"protein":40,"carbs":0,"fat":46,"fiber":0,"id":"7bb4"}],"adjusted":null,"macros":{"kcal":600,"protein":40,"carbs":0,"fat":46,"fiber":0},"status":"replaced","entryIds":["29de"],"replacedBy":"Vualá","cookMinutes":null,"note":null}],
     "planned":{"kcal":442.5,"protein":22.8,"carbs":72.5,"fat":1.5,"fiber":0},"shiftKcal":0,"goalKcal":2000,"adjustment":null}],
     "preps":[{"id":"c76f","planId":"f39c","recipeId":"f65c","recipeName":"Lentejas","cookDate":"2026-10-01","portions":4,"status":"planned","cookedAt":null,"slotIds":["803f","d6e4"],"eaten":0,"leftover":2}],
     "lastRevision":{"id":"3e93","planId":"f39c","op":"replace","summary":"Cena del jue 1: vualá en vez de salmón (−100 kcal).","dates":["2026-10-01"],"createdAt":1790881706192,"undoneAt":null}}
    """#

    private func horizon() throws -> DietHorizon {
        try JSONDecoder().decode(DietHorizon.self, from: Data(horizonJSON.utf8))
    }

    func testDecodesTheHorizonWithStatusesAndPreps() throws {
        let horizon = try horizon()
        let day = try XCTUnwrap(horizon.day("2026-10-01"))
        XCTAssertEqual(day.slots.map(\.status), [.skipped, .eaten, .planned, .replaced])
        XCTAssertEqual(day.slots[2].kind, .prep)
        XCTAssertEqual(day.slots[3].replacedBy, "Vualá")
        XCTAssertEqual(day.pending, 1)
        XCTAssertEqual(day.done, 3)
        XCTAssertEqual(horizon.preps(cookingOn: "2026-10-01").map(\.recipeName), ["Lentejas"])
        XCTAssertEqual(horizon.lastRevision?.isLive, true)
    }

    func testSourceLinesAndRecipeOfAPrepPortion() throws {
        let horizon = try horizon()
        let slots = try XCTUnwrap(horizon.day("2026-10-01")).slots
        XCTAssertEqual(horizon.source(of: slots[2]), "Porción del prep · 1 de 4")
        XCTAssertEqual(horizon.recipeId(of: slots[2]), "f65c")
        XCTAssertNil(horizon.source(of: slots[0]))
        var quick = slots[2]
        quick.kind = .recipe
        quick.cookMinutes = 10
        XCTAssertEqual(horizon.source(of: quick), "Receta rápida · 10 min")
    }

    func testEatingUsesTheAdjustedPortions() throws {
        let prep = try XCTUnwrap(try horizon().day("2026-10-01")).slots[2]
        XCTAssertEqual(prep.current.first?.quantity, 1.2)
    }

    func testOnlyPlannedMealsOfferChangesAndNoCookOnlyWhenThereIsCooking() throws {
        let slots = try XCTUnwrap(try horizon().day("2026-10-01")).slots
        XCTAssertEqual(SlotAction.available(for: slots[0]), [])
        // A batch portion is already cooked: no "Hoy no cocino".
        XCTAssertEqual(SlotAction.available(for: slots[2]), [.eaten, .replaced, .ateOut, .skipped])
        var dinner = slots[3]
        dinner.status = .planned
        XCTAssertEqual(SlotAction.available(for: dinner), [.eaten, .replaced, .ateOut, .skipped, .noCook])
    }

    func testDecodesPlannedVersusRealAndMissedMeals() throws {
        let json = #"""
        {"id":"c1","planId":"p","date":"2026-10-01","slot":"comida","kind":"items","name":"Pasta boloñesa","recipeId":null,"prepId":null,"portions":null,
         "items":[{"id":"i","name":"Pasta boloñesa","quantity":1,"unit":"serving","kcal":617,"protein":37,"carbs":70,"fat":18,"fiber":5}],"adjusted":null,
         "macros":{"kcal":617,"protein":37,"carbs":70,"fat":18,"fiber":5},"status":"replaced","entryIds":["t","q","a"],"replacedBy":"Tortitas de carne de res, Queso amarillo, Arroz blanco",
         "real":{"label":"Tortitas de carne de res, queso amarillo y arroz blanco","entryIds":["t","q","a"],"macros":{"kcal":965,"protein":30,"carbs":90,"fat":30,"fiber":3},"eatenAt":1790887260000,"asPlanned":false},
         "missed":false,"cookMinutes":null,"note":null}
        """#
        let slot = try JSONDecoder().decode(PlanSlot.self, from: Data(json.utf8))
        XCTAssertEqual(slot.real?.label, "Tortitas de carne de res, queso amarillo y arroz blanco")
        XCTAssertEqual(slot.kcal, 965)
        XCTAssertFalse(slot.isMissed)
        var pending = slot
        pending.status = .planned
        pending.real = nil
        pending.missed = true
        XCTAssertTrue(pending.isMissed)
        XCTAssertEqual(pending.kcal, 617)
        // An older Mac sends neither: nothing missed, the plan's kcal.
        let old = try XCTUnwrap(try horizon().day("2026-10-01")).slots[2]
        XCTAssertNil(old.real)
        XCTAssertFalse(old.isMissed)
    }

    func testAteOutEncodesTheSlot() throws {
        let slot = try XCTUnwrap(try horizon().day("2026-10-01")).slots[3]
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(PlanOp.ateOut(slot))) as? [String: String])
        XCTAssertEqual(body, ["op": "ate_out", "date": "2026-10-01", "slotId": "e5e8"])
    }

    func testPlanOpsEncodeOnlyTheirFields() throws {
        let slot = try XCTUnwrap(try horizon().day("2026-10-01")).slots[3]
        let replace = try JSONSerialization.jsonObject(with: JSONEncoder().encode(PlanOp.replace(slot, entryIds: ["m1"]))) as! [String: Any]
        XCTAssertEqual(replace["op"] as? String, "replace")
        XCTAssertEqual(replace["slotId"] as? String, "e5e8")
        XCTAssertEqual(replace["entryIds"] as? [String], ["m1"])
        XCTAssertNil(replace["cooked"])
        let noCook = try JSONSerialization.jsonObject(with: JSONEncoder().encode(PlanOp.noTimeToCook(slot))) as! [String: Any]
        XCTAssertEqual(noCook["slot"] as? String, "cena")
        XCTAssertNil(noCook["slotId"])
    }

    func testDecodesAPlanChangeAndARecipe() throws {
        let change = #"""
        {"revision":{"id":"bedc","planId":"f39c","op":"skip","summary":"Saltaste desayuno del jue 1 (−300 kcal).","dates":["2026-10-01"],"createdAt":1790881706191,"undoneAt":null},
         "summary":"Saltaste desayuno del jue 1 (−300 kcal).","slots":[],
         "compensation":{"mode":"none","deviationKcal":-300,"absorbedKcal":0,"unabsorbedKcal":-300,"days":[],"summary":""},"shoppingRefreshed":false}
        """#
        let decoded = try JSONDecoder().decode(PlanChange.self, from: Data(change.utf8))
        XCTAssertEqual(decoded.revision.id, "bedc")
        XCTAssertEqual(decoded.compensation?.deviationKcal, -300)

        let recipe = #"""
        {"id":"f65c","name":"Lentejas","servings":4,"prepMinutes":40,"batch":true,"ingredients":[
          {"kcal":1400,"protein":90,"carbs":200,"fat":6,"fiber":0,"name":"Lentejas","quantity":400,"unit":"g"},
          {"kcal":50,"protein":1,"carbs":10,"fat":0,"fiber":0,"name":"Zanahoria","quantity":2,"unit":"unidad"}],
         "perServing":{"kcal":362.5,"protein":22.8,"carbs":52.5,"fat":1.5,"fiber":0},"steps":null,"variantOf":null,"createdAt":1790881706187}
        """#
        let r = try JSONDecoder().decode(Recipe.self, from: Data(recipe.utf8))
        XCTAssertEqual(r.ingredients.map(\.amountText), ["400 g", "2 unidades"])
        XCTAssertFalse(r.isQuick)
    }

    func testMealEntryReadsItsSlot() throws {
        let json = #"""
        {"id":"m1","date":"2026-10-01","eatenAt":1,"slot":"cena","name":"Vualá","quantity":1,"unit":"serving","kcal":500,"protein":10,
         "carbs":60,"fat":25,"fiber":0,"source":"manual","barcode":null,"planItemId":null,"slotId":"e5e8","offPlan":true,"note":null,"measure":null}
        """#
        XCTAssertEqual(try JSONDecoder().decode(MealEntry.self, from: Data(json.utf8)).slotId, "e5e8")
    }
}
