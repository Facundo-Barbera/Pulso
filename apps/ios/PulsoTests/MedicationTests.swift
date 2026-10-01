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
        XCTAssertEqual(plan.map { "\($0.date) \($0.slot)" }, ["2026-10-02 08:00", "2026-10-02 20:00"])
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

    func testSlotFromAnOlderEngineIsKeyedByItsTime() throws {
        let body = #"{"medicationId":"m1","name":"Metformina","kind":"medicamento","dose":500,"unit":"mg","instructions":null,"date":"2026-10-01","time":"08:00","status":"pendiente","eventId":null,"takenAt":null}"#
        let slot = try JSONDecoder().decode(DoseSlot.self, from: Data(body.utf8))
        XCTAssertEqual(slot.id, "m1|2026-10-01|08:00")
        XCTAssertEqual(slot.moment, .hora)
        XCTAssertEqual(slot.status, .pendiente)
    }

    // MARK: Slots tied to moments

    func testTrainingSlotDecodesAndLogsUnderItsKey() throws {
        let body = #"""
        {"medicationId":"c1","name":"Creatina","kind":"suplemento","dose":5,"unit":"g","instructions":null,"date":"2026-10-01",
         "slot":"entreno","moment":"entreno","time":null,
         "training":{"state":"planned","workoutEnd":null,"until":null,"plannedAt":"18:00","fallback":"19:30"},
         "status":"pendiente","eventId":null,"takenAt":null}
        """#
        let slot = try JSONDecoder().decode(DoseSlot.self, from: Data(body.utf8))
        XCTAssertEqual(slot.id, "c1|2026-10-01|entreno")
        XCTAssertNil(slot.time)
        XCTAssertEqual(slot.training, TrainingSlot(state: .planned, plannedAt: "18:00", fallback: "19:30"))
        XCTAssertEqual(slot.log(.tomada).scheduledTime, "entreno")
    }

    func testScheduleDecodesOldShapeAndEncodesEveryField() throws {
        let old = try JSONDecoder().decode(MedicationSchedule.self, from: Data(#"{"asNeeded":false,"times":["08:00"],"days":[]}"#.utf8))
        XCTAssertEqual(old, MedicationSchedule(asNeeded: false, times: ["08:00"], days: []))

        let creatine = MedicationSchedule(asNeeded: false, times: [], days: [], training: TrainingRule(withinMinutes: 45, restDayTime: nil))
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(creatine)) as! [String: Any]
        XCTAssertEqual(json["meals"] as? [String], [])
        XCTAssertEqual(json["bedtime"] as? Bool, false)
        let training = json["training"] as! [String: Any]
        XCTAssertEqual(training["withinMinutes"] as? Int, 45)
        XCTAssertTrue(training["restDayTime"] is NSNull, "No tomar must reach the engine as null")
        XCTAssertTrue(MedicationSchedule.asNeededOnly.encodedTraining is NSNull)

        let full = #"{"asNeeded":false,"times":[],"days":[1,3],"training":null,"meals":["desayuno","cena"],"bedtime":true}"#
        let decoded = try JSONDecoder().decode(MedicationSchedule.self, from: Data(full.utf8))
        XCTAssertEqual(decoded.meals, [.desayuno, .cena])
        XCTAssertTrue(decoded.bedtime)
    }

    func testUpcomingDecodes() throws {
        let body = #"{"from":"2026-10-01","slots":[{"medicationId":"m1","name":"Vitamina D","kind":"suplemento","dose":1000,"unit":"UI","instructions":null,"date":"2026-10-01","slot":"desayuno","moment":"desayuno","time":"08:30","training":null,"status":"pendiente","eventId":null,"takenAt":null}]}"#
        let upcoming = try JSONDecoder().decode(MedicationUpcoming.self, from: Data(body.utf8))
        XCTAssertEqual(upcoming.slots.map(\.slot), ["desayuno"])
        XCTAssertEqual(upcoming.slots.first?.moment, .desayuno)
    }

    func testTrainingStatusLines() {
        XCTAssertEqual(TrainingSlot(state: .training).status, "Entrenando…")
        XCTAssertTrue(TrainingSlot(state: .planned, plannedAt: "18:00").status.hasPrefix("Al terminar tu sesión de las"))
        XCTAssertTrue(TrainingSlot(state: .rest, fallback: "09:00").status.hasPrefix("Hoy descansas · "))
        XCTAssertTrue(TrainingSlot(state: .trained, workoutEnd: "19:05", until: "19:50").status.contains("tómala antes de las"))
        XCTAssertEqual(DoseMoment.label(slotKey: "entreno"), "después de entrenar")
        XCTAssertEqual(DoseMoment.label(slotKey: "dormir"), "antes de dormir")
    }

    func testGroupsFollowTheDaysOrder() {
        let slots = [
            slot("m1", "08:00", time: "08:00"),
            slot("v", "desayuno", moment: .desayuno, time: "08:30"),
            slot("m1", "20:00", time: "20:00"),
            slot("c", "entreno", moment: .entreno, time: nil, training: TrainingSlot(state: .training, fallback: "21:00")),
        ]
        let groups = DoseGroup.of(slots)
        XCTAssertEqual(groups.map(\.moment), [.hora, .desayuno, .entreno])
        XCTAssertEqual(groups.first?.slots.map(\.slot), ["08:00", "20:00"])
        XCTAssertEqual(groups.last?.trainingStatus?.state, .training)
    }

    // MARK: Reminders from resolved slots

    private func slot(_ med: String, _ key: String, date: String = "2026-10-01", moment: DoseMoment = .hora, time: String?,
                      training: TrainingSlot? = nil, status: DoseStatus = .pendiente) -> DoseSlot {
        DoseSlot(medicationId: med, name: "Creatina", kind: .suplemento, dose: 5, unit: "g", date: date, slot: key,
                 moment: moment, time: time, training: training, status: status)
    }

    func testPlanFromSlotsFiresAtTimesAndSkipsPastAndLogged() {
        let now = at("2026-10-01", "12:00")
        let slots = [
            slot("a", "08:00", time: "08:00"),
            slot("a", "20:00", time: "20:00"),
            slot("b", "cena", moment: .cena, time: "21:00", status: .tomada),
            slot("b", "cena", date: "2026-10-02", moment: .cena, time: "21:00"),
        ]
        let plan = MedicationNotifications.plan(slots: slots, now: now, calendar: calendar)
        XCTAssertEqual(plan.map { "\($0.date) \($0.slot)" }, ["2026-10-01 20:00", "2026-10-02 cena"])
        XCTAssertEqual(plan.last?.identifier, "pulso.medication.b.2026-10-02.cena")
        XCTAssertEqual(plan.last?.body, "5 g · con la cena")
    }

    func testWaitingTrainingSlotFiresAtTheRestDayFallback() {
        let now = at("2026-10-01", "12:00")
        let waiting = slot("c", "entreno", moment: .entreno, time: nil, training: TrainingSlot(state: .planned, plannedAt: "18:00", fallback: "19:30"))
        let noRestDose = slot("w", "entreno", moment: .entreno, time: nil, training: TrainingSlot(state: .planned, plannedAt: "18:00", fallback: nil))
        let plan = MedicationNotifications.plan(slots: [waiting, noRestDose], now: now, calendar: calendar)
        XCTAssertEqual(plan.count, 1)
        XCTAssertEqual(plan.first?.fireAt, at("2026-10-01", "19:30"))
        XCTAssertEqual(plan.first?.title, "Toma tu creatina")
        XCTAssertEqual(plan.first?.slot, "entreno")
        XCTAssertFalse(plan.first!.catchUp)
    }

    func testTrainedSlotFiresAtTheWorkoutEndOrCatchesUpOnce() {
        let trained = TrainingSlot(state: .trained, workoutEnd: "19:05", until: "19:50")
        let due = slot("c", "entreno", moment: .entreno, time: "19:05", training: trained)

        // Synced before the end (a Health workout dated ahead): fires at the end.
        let early = MedicationNotifications.plan(slots: [due], now: at("2026-10-01", "19:00"), calendar: calendar)
        XCTAssertEqual(early.first?.fireAt, at("2026-10-01", "19:05"))

        // Ended already and still in the window: fires in a few seconds, once.
        let now = at("2026-10-01", "19:20")
        let soon = MedicationNotifications.plan(slots: [due], now: now, calendar: calendar)
        XCTAssertEqual(soon.first?.fireAt, now.addingTimeInterval(MedicationNotifications.catchUpDelay))
        XCTAssertTrue(soon.first!.catchUp)
        XCTAssertTrue(soon.first!.body.hasPrefix("5 g · antes de las"))
        XCTAssertTrue(MedicationNotifications.plan(slots: [due], now: now, nudged: [due.id], calendar: calendar).isEmpty)

        // Past the window: nothing.
        XCTAssertTrue(MedicationNotifications.plan(slots: [due], now: at("2026-10-01", "20:00"), calendar: calendar).isEmpty)
    }

    func testPlanFromSlotsIsCapped() {
        let slots = (0..<80).map { i in slot("m\(i)", "23:00", date: "2026-10-02", time: "23:00") }
        XCTAssertEqual(MedicationNotifications.plan(slots: slots, now: at("2026-10-01", "00:00"), calendar: calendar).count, MedicationNotifications.maxPending)
    }
}

private extension MedicationSchedule {
    var encodedTraining: Any? {
        let data = try! JSONEncoder().encode(self)
        return (try! JSONSerialization.jsonObject(with: data) as! [String: Any])["training"]
    }
}
