import XCTest
@testable import Pulso

final class WidgetSnapshotTests: XCTestCase {
    private let now = WidgetClock.instant(date: "2026-10-01", time: "12:00")!

    private func dose(_ time: String = "20:00", date: String = "2026-10-01") -> WidgetSnapshot.Dose {
        WidgetSnapshot.Dose(medicationId: "m1", name: "Metformina", doseText: "500 mg", date: date, time: time, due: WidgetClock.instant(date: date, time: time)!)
    }

    private func snapshot(date: String = "2026-10-01") -> WidgetSnapshot {
        WidgetSnapshot(
            updatedAt: now, date: date,
            recovery: .init(score: 72, level: "medium", explanation: "Dormiste poco."),
            macros: .init(kcal: 1_200, kcalTarget: 2_000, protein: 80, proteinTarget: 150),
            nextDose: dose(date: date), dosesLeft: 2,
            workout: .init(programName: "Fuerza", dayName: "Torso A", focus: nil, exercises: 6)
        )
    }

    func testRoundTripsThroughJSON() throws {
        let original = snapshot()
        XCTAssertEqual(try SnapshotStore.decode(SnapshotStore.encode(original)), original)
    }

    func testDecodesTheStoredFormat() throws {
        // What an older app build may have left in the App Group: dates in epoch ms, absent sections omitted.
        let json = """
        {"updatedAt":1790852400000,"date":"2026-10-01","dosesLeft":0,
         "recovery":{"score":null,"level":"unknown","explanation":"Faltan datos."}}
        """
        let decoded = try SnapshotStore.decode(Data(json.utf8))
        XCTAssertEqual(decoded.updatedAt, Date(timeIntervalSince1970: 1_790_852_400))
        XCTAssertNil(decoded.recovery?.score)
        XCTAssertEqual(decoded.recovery?.levelLabel, "Sin datos")
        XCTAssertNil(decoded.macros)
        XCTAssertNil(decoded.workout)
    }

    func testSavesAndLoadsFromAFile() {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("snapshot-\(UUID().uuidString).json")
        defer { SnapshotStore.clear(at: url) }
        XCTAssertNil(SnapshotStore.load(from: url))
        SnapshotStore.save(snapshot(), to: url)
        XCTAssertEqual(SnapshotStore.load(from: url), snapshot())
        SnapshotStore.clear(at: url)
        XCTAssertNil(SnapshotStore.load(from: url))
    }

    func testMacrosLeftClampAndResetOnANewDay() {
        let over = WidgetSnapshot.Macros(kcal: 2_300, kcalTarget: 2_000, protein: 80, proteinTarget: nil)
        XCTAssertEqual(over.kcalLeft, 0)
        XCTAssertEqual(over.kcalProgress, 1)
        XCTAssertNil(over.proteinLeft)
        XCTAssertEqual(over.proteinProgress, 0)

        let old = snapshot(date: "2026-09-30")
        XCTAssertEqual(old.macros(on: "2026-09-30")?.kcal, 1_200)
        XCTAssertEqual(old.macros(on: "2026-10-01")?.kcal, 0)
        XCTAssertEqual(old.macros(on: "2026-10-01")?.kcalLeft, 2_000)
    }

    func testPartialRefreshKeepsWhatFailed() {
        let old = snapshot()
        let update = WidgetSnapshot.Update(recovery: .init(score: 90, level: "high", explanation: ""), macros: nil, doses: nil, workout: nil)
        let fresh = WidgetSnapshot.applying(update, to: old, now: now.addingTimeInterval(60))
        XCTAssertEqual(fresh.recovery?.score, 90)
        XCTAssertEqual(fresh.macros, old.macros)
        XCTAssertEqual(fresh.nextDose, old.nextDose)
        XCTAssertEqual(fresh.dosesLeft, 2)
        XCTAssertEqual(fresh.workout, old.workout)
        XCTAssertEqual(fresh.updatedAt, now.addingTimeInterval(60))
    }

    func testANewDayDropsYesterdaysMacrosAndDoses() {
        let old = snapshot(date: "2026-09-30")
        let fresh = WidgetSnapshot.applying(.init(), to: old, now: now)
        XCTAssertEqual(fresh.date, "2026-10-01")
        XCTAssertNil(fresh.macros)
        XCTAssertNil(fresh.nextDose)
        XCTAssertEqual(fresh.dosesLeft, 0)
        XCTAssertEqual(fresh.recovery, old.recovery)
    }

    func testFetchedNothingPendingAndNoProgramClearSections() {
        let update = WidgetSnapshot.Update(doses: (next: nil, left: 0), workout: .some(nil))
        XCTAssertFalse(update.isEmpty)
        let fresh = WidgetSnapshot.applying(update, to: snapshot(), now: now)
        XCTAssertNil(fresh.nextDose)
        XCTAssertEqual(fresh.dosesLeft, 0)
        XCTAssertNil(fresh.workout)
        XCTAssertTrue(WidgetSnapshot.Update().isEmpty)
    }

    func testMedicationDayBecomesTheNextDose() throws {
        let json = """
        {"date":"2026-10-01","asNeeded":[],
         "slots":[
          {"medicationId":"m1","name":"Metformina","kind":"medicamento","dose":500,"unit":"mg","date":"2026-10-01","time":"08:00","status":"tomada"},
          {"medicationId":"m1","name":"Metformina","kind":"medicamento","dose":500,"unit":"mg","date":"2026-10-01","time":"20:00","status":"pendiente"},
          {"medicationId":"m2","name":"Vitamina D","kind":"suplemento","dose":1,"unit":"comprimido","date":"2026-10-01","time":"22:00","status":"pendiente"}],
         "next":{"medicationId":"m1","name":"Metformina","kind":"medicamento","dose":500,"unit":"mg","date":"2026-10-01","time":"20:00","status":"pendiente"}}
        """
        let day = try JSONDecoder().decode(WidgetEngine.MedicationDayResponse.self, from: Data(json.utf8))
        XCTAssertEqual(day.doses.left, 2)
        XCTAssertEqual(day.doses.next, dose("20:00"))
        XCTAssertEqual(day.doses.next?.doseText, "500 mg")
    }
}

final class IntentParameterTests: XCTestCase {
    func testDoseIntentCarriesTheWidgetsDose() {
        let dose = WidgetSnapshot.Dose(medicationId: "m1", name: "Metformina", doseText: "500 mg", date: "2026-10-01", time: "20:00", due: WidgetClock.instant(date: "2026-10-01", time: "20:00")!)
        var intent = TakeDoseIntent(dose)
        XCTAssertEqual(intent.dose, dose)

        intent.time = "8pm"
        XCTAssertNil(intent.dose)
        intent.time = "20:00"
        intent.medicationId = ""
        XCTAssertNil(intent.dose)
        XCTAssertEqual(DosePhrase.taken(dose), "Listo, anoté Metformina (500 mg) como tomada.")
    }

    func testWeightConvertsRoundsAndRejectsNonsense() throws {
        XCTAssertEqual(try WeightInput.kilograms(Measurement(value: 78.44, unit: .kilograms)), 78.4)
        XCTAssertEqual(try WeightInput.kilograms(Measurement(value: 180, unit: .pounds)), 81.6)
        XCTAssertThrowsError(try WeightInput.kilograms(Measurement(value: 7, unit: .kilograms)))
        XCTAssertThrowsError(try WeightInput.kilograms(Measurement(value: 780, unit: .kilograms))) { error in
            XCTAssertEqual((error as? IntentFailure)?.message, "780 kg no parece un peso. Probá de nuevo.")
        }
    }

    func testWeightSampleIsAOneOffReading() {
        let now = Date(timeIntervalSince1970: 1_790_852_400)
        let id = UUID()
        let sample = WeightInput.sample(kg: 78.4, at: now, id: id)
        XCTAssertEqual(sample, BodySample(externalId: "pulso-intent-\(id.uuidString)", metric: "weight", value: 78.4, measuredAt: 1_790_852_400_000))
        XCTAssertNotEqual(WeightInput.sample(kg: 78.4, at: now).externalId, WeightInput.sample(kg: 78.4, at: now).externalId)
    }

    func testMealTextIsTrimmedAndRequired() throws {
        XCTAssertEqual(try MealText.normalized("  dos huevos y una tostada \n"), "dos huevos y una tostada")
        XCTAssertThrowsError(try MealText.normalized("   ")) { error in
            XCTAssertEqual((error as? IntentFailure)?.message, "Decime qué comiste.")
        }
        XCTAssertThrowsError(try MealText.normalized(String(repeating: "a", count: MealText.maxLength + 1)))
        XCTAssertTrue(MealText.prompt("dos huevos", at: .now).contains("dos huevos"))
    }

    func testCoachReplyWaitsForTheEndOfTheTurn() async {
        let done = AsyncThrowingStream<AgentStreamEvent, Error> { c in
            c.yield(.start(messageId: "a", userMessageId: "u"))
            c.yield(.tool(name: "log_meal", status: .done))
            c.yield(.text("Anoté 2 huevos "))
            c.yield(.text("(140 kcal)."))
            c.yield(.done(messageId: "a"))
            c.finish()
        }
        let reply = await CoachReply.collect(done, timeout: .seconds(5))
        XCTAssertEqual(reply, "Anoté 2 huevos (140 kcal).")

        let failed = AsyncThrowingStream<AgentStreamEvent, Error> { c in
            c.yield(.text("Anoté"))
            c.yield(.error("sin proveedor"))
            c.finish()
        }
        let failedReply = await CoachReply.collect(failed, timeout: .seconds(5))
        XCTAssertNil(failedReply)

        let slow = AsyncThrowingStream<AgentStreamEvent, Error> { c in c.yield(.text("pensando…")) }
        let slowReply = await CoachReply.collect(slow, timeout: .milliseconds(50))
        XCTAssertNil(slowReply)
    }

    func testReadinessPhrase() {
        let ready = Readiness(date: "2026-10-01", score: 81, level: "high", factors: [], explanation: "Dormiste 8 h.", baselineDays: 14)
        XCTAssertEqual(ReadinessPhrase.text(ready), "Tu recuperación está en 81 de 100: lista para exigirte. Dormiste 8 h.")
        let unknown = Readiness(date: "2026-10-01", score: nil, level: "unknown", factors: [], explanation: "Faltan noches.", baselineDays: 0)
        XCTAssertTrue(ReadinessPhrase.text(unknown).hasPrefix("Todavía no tengo datos"))
    }
}
