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
        state.adjustWeight(exercise: 0, set: 0, by: 1)
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

    func testWeightSnapsToTheStepAndNeverGoesNegative() {
        var state = LiveSessionState(day: day, programId: "p", suggestions: [:], now: t0)
        state.adjustWeight(exercise: 0, set: 0, by: -1)
        XCTAssertEqual(state.exercises[0].sets[0].weightKg, 0)
        state.adjustWeight(exercise: 0, set: 0, by: 3)
        XCTAssertEqual(state.exercises[0].sets[0].weightKg, 7.5)
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

    // MARK: Plan estimates

    private func program(createdDaysAgo days: Double, weeks: Int, from now: Date) -> TrainingProgram {
        TrainingProgram(id: "p", name: "P", goal: "", weeks: weeks, notes: nil, active: true,
                        createdAt: (now.timeIntervalSince1970 - days * 86_400) * 1000, days: [day])
    }

    func testWeekCountsFromCreationAndStaysWithinTheProgram() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        XCTAssertEqual(TrainingPlan.week(of: program(createdDaysAgo: 0, weeks: 5, from: now), now: now, calendar: calendar), 1)
        XCTAssertEqual(TrainingPlan.week(of: program(createdDaysAgo: 6, weeks: 5, from: now), now: now, calendar: calendar), 1)
        XCTAssertEqual(TrainingPlan.week(of: program(createdDaysAgo: 7, weeks: 5, from: now), now: now, calendar: calendar), 2)
        XCTAssertEqual(TrainingPlan.week(of: program(createdDaysAgo: 15, weeks: 5, from: now), now: now, calendar: calendar), 3)
        XCTAssertEqual(TrainingPlan.week(of: program(createdDaysAgo: 90, weeks: 5, from: now), now: now, calendar: calendar), 5)
        XCTAssertEqual(TrainingPlan.week(of: program(createdDaysAgo: -3, weeks: 5, from: now), now: now, calendar: calendar), 1)
    }

    func testDeloadFollowsTheNotes() {
        XCTAssertTrue(TrainingPlan.isDeload(week: 4, weeks: 6, notes: "Progresión lineal. Semana 4 de descarga."))
        XCTAssertFalse(TrainingPlan.isDeload(week: 3, weeks: 6, notes: "Progresión lineal. Semana 4 de descarga."))
        XCTAssertTrue(TrainingPlan.isDeload(week: 8, weeks: 8, notes: "Descarga cada 4 semanas"))
        XCTAssertFalse(TrainingPlan.isDeload(week: 6, weeks: 8, notes: "Descarga cada 4 semanas"))
        XCTAssertTrue(TrainingPlan.isDeload(week: 5, weeks: 5, notes: "La última semana es de descarga"))
        XCTAssertFalse(TrainingPlan.isDeload(week: 4, weeks: 5, notes: "La última semana es de descarga"))
        // Numbers in other sentences don't count.
        XCTAssertFalse(TrainingPlan.isDeload(week: 3, weeks: 6, notes: "3 días por semana. Sin descarga."))
        XCTAssertFalse(TrainingPlan.isDeload(week: 1, weeks: 6, notes: nil))
    }

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
        XCTAssertEqual(draft.items[0].detail, "3 series de 7 a 9 · 80 kg")

        draft.move(fromOffsets: [0], toOffset: 2)
        XCTAssertNotNil(draft.exercises[0].supersetId, "Still next to each other")
        XCTAssertEqual(draft.exercises[0].supersetId, draft.exercises[1].supersetId)
        draft.remove("pe2")
        XCTAssertNil(draft.exercises[0].supersetId, "A lone member is no superset")
    }
}
