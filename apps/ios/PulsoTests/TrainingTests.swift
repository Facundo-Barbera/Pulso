import XCTest
@testable import Pulso

final class TrainingTests: XCTestCase {
    private let day = ProgramDay(id: "d1", name: "Torso A", focus: nil, weekday: nil, exercises: [
        ProgramExercise(id: "pe1", exerciseId: "press-banca", exerciseName: "Press de banca", equipment: "barbell", sets: 3, repMin: 6, repMax: 8, targetRpe: nil, targetRir: 2, restSeconds: 120, notes: nil),
        ProgramExercise(id: "pe2", exerciseId: "curl-mancuernas", exerciseName: "Curl con mancuernas", equipment: "dumbbell", sets: 2, repMin: 10, repMax: 12, targetRpe: 8, targetRir: nil, restSeconds: 60, notes: nil),
    ])
    private let suggestions = ["pe1": LoadSuggestion(exerciseId: "press-banca", weightKg: 80, reps: 7, reason: "Mantén 80 kg", lastSessionAt: 1)]
    private let t0 = Date(timeIntervalSince1970: 1_000)

    func testPrefillsFromSuggestionsOrTheBottomOfTheRange() {
        let state = LiveSessionState(day: day, programId: "p", suggestions: suggestions, now: t0)
        XCTAssertEqual(state.exercises[0].sets.map(\.weightKg), [80, 80, 80])
        XCTAssertEqual(state.exercises[0].sets.map(\.reps), [7, 7, 7])
        XCTAssertEqual(state.exercises[1].sets.map(\.weightKg), [0, 0])
        XCTAssertEqual(state.exercises[1].sets.map(\.reps), [10, 10])
        XCTAssertEqual(state.exercises[0].prescription, "3 series de 6 a 8 repeticiones")
        XCTAssertEqual(state.exercises[1].weightStep, 1)
        XCTAssertEqual(state.setsTotal, 5)
    }

    func testCheckingASetStartsRestAndCarriesTheLoadForward() {
        var state = LiveSessionState(day: day, programId: "p", suggestions: suggestions, now: t0)
        state.stepWeight(exercise: 0, set: 0, up: true)
        state.toggle(exercise: 0, set: 0, now: t0.addingTimeInterval(60))
        XCTAssertEqual(state.exercises[0].sets.map(\.weightKg), [82.5, 82.5, 82.5])
        XCTAssertEqual(state.restEndsAt, t0.addingTimeInterval(180))
        XCTAssertTrue(state.resting(at: t0.addingTimeInterval(100)))
        XCTAssertEqual(state.current?.exercise, 0)
        XCTAssertEqual(state.current?.set, 1)

        state.extendRest(by: 15, now: t0.addingTimeInterval(100))
        XCTAssertEqual(state.restEndsAt, t0.addingTimeInterval(195))

        state.toggle(exercise: 0, set: 0)
        XCTAssertNil(state.restEndsAt)
        XCTAssertEqual(state.setsDone, 0)
    }

    func testTheLastSetStartsNoRest() {
        var state = LiveSessionState(day: day, programId: "p", suggestions: suggestions, now: t0)
        for (e, s) in [(0, 0), (0, 1), (0, 2), (1, 0), (1, 1)] { state.toggle(exercise: e, set: s, now: t0) }
        XCTAssertNil(state.current)
        XCTAssertNil(state.restEndsAt)
        XCTAssertEqual(state.activityState(now: t0).exerciseName, "Sesión completa")
    }

    func testWeightStepsOnTheUnitsGridAndNeverGoesNegative() {
        var state = LiveSessionState(day: day, programId: "p", suggestions: [:], now: t0)
        state.stepWeight(exercise: 0, set: 0, up: false)
        XCTAssertEqual(state.exercises[0].sets[0].weightKg, 0)
        for _ in 0..<3 { state.stepWeight(exercise: 0, set: 0, up: true) }
        XCTAssertEqual(state.exercises[0].sets[0].weightKg, 3, "1 kg steps up to 10 kg")
        for _ in 0..<3 { state.stepWeight(exercise: 1, set: 0, up: true, unit: .lb) }
        XCTAssertEqual(state.exercises[1].sets[0].weightKg, WeightUnit.lb.fromUnit(7.5), "2.5 lb steps up to 25 lb, kept as exact kg")
    }

    func testSessionKeepsDoneSetsInOrderWithPerExerciseIndexes() {
        var state = LiveSessionState(day: day, programId: "p", suggestions: suggestions, now: t0)
        state.toggle(exercise: 1, set: 0, now: t0.addingTimeInterval(10))
        state.toggle(exercise: 0, set: 0, now: t0.addingTimeInterval(20))
        state.toggle(exercise: 0, set: 1, now: t0.addingTimeInterval(30))
        let session = state.session(endedAt: t0.addingTimeInterval(3600))
        XCTAssertEqual(session.sets.map(\.exerciseId), ["curl-mancuernas", "press-banca", "press-banca"])
        XCTAssertEqual(session.sets.map(\.setIndex), [0, 0, 1])
        XCTAssertEqual(session.startedAt, 1_000_000)
        XCTAssertEqual(session.endedAt, 4_600_000)
        XCTAssertEqual(session.dayId, "d1")
        XCTAssertEqual(state.activityState(now: t0.addingTimeInterval(31)).setLabel, "Serie 3 de 3")
    }

    func testDecodesTheEngineProgramResponse() throws {
        let json = #"""
        {"program":{"id":"p","name":"PPL","goal":"Fuerza","weeks":8,"notes":null,"active":true,"createdAt":1,
          "days":[{"id":"d","name":"Empuje","focus":null,"weekday":1,"exercises":[{"id":"pe","exerciseId":"press-banca",
          "exerciseName":"Press de banca","equipment":"barbell","sets":3,"repMin":5,"repMax":8,"targetRpe":8,"targetRir":null,
          "restSeconds":150,"notes":null}]}]},
         "nextDayId":"d","suggestions":{"pe":{"exerciseId":"press-banca","weightKg":null,"reps":5,"reason":"Sin historial","lastSessionAt":null}}}
        """#
        let response = try JSONDecoder().decode(ActiveProgramResponse.self, from: Data(json.utf8))
        XCTAssertEqual(response.program?.days.first?.exercises.first?.prescription, "3 series de 5 a 8 repeticiones")
        XCTAssertNil(response.suggestions["pe"]?.weightKg)
    }

    // MARK: Weeks, blocks and the Coach's review

    func testDecodesWeeksBlocksAndTheCoachsAdjustment() throws {
        let day = #"{"id":"d","name":"Pierna A","focus":null,"weekday":null,"exercises":[{"id":"pe","exerciseId":"sentadilla-hack","exerciseName":"Sentadilla hack","equipment":"machine","sets":3,"repMin":6,"repMax":10,"targetRpe":null,"targetRir":2,"restSeconds":150,"notes":null,"supersetId":null}]}"#
        let json = #"""
        {"program":null,"nextDayId":"d","suggestions":{},
         "blocks":[{"programId":"p","number":1,"name":"Torso / Pierna","goal":"x","startedAt":1,"endedAt":null,"endReason":null,"active":true,"resumedFrom":null,
           "days":[\#(day)],"currentWeek":1,"weekComplete":false,"canStartNextWeek":false,"finished":false,
           "weeks":[{"number":1,"startsAt":1000,"endsAt":605801000,"state":"current","startedEarly":false,"deload":false,"note":null,"done":1,"other":[],
             "days":[{"dayId":"d0","name":"Torso A","status":"done","sessions":[
               {"id":"s1","dayId":"d0","name":"Torso A","startedAt":1000,"endedAt":2461000,"sets":10,"cardioMinutes":0},
               {"id":"s2","dayId":"d0","name":"Torso A","startedAt":9000,"endedAt":2469000,"sets":12,"cardioMinutes":0}]},
               {"dayId":"d","name":"Pierna A","status":"planned","sessions":[]}]}]}],
         "adjustment":{"id":"a","programId":"p","dayId":"d","status":"ready","decidedBy":"coach","noChange":false,
           "rationale":"Llevas 9 días sin entrenar: hoy un 10 % menos.","signals":[{"kind":"inactivity","level":"moderate","days":9,"detail":"Llevas 9 días sin entrenar"}],
           "changes":[{"action":"adjust","programExerciseId":"pe","loadPercent":-10,"cardio":null}],"dismissed":false,"threadId":null,"createdAt":1,"updatedAt":1,
           "day":\#(day),"suggestions":{"pe":{"exerciseId":"sentadilla-hack","weightKg":90,"reps":8,"reason":"Ajuste para hoy","lastSessionAt":1,"normal":{"weightKg":100,"reps":8}}}}}
        """#
        let response = try JSONDecoder().decode(ActiveProgramResponse.self, from: Data(json.utf8))
        let block = try XCTUnwrap(response.blocks?.first)
        XCTAssertEqual(block.current?.number, 1)
        let done = try XCTUnwrap(block.current?.days.first)
        XCTAssertTrue(done.status.isDone)
        XCTAssertEqual(done.last?.id, "s2")
        XCTAssertEqual(done.sessions.first?.minutes, 41)
        let adjustment = try XCTUnwrap(response.adjustment)
        XCTAssertTrue(adjustment.applies)
        XCTAssertEqual(adjustment.suggestions["pe"]?.normal?.weightKg, 100)
        var dismissed = adjustment
        dismissed.dismissed = true
        XCTAssertFalse(dismissed.applies)
    }

    func testAnOlderEngineWithoutBlocksStillDecodes() throws {
        let json = #"{"program":null,"nextDayId":null,"suggestions":{}}"#
        let response = try JSONDecoder().decode(ActiveProgramResponse.self, from: Data(json.utf8))
        XCTAssertNil(response.blocks)
        XCTAssertNil(response.adjustment)
    }

    // MARK: Plan estimates

    func testMinutesAndKcalEstimates() {
        // 3 × (120 + 45) + 2 × (60 + 45) = 705 s ≈ 11.75 min → 10 (nearest 5).
        XCTAssertEqual(TrainingPlan.minutes(day), 10)
        var long = day
        long.exercises[0].sets = 10
        // 10 × 165 + 210 = 1860 s = 31 min → 30.
        XCTAssertEqual(TrainingPlan.minutes(long), 30)
        XCTAssertEqual(TrainingPlan.minutes(ProgramDay(id: "e", name: "Vacío", focus: nil, weekday: nil, exercises: [])), 10)
        // 5 MET × 80 kg × 0.5 h.
        XCTAssertEqual(TrainingPlan.kcal(long, weightKg: 80), 200)
        XCTAssertNil(TrainingPlan.kcal(long, weightKg: nil))
        XCTAssertNil(TrainingPlan.kcal(long, weightKg: 0))
    }

    func testPrescriptionLine() {
        XCTAssertEqual(TrainingPlan.prescription(day.exercises[0], weightKg: 80), "3 series de 6 a 8 repeticiones con 80 kg")
        XCTAssertEqual(TrainingPlan.prescription(day.exercises[1], weightKg: nil), "2 series de 10 a 12 repeticiones")
        var single = day.exercises[1]
        single.sets = 1
        single.repMax = 10
        XCTAssertEqual(TrainingPlan.prescription(single, weightKg: 0), "1 serie de 10 repeticiones")
    }

    func testPlainSpanishTargets() {
        XCTAssertEqual(TrainingText.effort(rir: 2, rpe: nil), "Acaba cada serie pudiendo hacer 2 más")
        XCTAssertEqual(TrainingText.effort(rir: nil, rpe: 8.5), "Acaba cada serie pudiendo hacer 2 más")
        XCTAssertEqual(TrainingText.effort(rir: 0, rpe: nil), "Lleva cada serie hasta no poder más")
        XCTAssertNil(TrainingText.effort(rir: nil, rpe: nil))
        XCTAssertEqual(TrainingText.rest(180), "3 min")
        XCTAssertEqual(TrainingText.rest(90), "1 min 30 s")
        XCTAssertEqual(TrainingText.rest(45), "45 s")
        XCTAssertEqual(TrainingText.load(0, reps: 1), "1 repetición")
        let state = LiveSessionState(day: day, programId: "p", suggestions: suggestions, now: t0)
        XCTAssertEqual(state.exercises[0].guidance, "Acaba cada serie pudiendo hacer 2 más. Descansa \(TrainingText.rest(state.exercises[0].restSeconds)).")
        XCTAssertEqual((1...10).map(EffortLevel.word), ["Fácil", "Fácil", "Fácil", "Moderado", "Moderado", "Moderado", "Difícil", "Difícil", "Máximo", "Máximo"])
        XCTAssertEqual(CardioTarget(durationMinutes: 20, zone: 2).summary, "20 min · zona 2")
    }

    func testRecentRecordsNeedAnEarlierSessionToBeat() {
        let now = Date(timeIntervalSince1970: 2_000_000)
        func session(_ id: String, daysAgo: Double, _ sets: [(String, Double, Int)]) -> TrainingSession {
            let at = (now.timeIntervalSince1970 - daysAgo * 86_400) * 1000
            return TrainingSession(id: id, programId: nil, dayId: nil, name: "", startedAt: at, endedAt: at + 1, notes: nil,
                                   sets: sets.enumerated().map { SetLog(exerciseId: $1.0, setIndex: $0, weightKg: $1.1, reps: $1.2, doneAt: at) })
        }
        let sessions = [
            session("s3", daysAgo: 2, [("press-banca", 82.5, 6), ("sentadilla", 100, 5), ("remo", 60, 10)]),
            session("s1", daysAgo: 30, [("press-banca", 80, 6), ("sentadilla", 110, 5), ("dominadas", 10, 8)]),
            session("s2", daysAgo: 20, [("dominadas", 15, 8)]),
        ]
        // press-banca beat s1 two days ago; sentadilla fell; remo is new; dominadas beat it 20 days ago (too old).
        XCTAssertEqual(TrainingPlan.recentRecords(sessions, now: now), ["press-banca"])
        XCTAssertEqual(TrainingPlan.recentRecords(sessions, now: now, days: 21), ["press-banca", "dominadas"])
    }

    // MARK: Personalizar lista

    @MainActor
    func testProgramDraftPairsAppliesChangesAndSendsSupersets() {
        let draft = ProgramListDraft(day: day, suggestions: suggestions)
        XCTAssertEqual(draft.scope, .always)
        XCTAssertFalse(draft.changed)
        draft.setSupersets(Superset.pair(0, 1, in: [nil, nil], cardio: [false, false])!)
        XCTAssertNotNil(draft.items[0].supersetId)
        XCTAssertEqual(draft.items[0].supersetId, draft.items[1].supersetId)
        XCTAssertEqual(draft.exercises.map(\.editInput.supersetId), draft.exercises.map(\.supersetId))
        XCTAssertTrue(draft.changed)

        // Only what changed in the sheet is written: the rest set elsewhere stays.
        let old = draft.customization("pe1")!
        draft.exercises[0].restSeconds = 200
        var new = old
        new.repMin += 1
        new.repMax += 1
        draft.apply(new, was: old, to: "pe1")
        XCTAssertEqual(draft.exercises[0].repMin, 7)
        XCTAssertEqual(draft.exercises[0].repMax, 9)
        XCTAssertEqual(draft.exercises[0].restSeconds, 200)
        // In the machine's unit, which is the device's setting (the app may have it in lb).
        let unit = TrainingStore.shared.unit(for: "press-banca")
        XCTAssertEqual(draft.items[0].detail, "3 series de 7 a 9 · \(unit.format(unit.snapKg(80)))")

        draft.move(fromOffsets: [0], toOffset: 2)
        XCTAssertNotNil(draft.exercises[0].supersetId, "Still next to each other")
        XCTAssertEqual(draft.exercises[0].supersetId, draft.exercises[1].supersetId)
        draft.remove("pe2")
        XCTAssertNil(draft.exercises[0].supersetId, "A lone member is no superset")
    }
}
