import XCTest
@testable import Pulso

final class SubstanceTests: XCTestCase {
    private let calendar = Calendar(identifier: .gregorian)

    private func overviewJSON(entries: String) -> Data {
        Data("""
        {
          "summary": {
            "substance": "cannabis", "today": "2026-10-01",
            "days": [{"date": "2026-09-28", "uses": 0, "level": 0}, {"date": "2026-09-29", "uses": 2, "level": 3}],
            "weeks": [{"weekStart": "2026-09-28", "days": 1}],
            "avgDaysPerWeek": null, "daysThisWeek": 1, "daysWithout": 2, "longestWithout": 5,
            "lastUse": {"date": "2026-09-29", "time": "22:15"},
            "timeOfDay": [{"key": "noche", "label": "Noche", "uses": 2}],
            "byForm": [], "byContext": [],
            "goal": {"maxDaysPerWeek": 2, "daysThisWeek": 1, "within": true},
            "correlations": [{"key": "sleep_minutes", "label": "Sueño", "unit": "min", "withUse": null, "withoutUse": 400,
                              "diff": null, "nWith": 1, "nWithout": 12, "enough": false, "text": null}]
          },
          "entries": [\(entries)],
          "settings": {"maxDaysPerWeek": 2}
        }
        """.utf8)
    }

    private let entry = """
    {"id": "e1", "substance": "cannabis", "date": "2026-09-29", "time": "22:15", "form": "fumado", "amount": "mucho",
     "count": 2, "thcMg": null, "context": "dormir", "note": null, "createdAt": 1, "updatedAt": 1}
    """

    func testOverviewDecodes() throws {
        let overview = try JSONDecoder().decode(SubstanceOverview.self, from: overviewJSON(entries: entry))
        XCTAssertEqual(overview.summary.daysWithout, 2)
        XCTAssertEqual(overview.summary.goal?.maxDaysPerWeek, 2)
        XCTAssertEqual(overview.settings.maxDaysPerWeek, 2)
        XCTAssertEqual(overview.entries.first?.context, .dormir)
        XCTAssertEqual(overview.entries.first?.title, "Fumado · Mucho")
        XCTAssertFalse(overview.isEmpty)
    }

    func testUnknownValuesFallBackAndUnknownSubstancesAreDropped() throws {
        let newer = """
        {"id": "e2", "substance": "cannabis", "date": "2026-09-30", "time": "10:00", "form": "parche", "amount": "enorme",
         "count": null, "thcMg": 5, "context": "trabajo", "note": "x", "createdAt": 1, "updatedAt": 1},
        {"id": "e3", "substance": "cafeina", "date": "2026-09-30", "time": "11:00", "form": null, "amount": "poco",
         "count": null, "thcMg": null, "context": null, "note": null, "createdAt": 1, "updatedAt": 1}
        """
        let overview = try JSONDecoder().decode(SubstanceOverview.self, from: overviewJSON(entries: "\(entry), \(newer)"))
        XCTAssertEqual(overview.entries.map(\.id), ["e1", "e2"])
        XCTAssertEqual(overview.entries[1].form, .otro)
        XCTAssertEqual(overview.entries[1].amount, .normal)
        XCTAssertEqual(overview.entries[1].context, .otro)
    }

    func testDraftSendsLocalDateTimeAndNullsWhatDoesNotApply() throws {
        var draft = SubstanceDraft(substance: .alcohol)
        draft.at = LocalClock.instant(date: "2026-10-01", time: "21:05")!
        draft.thcMg = 10
        draft.count = 0
        draft.note = "   "
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft)) as! [String: Any]
        XCTAssertEqual(json["substance"] as? String, "alcohol")
        XCTAssertEqual(json["date"] as? String, "2026-10-01")
        XCTAssertEqual(json["time"] as? String, "21:05")
        XCTAssertTrue(json["form"] is NSNull)
        XCTAssertTrue(json["thcMg"] is NSNull)
        XCTAssertTrue(json["count"] is NSNull)
        XCTAssertTrue(json["note"] is NSNull)
        XCTAssertEqual(json["amount"] as? String, "normal")
    }

    func testCannabisDefaultsToSmokedAndKeepsThc() throws {
        var draft = SubstanceDraft()
        XCTAssertEqual(draft.form, .fumado)
        XCTAssertFalse(draft.showsThc)
        draft.form = .comestible
        draft.thcMg = 10
        XCTAssertTrue(draft.showsThc)
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft)) as! [String: Any]
        XCTAssertEqual(json["form"] as? String, "comestible")
        XCTAssertEqual(json["thcMg"] as? Double, 10)
    }

    func testClearingTheGoalSendsNull() throws {
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(SubstanceSettings(maxDaysPerWeek: nil))) as! [String: Any]
        XCTAssertTrue(json["maxDaysPerWeek"] is NSNull)
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
