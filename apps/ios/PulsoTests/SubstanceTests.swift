import XCTest
@testable import Pulso

final class SubstanceTests: XCTestCase {
    private let calendar = Calendar(identifier: .gregorian)

    private let substances = """
    [{"id": "alcohol", "name": "Alcohol", "symbol": "🍷", "unit": "tragos", "forms": [], "maxDaysPerWeek": null,
      "archived": false, "position": 1, "builtin": true, "createdAt": 1, "updatedAt": 1},
     {"id": "cannabis", "name": "Cannabis", "symbol": "leaf", "unit": "sesiones", "forms": ["fumado", "vapeado", "comestible"],
      "maxDaysPerWeek": 2, "archived": false, "position": 0, "builtin": true, "createdAt": 1, "updatedAt": 1},
     {"id": "x1", "name": "Nicotina", "symbol": null, "unit": "cigarrillos", "forms": [], "maxDaysPerWeek": null,
      "archived": true, "position": 0, "builtin": false, "createdAt": 1, "updatedAt": 1},
     {"name": "Sin id"}]
    """

    private func overviewJSON(substanceId: String?, entries: String, bySubstance: String = "[]") -> Data {
        Data("""
        {
          "substances": \(substances),
          "summary": {
            "substanceId": \(substanceId.map { "\"\($0)\"" } ?? "null"), "today": "2026-10-01",
            "days": [{"date": "2026-09-28", "uses": 0, "level": 0}, {"date": "2026-09-29", "uses": 2, "level": 3}],
            "weeks": [{"weekStart": "2026-09-28", "days": 1}],
            "avgDaysPerWeek": null, "daysThisWeek": 1, "daysWithout": 2, "longestWithout": 5,
            "lastUse": {"date": "2026-09-29", "time": "22:15"},
            "timeOfDay": [{"key": "noche", "label": "Noche", "uses": 2}],
            "byForm": [{"form": "fumado", "uses": 2}], "byContext": [{"context": "trabajo", "uses": 1}],
            "bySubstance": \(bySubstance),
            "goal": \(substanceId == nil ? "null" : #"{"maxDaysPerWeek": 2, "daysThisWeek": 1, "within": true}"#),
            "correlations": [{"key": "sleep_minutes", "label": "Sueño", "unit": "min", "withUse": null, "withoutUse": 400,
                              "diff": null, "nWith": 1, "nWithout": 12, "enough": false, "text": null}]
          },
          "entries": [\(entries)]
        }
        """.utf8)
    }

    private let entry = """
    {"id": "e1", "substanceId": "cannabis", "date": "2026-09-29", "time": "22:15", "form": "fumado", "amount": "mucho",
     "quantity": 2, "thcMg": null, "context": "dormir", "note": null, "createdAt": 1, "updatedAt": 1}
    """

    func testSubstanceDecodesAndToleratesMissingFields() throws {
        let full = try JSONDecoder().decode(Substance.self, from: Data("""
        {"id": "cannabis", "name": "Cannabis", "symbol": "leaf", "unit": "sesiones", "forms": ["fumado", "comestible"],
         "maxDaysPerWeek": 2, "archived": false, "position": 0, "builtin": true, "createdAt": 1, "updatedAt": 2, "color": "x"}
        """.utf8))
        XCTAssertEqual(full.forms, ["fumado", "comestible"])
        XCTAssertEqual(full.maxDaysPerWeek, 2)
        XCTAssertTrue(full.builtin)

        let bare = try JSONDecoder().decode(Substance.self, from: Data(#"{"id": "k", "name": "Kratom"}"#.utf8))
        XCTAssertNil(bare.symbol)
        XCTAssertEqual(bare.unit, "veces")
        XCTAssertEqual(bare.forms, [])
        XCTAssertFalse(bare.archived)
    }

    func testOverviewForOneSubstance() throws {
        let overview = try JSONDecoder().decode(SubstanceOverview.self, from: overviewJSON(substanceId: "cannabis", entries: entry))
        XCTAssertEqual(overview.scope, .one("cannabis"))
        // Active by position, archived last; the one without an id is dropped.
        XCTAssertEqual(overview.substances.map(\.id), ["cannabis", "alcohol", "x1"])
        XCTAssertEqual(overview.summary.goal?.maxDaysPerWeek, 2)
        XCTAssertEqual(overview.summary.byForm.first?.form, "fumado")
        XCTAssertEqual(overview.summary.byContext.first?.context, .otro)
        XCTAssertEqual(overview.entries.first?.quantity, 2)
        XCTAssertEqual(overview.entries.first?.title(substanceName: "Cannabis", showingName: false), "Fumado · Mucho")
        XCTAssertFalse(overview.isEmpty)
    }

    func testOverviewForTodas() throws {
        let alcohol = """
        {"id": "e2", "substanceId": "alcohol", "date": "2026-09-30", "time": "21:00", "form": null, "amount": "poco",
         "quantity": 1, "thcMg": null, "context": null, "note": null, "createdAt": 1, "updatedAt": 1}
        """
        let overview = try JSONDecoder().decode(SubstanceOverview.self, from: overviewJSON(
            substanceId: nil,
            entries: "\(entry), \(alcohol)",
            bySubstance: #"[{"substanceId": "cannabis", "uses": 2}, {"substanceId": "alcohol", "uses": 1}]"#
        ))
        XCTAssertEqual(overview.scope, .all)
        XCTAssertNil(overview.summary.goal)
        XCTAssertEqual(overview.summary.bySubstance.map(\.uses), [2, 1])
        XCTAssertEqual(overview.entries.map(\.substanceId), ["cannabis", "alcohol"])
        XCTAssertEqual(overview.entries[0].title(substanceName: "Cannabis", showingName: true), "Cannabis · Fumado · Mucho")
        XCTAssertEqual(overview.entries[1].title(substanceName: "Alcohol", showingName: true), "Alcohol · Poco")
    }

    func testUnknownValuesFallBackAndUnreadableEntriesAreDropped() throws {
        let newer = """
        {"id": "e2", "substanceId": "cannabis", "date": "2026-09-30", "time": "10:00", "form": "parche", "amount": "enorme",
         "quantity": null, "thcMg": 5, "context": "trabajo", "note": "x", "createdAt": 1, "updatedAt": 1},
        {"id": "e3", "date": "2026-09-30", "time": "11:00", "amount": "poco"}
        """
        let overview = try JSONDecoder().decode(SubstanceOverview.self, from: overviewJSON(substanceId: "cannabis", entries: "\(entry), \(newer)"))
        XCTAssertEqual(overview.entries.map(\.id), ["e1", "e2"])
        XCTAssertEqual(overview.entries[1].form, "parche")
        XCTAssertEqual(overview.entries[1].amount, .normal)
        XCTAssertEqual(overview.entries[1].context, .otro)
    }

    func testSymbolIsEmojiOrSFSymbolOrTheNeutralDefault() {
        let known: (String) -> Bool = { ["leaf", "wineglass"].contains($0) }
        XCTAssertEqual(SubstanceGlyph.resolve("🌿", isSystemSymbol: known), .emoji("🌿"))
        XCTAssertEqual(SubstanceGlyph.resolve("☕️", isSystemSymbol: known), .emoji("☕️"))
        XCTAssertEqual(SubstanceGlyph.resolve(" 👍🏽 ", isSystemSymbol: known), .emoji("👍🏽"))
        XCTAssertEqual(SubstanceGlyph.resolve("leaf", isSystemSymbol: known), .system("leaf"))
        XCTAssertEqual(SubstanceGlyph.resolve("not.a.symbol", isSystemSymbol: known), .system(SubstanceStyle.symbol))
        XCTAssertEqual(SubstanceGlyph.resolve(nil, isSystemSymbol: known), .system(SubstanceStyle.symbol))
        XCTAssertEqual(SubstanceGlyph.resolve("", isSystemSymbol: known), .system(SubstanceStyle.symbol))
        XCTAssertFalse(SubstanceGlyph.isEmoji("1"))
        XCTAssertFalse(SubstanceGlyph.isEmoji("a"))
        XCTAssertFalse(SubstanceGlyph.isEmoji("🌿🍷"))
    }

    func testDraftSendsLocalDateTimeAndNullsWhatDoesNotApply() throws {
        var draft = SubstanceDraft(substance: Substance(id: "alcohol", name: "Alcohol", unit: "tragos"))
        draft.at = LocalClock.instant(date: "2026-10-01", time: "21:05")!
        draft.thcMg = 10
        draft.quantity = 0
        draft.note = "   "
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft)) as! [String: Any]
        XCTAssertEqual(json["substanceId"] as? String, "alcohol")
        XCTAssertEqual(json["date"] as? String, "2026-10-01")
        XCTAssertEqual(json["time"] as? String, "21:05")
        XCTAssertTrue(json["form"] is NSNull)
        XCTAssertTrue(json["thcMg"] is NSNull)
        XCTAssertTrue(json["quantity"] is NSNull)
        XCTAssertTrue(json["note"] is NSNull)
        XCTAssertEqual(json["amount"] as? String, "normal")
    }

    func testDraftStartsOnFirstFormAndThcOnlyForCannabisEdibles() throws {
        let cannabis = Substance(id: "cannabis", name: "Cannabis", forms: ["fumado", "vapeado", "comestible"])
        var draft = SubstanceDraft(substance: cannabis)
        XCTAssertEqual(draft.form, "fumado")
        XCTAssertFalse(draft.showsThc)
        draft.form = "comestible"
        draft.thcMg = 10
        draft.quantity = 1.5
        XCTAssertTrue(draft.showsThc)
        var json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft)) as! [String: Any]
        XCTAssertEqual(json["form"] as? String, "comestible")
        XCTAssertEqual(json["thcMg"] as? Double, 10)
        XCTAssertEqual(json["quantity"] as? Double, 1.5)

        // A custom substance with a "comestible" form is not cannabis: no THC.
        draft.switchTo(Substance(id: "x", name: "Setas", forms: ["comestible", "té"]))
        XCTAssertEqual(draft.form, "comestible")
        XCTAssertFalse(draft.showsThc)
        json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft)) as! [String: Any]
        XCTAssertTrue(json["thcMg"] is NSNull)

        draft.switchTo(Substance(id: "alcohol", name: "Alcohol"))
        XCTAssertNil(draft.form)
    }

    func testPatchSendsOnlySetFieldsAndNullClears() throws {
        let goal = try JSONSerialization.jsonObject(with: JSONEncoder().encode(SubstancePatch(maxDaysPerWeek: .some(nil)))) as! [String: Any]
        XCTAssertEqual(Array(goal.keys), ["maxDaysPerWeek"])
        XCTAssertTrue(goal["maxDaysPerWeek"] is NSNull)

        var definition = SubstanceDefinition()
        definition.name = "  Cafeína "
        definition.unit = " "
        definition.forms = ["café", " Café ", "", "té"]
        let created = try JSONSerialization.jsonObject(with: JSONEncoder().encode(definition.patch)) as! [String: Any]
        XCTAssertEqual(created["name"] as? String, "Cafeína")
        XCTAssertNil(created["unit"])
        XCTAssertTrue(created["symbol"] is NSNull)
        XCTAssertEqual(created["forms"] as? [String], ["café", "té"])
        XCTAssertNil(created["archived"])
    }

    func testQuantityReadsInTheUnit() {
        XCTAssertEqual(SubstanceText.quantity(1, unit: "tragos"), "1 trago")
        XCTAssertEqual(SubstanceText.quantity(1, unit: "sesiones"), "1 sesión")
        XCTAssertEqual(SubstanceText.quantity(3, unit: "tragos"), "3 tragos")
        XCTAssertEqual(SubstanceText.unitLabel("mg"), "mg")
        XCTAssertEqual(SubstanceText.unitLabel("tragos"), "Tragos")
    }

    func testHeatmapIsWeekColumnsMondayFirst() {
        // Monday 2026-08-10 through Thursday 2026-10-01: 7 full weeks and 4 days.
        let start = LocalClock.day("2026-08-10")!
        let days = (0..<53).map { offset in
            SubstanceDay(date: LocalClock.date(calendar.date(byAdding: .day, value: offset, to: start)!), uses: 0, level: 0)
        }
        let columns = SubstanceHeatmap.columns(days, calendar: calendar)
        XCTAssertEqual(columns.count, 8)
        XCTAssertTrue(columns.allSatisfy { $0.count == 7 })
        XCTAssertEqual(columns[0][0]?.date, "2026-08-10")
        XCTAssertEqual(columns[7][3]?.date, "2026-10-01")
        XCTAssertNil(columns[7][4])
    }

    func testHeatmapPadsAStartThatIsNotMonday() {
        let days = [SubstanceDay(date: "2026-09-30", uses: 1, level: 1)] // miércoles
        let columns = SubstanceHeatmap.columns(days, calendar: calendar)
        XCTAssertEqual(columns.count, 1)
        XCTAssertNil(columns[0][1])
        XCTAssertEqual(columns[0][2]?.date, "2026-09-30")
    }

    func testLastUseReadsInDays() {
        let now = LocalClock.instant(date: "2026-10-01", time: "12:00", calendar: calendar)!
        XCTAssertTrue(SubstanceText.lastUse(date: "2026-10-01", time: "09:00", now: now, calendar: calendar).hasPrefix("Hoy, "))
        XCTAssertTrue(SubstanceText.lastUse(date: "2026-09-30", time: "23:00", now: now, calendar: calendar).hasPrefix("Ayer, "))
        XCTAssertEqual(SubstanceText.lastUse(date: "2026-09-27", time: "23:00", now: now, calendar: calendar), "Hace 4 días")
    }
}
