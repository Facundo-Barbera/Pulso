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
        XCTAssertTrue(decoded.isMixed)
        XCTAssertEqual(decoded.type, .meal)
    }

    func testUpcomingDecodes() throws {
        let body = #"{"from":"2026-10-01","slots":[{"medicationId":"m1","name":"Vitamina D","kind":"suplemento","dose":1000,"unit":"UI","instructions":null,"date":"2026-10-01","slot":"desayuno","moment":"desayuno","time":"08:30","training":null,"status":"pendiente","eventId":null,"takenAt":null}]}"#
        let upcoming = try JSONDecoder().decode(MedicationUpcoming.self, from: Data(body.utf8))
        XCTAssertEqual(upcoming.slots.map(\.slot), ["desayuno"])
        XCTAssertEqual(upcoming.slots.first?.moment, .desayuno)
    }

    func testSwitchingScheduleTypeKeepsDaysAndStartsWithADefault() {
        var schedule = MedicationSchedule(asNeeded: false, times: ["08:00"], days: [1, 2])
        schedule.become(.training)
        XCTAssertEqual(schedule, MedicationSchedule(asNeeded: false, times: [], days: [1, 2], training: TrainingRule(withinMinutes: 60, restDayTime: "09:00")))
        schedule.become(.meal)
        XCTAssertEqual(schedule.meals, [.desayuno])
        XCTAssertNil(schedule.training)
        schedule.become(.asNeeded)
        XCTAssertEqual(schedule, .asNeededOnly)
    }

    func testCreatinePresetIsAfterTrainingWithARestDayTime() {
        var draft = MedicationDraft()
        SupplementPreset.all.first { $0.name == "Creatina" }!.apply(to: &draft)
        XCTAssertEqual(draft.kind, .suplemento)
        XCTAssertEqual("\(draft.dose.formatted()) \(draft.unit)", "5 g")
        XCTAssertEqual(draft.schedule.training, TrainingRule(withinMinutes: 60, restDayTime: "09:00"))
        XCTAssertTrue(draft.schedule.hasSlots)
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

    // MARK: Today's timeline

    private func item(_ name: String, _ schedule: MedicationSchedule, kind: MedicationKind = .medicamento) -> Medication {
        Medication(id: name, name: name, kind: kind, dose: 1, unit: "comprimido", form: nil, instructions: nil, schedule: schedule,
                   startDate: "2026-09-01", endDate: nil, stock: nil, lowStockThreshold: nil, lowStock: false, active: true, notes: nil)
    }

    func testTimelineGivesEveryMedOneStateForToday() {
        let today = "2026-10-01" // jueves
        let now = at(today, "12:00")
        let fixed = { (time: String, days: [Int]) in MedicationSchedule(asNeeded: false, times: [time], days: days) }
        let meds = [
            item("Levotiroxina", .asNeededOnly),
            item("Semaglutida", .asNeededOnly),
            item("Creatina", MedicationSchedule(asNeeded: false, times: [], days: [], training: TrainingRule(restDayTime: nil)), kind: .suplemento),
            item("Magnesio", fixed("08:00", [])),
            item("Omega 3", fixed("11:30", [])),
            item("Hierro", fixed("10:00", [7])),
            item("Zinc", fixed("15:00", [])),
        ]
        let slot = { (id: String, time: String) in
            DoseSlot(medicationId: id, name: id, kind: .medicamento, dose: 1, unit: "comprimido", date: today, slot: time, time: time, status: .pendiente)
        }
        let day = MedicationDay(date: today, slots: [slot("Magnesio", "08:00"), slot("Omega 3", "11:30"), slot("Zinc", "15:00")], asNeeded: [], next: nil)
        let ms = { (date: Date) in date.timeIntervalSince1970 * 1000 }
        let history = [
            DoseEvent(id: "e1", medicationId: "Levotiroxina", date: today, scheduledTime: nil, status: .tomada, takenAt: ms(at(today, "09:56"))),
            DoseEvent(id: "e2", medicationId: "Semaglutida", date: "2026-09-27", scheduledTime: nil, status: .tomada, takenAt: ms(at("2026-09-27", "10:20"))),
        ]

        let items = TodayItem.build(medications: meds, day: day, history: history, now: now, calendar: calendar)
        XCTAssertEqual(items.map(\.medication.name), ["Magnesio", "Levotiroxina", "Omega 3", "Zinc", "Semaglutida", "Creatina", "Hierro"])
        XCTAssertEqual(items.map(\.state), [.atrasada, .aDemanda, .ahora, .pendiente, .aDemanda, .noToca, .noToca])
        let sunday = TodayItem.shortDay(LocalClock.day("2026-10-04")!)
        XCTAssertEqual(items.map(\.line)[2...], ["Toca ahora", "En 3 h", "Última el domingo", "hoy es descanso", "próxima: \(sunday)"])
        XCTAssertEqual(items[5...].map(\.when), ["Después de entrenar", "Domingo · \(LocalClock.display("10:00"))"])
        XCTAssertEqual(items[0].line, "Se pasó hace 4 h")
        XCTAssertEqual(items[1].at, "09:56")
        XCTAssertEqual(items.filter(\.isLeft).map(\.medication.name), ["Magnesio", "Omega 3", "Zinc"])
    }

    func testUsualAsNeededMedsAreNamedUntilTaken() {
        let today = "2026-10-02"
        let now = at(today, "10:30")
        let meds = [item("Levotiroxina", .asNeededOnly), item("Ibuprofeno", .asNeededOnly), item("Semaglutida", .asNeededOnly)]
        let taken = { (id: String, date: String) in DoseEvent(id: "\(id)\(date)", medicationId: id, date: date, scheduledTime: nil, status: .tomada, takenAt: nil) }
        let history = ["2026-09-26", "2026-09-28", "2026-09-30", "2026-10-01"].map { taken("Levotiroxina", $0) } + [taken("Ibuprofeno", "2026-09-30")]
        let nudge = ScheduleNudge(medicationId: "Semaglutida", name: "Semaglutida", cadence: .weekly, title: "", detail: "", schedule: .asNeededOnly)
        let items = TodayItem.build(medications: meds, day: nil, history: history, now: now, calendar: calendar)
        XCTAssertEqual(TodayItem.usual(items, nudges: [nudge], history: history, now: now, calendar: calendar), ["Levotiroxina"])

        // A daily suggestion counts on its own; a dose taken today takes it off.
        var daily = nudge
        daily.cadence = .daily
        XCTAssertEqual(TodayItem.usual(items, nudges: [daily], history: history, now: now, calendar: calendar), ["Levotiroxina", "Semaglutida"])
        let after = history + [DoseEvent(id: "now", medicationId: "Levotiroxina", date: today, scheduledTime: nil, status: .tomada, takenAt: now.timeIntervalSince1970 * 1000)]
        let later = TodayItem.build(medications: meds, day: nil, history: after, now: now, calendar: calendar)
        XCTAssertEqual(TodayItem.usual(later, nudges: [], history: after, now: now, calendar: calendar), [])
    }

    // MARK: Flexible schedules

    func testFlexibleScheduleDecodesEncodesAndReads() throws {
        let body = #"{"asNeeded":false,"times":[],"days":[4],"interval":null,"monthDay":null,"training":null,"meals":[],"bedtime":false,"windows":[{"part":"manana","start":"07:00","end":"12:00"}],"anyTime":true,"reminder":"19:00"}"#
        let sema = try JSONDecoder().decode(MedicationSchedule.self, from: Data(body.utf8))
        XCTAssertTrue(sema.anyTime)
        XCTAssertEqual(sema.reminder, "19:00")
        XCTAssertEqual(sema.windows, [DoseWindow(part: .manana)])
        XCTAssertEqual(sema.frequency, .someDays)

        var quiet = MedicationSchedule(asNeeded: false, times: [], days: [4], anyTime: true)
        XCTAssertEqual(quiet.line, "Semanal · jueves · cualquier hora")
        quiet.reminder = nil
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(quiet)) as! [String: Any]
        XCTAssertTrue(json["reminder"] is NSNull, "Sin aviso must reach the engine as null")
        XCTAssertEqual(json["anyTime"] as? Bool, true)
        XCTAssertTrue(json["interval"] is NSNull)

        let slot = try JSONDecoder().decode(DoseSlot.self, from: Data(#"{"medicationId":"s","name":"Semaglutida","kind":"medicamento","dose":1,"unit":"mg","instructions":null,"date":"2026-10-01","slot":"dia","moment":"dia","time":null,"training":null,"window":null,"remindAt":"19:00","status":"pendiente","eventId":null,"takenAt":null}"#.utf8))
        XCTAssertEqual(slot.moment, .dia)
        XCTAssertEqual(slot.remindAt, "19:00")
        XCTAssertEqual(DoseMoment.label(slotKey: "dia"), "cualquier hora")
    }

    func testFrequencyMatchesTheEngine() {
        let every3 = MedicationSchedule(asNeeded: false, times: ["08:00"], days: [], interval: ScheduleInterval(every: 3, unit: .day, start: "2026-10-01"))
        XCTAssertEqual(["2026-09-28", "2026-10-01", "2026-10-02", "2026-10-04"].map(every3.isDue), [false, true, false, true])
        // From Saturday 2026-09-26: that week counts, its Thursday came before the start.
        let fortnight = MedicationSchedule(asNeeded: false, times: [], days: [4], interval: ScheduleInterval(every: 2, unit: .week, start: "2026-09-26"), anyTime: true)
        XCTAssertEqual(["2026-09-24", "2026-10-01", "2026-10-08", "2026-10-15"].map(fortnight.isDue), [false, false, true, false])
        let on31 = MedicationSchedule(asNeeded: false, times: [], days: [], monthDay: 31, anyTime: true)
        XCTAssertEqual(["2026-10-31", "2026-11-30", "2026-11-29", "2026-02-28"].map(on31.isDue), [true, true, false, true])
        XCTAssertEqual(on31.line, "Cada mes · día 31 · cualquier hora")
    }

    func testEditorStepsKeepTheOtherHalfAndNothingElse() {
        var schedule = MedicationSchedule(asNeeded: false, times: ["08:00"], days: [])
        // Any time has no hour: no leftover time, and the reminder starts off.
        schedule.become(.anyTime)
        XCTAssertEqual(schedule, MedicationSchedule(asNeeded: false, times: [], days: [], anyTime: true, reminder: nil))
        schedule.reminder = "19:00"
        schedule.adopt(.someDays, today: "2026-10-01")
        XCTAssertEqual(schedule.days, [4])
        XCTAssertTrue(schedule.anyTime)
        schedule.adopt(.everyN, today: "2026-10-01")
        XCTAssertEqual(schedule.interval, ScheduleInterval(every: 2, unit: .week, start: "2026-10-01"))
        schedule.become(.window)
        XCTAssertEqual(schedule.windows, [DoseWindow(part: .manana)])
        XCTAssertNotNil(schedule.interval)
        // «Cuando haga falta» drops the timing; coming back starts fresh at 8:00.
        schedule.adopt(.asNeeded, today: "2026-10-01")
        XCTAssertEqual(schedule, .asNeededOnly)
        schedule.adopt(.monthly, today: "2026-10-01")
        XCTAssertEqual(schedule.monthDay, 1)
        XCTAssertNil(schedule.interval)
        XCTAssertEqual(schedule.type, .fixed)
        XCTAssertEqual(schedule.times, ["08:00"])
        XCTAssertTrue(schedule.windows.isEmpty)
    }

    func testEditorReadsTheScheduleBack() {
        let show = LocalClock.display
        let sema = MedicationSchedule(asNeeded: false, times: [], days: [4], anyTime: true, reminder: "19:00")
        XCTAssertEqual(sema.readBack, "Semanal · jueves · cuando quieras · aviso \(show("19:00")) si no la tomaste")
        XCTAssertEqual(MedicationSchedule(asNeeded: false, times: [], days: [], training: TrainingRule(withinMinutes: 60, restDayTime: nil)).readBack,
                       "Cada día · después de entrenar, dentro de 60 min · sin entreno, no")
        XCTAssertEqual(MedicationSchedule(asNeeded: false, times: ["08:00"], days: []).readBack, "Cada día · a las \(show("08:00"))")
        XCTAssertEqual(MedicationSchedule.asNeededOnly.readBack, "Cuando haga falta · sin horario ni avisos")
    }

    func testAnyTimeAndWindowRemindersUseRemindAt() {
        let now = at("2026-10-01", "12:00")
        let any = DoseSlot(medicationId: "s", name: "Semaglutida", kind: .medicamento, dose: 1, unit: "mg", date: "2026-10-01", slot: "dia",
                           moment: .dia, time: nil, remindAt: "19:00", status: .pendiente)
        var silent = any
        silent.medicationId = "q"
        silent.remindAt = nil
        let evening = DoseSlot(medicationId: "z", name: "Zinc", kind: .suplemento, dose: 1, unit: "cápsula", date: "2026-10-01", slot: "noche",
                               moment: .noche, time: "20:00", window: DoseWindow(part: .noche, start: "20:00", end: "23:00"), remindAt: "20:00", status: .pendiente)
        let plan = MedicationNotifications.plan(slots: [any, silent, evening], now: now, calendar: calendar)
        XCTAssertEqual(plan.map(\.slot), ["dia", "noche"])
        XCTAssertEqual(plan.first?.fireAt, at("2026-10-01", "19:00"))
        XCTAssertEqual(plan.first?.body, "1 mg · hoy, cuando puedas")
        XCTAssertEqual(plan.last?.body, "1 cápsula · en la noche")
    }

    func testTimelineShowsAnyTimeUntilTaken() {
        let today = "2026-10-01"
        let sema = item("Semaglutida", MedicationSchedule(asNeeded: false, times: [], days: [4], anyTime: true, reminder: "19:00"))
        let zinc = item("Zinc", MedicationSchedule(asNeeded: false, times: [], days: [], windows: [DoseWindow(part: .manana, start: "08:00", end: "13:00")]))
        let slots = [
            DoseSlot(medicationId: "Zinc", name: "Zinc", kind: .medicamento, dose: 1, unit: "comprimido", date: today, slot: "manana", moment: .manana,
                     time: "08:00", window: DoseWindow(part: .manana, start: "08:00", end: "13:00"), remindAt: "08:00", status: .pendiente),
            DoseSlot(medicationId: "Semaglutida", name: "Semaglutida", kind: .medicamento, dose: 1, unit: "comprimido", date: today, slot: "dia",
                     moment: .dia, time: nil, remindAt: "19:00", status: .pendiente),
        ]
        let items = TodayItem.build(medications: [sema, zinc], day: MedicationDay(date: today, slots: slots, asNeeded: [], next: nil), history: [],
                                    now: at(today, "12:00"), calendar: calendar)
        XCTAssertEqual(items.map(\.medication.name), ["Zinc", "Semaglutida"])
        XCTAssertEqual(items.map(\.state), [.ahora, .dia])
        XCTAssertEqual(items[1].line, "Hoy toca · cuando quieras")
        XCTAssertTrue(items[1].isLeft)
        XCTAssertEqual(items[0].line, "Cuando quieras hasta las \(LocalClock.display("13:00"))")

        let tomorrow = TodayItem.build(medications: [sema], day: MedicationDay(date: "2026-10-02", slots: [], asNeeded: [], next: nil), history: [],
                                       now: at("2026-10-02", "09:00"), calendar: calendar)
        XCTAssertEqual(tomorrow.first?.when, "Jueves · cualquier hora")
        XCTAssertEqual(tomorrow.first?.line, "próxima: \(TodayItem.shortDay(LocalClock.day("2026-10-08")!))")
    }
}

private extension MedicationSchedule {
    var encodedTraining: Any? {
        let data = try! JSONEncoder().encode(self)
        return (try! JSONSerialization.jsonObject(with: data) as! [String: Any])["training"]
    }
}
