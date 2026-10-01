import XCTest
@testable import Pulso

final class MedicationTests: XCTestCase {
    private let calendar = Calendar(identifier: .gregorian)

    private func med(id: String = "m1", times: [String] = ["08:00", "20:00"], days: [Int] = [], asNeeded: Bool = false, endDate: String? = nil) -> Medication {
        Medication(
            id: id, name: "Metformina", kind: .medicamento, dose: 500, unit: "mg", form: nil, instructions: "con comida",
            schedule: MedicationSchedule(asNeeded: asNeeded, times: times, days: days),
            startDate: "2026-09-01", endDate: endDate, stock: nil, lowStockThreshold: nil, lowStock: false, active: true, notes: nil
        )
    }

    private func at(_ date: String, _ time: String) -> Date {
        LocalClock.instant(date: date, time: time, calendar: calendar)!
    }

    func testPlanSkipsPastAndHandledSlots() {
        let now = at("2026-10-01", "12:00") // jueves
        let plan = MedicationNotifications.plan(medications: [med()], handled: ["m1|2026-10-01|20:00"], now: now, days: 2, calendar: calendar)
        XCTAssertEqual(plan.map { "\($0.date) \($0.time)" }, ["2026-10-02 08:00", "2026-10-02 20:00"])
        XCTAssertEqual(plan.first?.identifier, "pulso.medication.m1.2026-10-02.08:00")
    }

    func testPlanFollowsWeekdaysEndDateAndAsNeeded() {
        let now = at("2026-10-01", "00:00") // jueves
        let meds = [
            med(id: "lun", times: ["09:00"], days: [1]),
            med(id: "fin", times: ["09:00"], endDate: "2026-10-02"),
            med(id: "prn", asNeeded: true),
        ]
        let plan = MedicationNotifications.plan(medications: meds, handled: [], now: now, days: 7, calendar: calendar)
        XCTAssertEqual(plan.filter { $0.medicationId == "lun" }.map(\.date), ["2026-10-05"])
        XCTAssertEqual(plan.filter { $0.medicationId == "fin" }.map(\.date), ["2026-10-01", "2026-10-02"])
        XCTAssertTrue(plan.allSatisfy { $0.medicationId != "prn" })
    }

    func testPlanIsCappedForIOS() {
        let busy = med(times: (0..<12).map { String(format: "%02d:30", $0 * 2) })
        let plan = MedicationNotifications.plan(medications: [busy], handled: [], now: at("2026-10-01", "00:00"), days: 7, calendar: calendar)
        XCTAssertEqual(plan.count, MedicationNotifications.maxPending)
        XCTAssertEqual(plan, plan.sorted { $0.fireAt < $1.fireAt })
    }

    func testIsoWeekdayStartsOnMonday() {
        XCTAssertEqual(LocalClock.isoWeekday(at("2026-10-05", "10:00"), calendar: calendar), 1)
        XCTAssertEqual(LocalClock.isoWeekday(at("2026-10-04", "10:00"), calendar: calendar), 7)
    }

    func testDraftEncodesClearedFieldsAsNull() throws {
        var draft = MedicationDraft(med())
        draft.instructions = nil
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft)) as! [String: Any]
        XCTAssertTrue(json["instructions"] is NSNull)
        XCTAssertTrue(json["endDate"] is NSNull)
        XCTAssertEqual(json["name"] as? String, "Metformina")
    }

    func testSlotDecodesFromEngine() throws {
        let body = #"{"medicationId":"m1","name":"Metformina","kind":"medicamento","dose":500,"unit":"mg","instructions":null,"date":"2026-10-01","time":"08:00","status":"pendiente","eventId":null,"takenAt":null}"#
        let slot = try JSONDecoder().decode(DoseSlot.self, from: Data(body.utf8))
        XCTAssertEqual(slot.id, "m1|2026-10-01|08:00")
        XCTAssertEqual(slot.status, .pendiente)
    }
}
