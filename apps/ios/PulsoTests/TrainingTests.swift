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
        XCTAssertEqual(state.exercises[0].prescription, "3 × 6–8 · RIR 2")
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
        XCTAssertEqual(response.program?.days.first?.exercises.first?.prescription, "3 × 5–8 · RPE 8")
        XCTAssertNil(response.suggestions["pe"]?.weightKg)
    }
}
