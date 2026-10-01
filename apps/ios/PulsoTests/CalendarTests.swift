import XCTest
@testable import Pulso

final class CalendarTests: XCTestCase {
    private let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Europe/Madrid")!
        return c
    }()

    private func day(_ value: String) -> Date {
        calendar.date(from: DateComponents(year: Int(value.prefix(4)), month: Int(value.dropFirst(5).prefix(2)), day: Int(value.suffix(2))))!
    }

    private func string(_ date: Date) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    private func item(_ start: String?, _ end: String?, allDay: Bool = false) -> CalendarItem {
        CalendarItem(id: UUID().uuidString, kind: .busy, title: "x", subtitle: nil, date: "2026-10-01", start: start, end: end, allDay: allDay, color: "busy", status: nil, link: CalendarLink(tab: "calendario", id: nil))
    }

    func testWeeksStartOnMonday() {
        // 2026-10-01 is a Thursday; 2026-10-04 a Sunday.
        XCTAssertEqual(string(CalendarMath.weekStart(day("2026-10-01"), calendar: calendar)), "2026-09-28")
        XCTAssertEqual(string(CalendarMath.weekStart(day("2026-10-04"), calendar: calendar)), "2026-09-28")
        XCTAssertEqual(string(CalendarMath.weekStart(day("2026-10-05"), calendar: calendar)), "2026-10-05")
        XCTAssertEqual(CalendarMath.week(of: day("2026-10-01"), calendar: calendar).map(string).last, "2026-10-04")
    }

    func testMonthGridCoversWholeWeeks() {
        // October 2026: Thursday 1st to Saturday 31st → 28 Sep … 1 Nov, five weeks.
        let grid = CalendarMath.monthGrid(day("2026-10-15"), calendar: calendar)
        XCTAssertEqual(grid.count, 35)
        XCTAssertEqual(string(grid.first!), "2026-09-28")
        XCTAssertEqual(string(grid.last!), "2026-11-01")
        // February 2027 starts on a Monday and has exactly four weeks.
        XCTAssertEqual(CalendarMath.monthGrid(day("2027-02-10"), calendar: calendar).count, 28)
    }

    func testWeeksBetweenSurvivesDaylightSaving() {
        // Spain moves clocks back on 2026-10-25.
        XCTAssertEqual(CalendarMath.weeksBetween(day("2026-10-21"), day("2026-10-28"), calendar: calendar), 1)
        XCTAssertEqual(CalendarMath.weeksBetween(day("2026-10-28"), day("2026-10-01"), calendar: calendar), -4)
    }

    func testMinutesClampToTheDay() {
        XCTAssertEqual(CalendarMath.minute("2026-10-01T18:30", on: "2026-10-01"), 1110)
        XCTAssertEqual(CalendarMath.minute("2026-09-30T23:10", on: "2026-10-01"), 0)
        XCTAssertEqual(CalendarMath.minute("2026-10-02T07:00", on: "2026-10-01"), 1440)
    }

    func testSpansForTimedPointAndAllDayItems() {
        XCTAssertEqual(CalendarMath.span(of: item("2026-10-01T10:00", "2026-10-01T11:30"), on: "2026-10-01")?.end, 690)
        // A dose has no end: it gets a short default block.
        XCTAssertEqual(CalendarMath.span(of: item("2026-10-01T09:00", nil), on: "2026-10-01")?.end, 570)
        // Sleep that began the evening before starts at midnight on the wake day.
        XCTAssertEqual(CalendarMath.span(of: item("2026-09-30T23:30", "2026-10-01T07:00"), on: "2026-10-01")?.start, 0)
        XCTAssertNil(CalendarMath.span(of: item(nil, nil, allDay: true), on: "2026-10-01"))
    }

    func testOverlappingSpansShareColumns() {
        let layout = CalendarMath.columns([(600, 660), (630, 700), (640, 650), (720, 780)])
        XCTAssertEqual(layout.map(\.column), [0, 1, 2, 0])
        XCTAssertEqual(layout.map(\.of), [3, 3, 3, 1])
        // A column frees up once its block ends.
        let reuse = CalendarMath.columns([(600, 630), (600, 700), (640, 660)])
        XCTAssertEqual(reuse.map(\.column), [0, 1, 0])
        XCTAssertEqual(reuse.map(\.of), [2, 2, 2])
    }

    func testAppleCalendarEventsBecomeBusyBlocks() {
        let tz = TimeZone.current
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = tz
        let at = { (d: Int, h: Int, m: Int) in cal.date(from: DateComponents(year: 2026, month: 10, day: d, hour: h, minute: m))! }
        let meeting = AppleCalendarBusy.busy(id: "1", title: "Reunión", allDay: false, start: at(1, 10, 0), end: at(1, 11, 30), calendar: cal)
        XCTAssertEqual(meeting, .init(externalId: "1", title: "Reunión", allDay: false, date: "2026-10-01", start: "10:00", end: "11:30"))
        let late = AppleCalendarBusy.busy(id: "2", title: "Cena", allDay: false, start: at(1, 22, 0), end: at(2, 1, 0), calendar: cal)
        XCTAssertEqual(late.end, "23:59")
        // EventKit ends all-day events at the next midnight; the block keeps its real last day.
        let trip = AppleCalendarBusy.busy(id: "3", title: "Viaje", allDay: true, start: at(5, 0, 0), end: at(8, 0, 0), calendar: cal)
        XCTAssertEqual(trip.endDate, "2026-10-07")
    }

    func testDraftsClearFieldsThatDoNotApply() throws {
        var draft = BusyBlockDraft()
        draft.title = " Viaje "
        draft.allDay = true
        draft.endDate = "2026-10-08"
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft)) as! [String: Any]
        XCTAssertEqual(json["title"] as? String, "Viaje")
        XCTAssertTrue(json["start"] is NSNull)
        XCTAssertEqual(json["endDate"] as? String, "2026-10-08")
        XCTAssertTrue(json["until"] is NSNull)
    }

    func testTimelineDecodes() throws {
        let body = """
        {"from":"2026-10-01","to":"2026-10-01","items":[{"id":"plan:1","kind":"training","title":"Pierna","subtitle":"Conflicto: Viaje","date":"2026-10-01",
        "start":"2026-10-01T18:00","end":"2026-10-01T19:00","allDay":false,"color":"training","status":"moved","link":{"tab":"entreno","id":"d1"}}]}
        """
        let range = try JSONDecoder().decode(CalendarRange.self, from: Data(body.utf8))
        XCTAssertEqual(range.items.first?.statusLabel, "Movida")
        XCTAssertTrue(range.items.first?.hasConflict == true)
    }
}
