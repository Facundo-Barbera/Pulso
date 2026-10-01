import HealthKit
import XCTest
@testable import Pulso

final class LiveSessionTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_000)

    private let day = ProgramDay(id: "d1", name: "Torso A", focus: nil, weekday: nil, exercises: [
        ProgramExercise(id: "pe1", exerciseId: "press-banca", exerciseName: "Press de banca", equipment: "barbell", sets: 3, repMin: 6, repMax: 8, targetRpe: nil, targetRir: 2, restSeconds: 120, notes: nil, kind: "compound"),
        ProgramExercise(id: "pe2", exerciseId: "curl-mancuernas", exerciseName: "Curl con mancuernas", equipment: "dumbbell", sets: 2, repMin: 10, repMax: 12, targetRpe: 8, targetRir: nil, restSeconds: 60, notes: nil, kind: "isolation"),
        ProgramExercise(id: "pe3", exerciseId: "cinta", exerciseName: "Cinta", equipment: "machine", sets: 1, repMin: 1, repMax: 1, targetRpe: nil, targetRir: nil, restSeconds: 0, notes: nil, kind: "cardio", modality: "treadmill",
                        cardio: CardioTarget(durationMinutes: 8, zone: 4, intervals: CardioIntervals(rounds: 3, workSeconds: 30, restSeconds: 90))),
    ])

    private func state() -> LiveSessionState {
        LiveSessionState(day: day, programId: "p", suggestions: ["pe1": LoadSuggestion(exerciseId: "press-banca", weightKg: 80, reps: 7, reason: "Mantén 80 kg", lastSessionAt: 1)], now: t0)
    }

    private let rowing = LibraryExercise(id: "remo-polea", name: "Remo en polea", muscle: "back", secondary: [], equipment: "cable", kind: "compound")

    // MARK: Building

    func testCardioBlocksHaveNoSetsAndKeepTheirTarget() {
        let s = state()
        XCTAssertEqual(s.exercises[2].kind, "cardio")
        XCTAssertEqual(s.exercises[2].modality, "treadmill")
        XCTAssertTrue(s.exercises[2].sets.isEmpty)
        XCTAssertEqual(s.exercises[2].cardio?.intervals?.rounds, 3)
        XCTAssertNil(s.exercises[2].hint)
        XCTAssertEqual(s.setsTotal, 5)
        XCTAssertEqual(s.focus, 0)
        XCTAssertEqual(s.version, 0)
        XCTAssertEqual(s.exercises[0].target, "3 series × 6–8 reps × 80 kg")
    }

    func testHandSetLoadPrefillsWithoutASuggestion() {
        var plan = day
        plan.exercises[1].weightKg = 14
        let s = LiveSessionState(day: plan, programId: nil, suggestions: [:], now: t0)
        XCTAssertEqual(s.exercises[1].sets.map(\.weightKg), [14, 14])
    }

    // MARK: Contract JSON

    func testEncodesExactlyTheContractShape() throws {
        var s = state()
        s.toggle(exercise: 0, set: 0, now: t0.addingTimeInterval(60))
        s.setRpe(exercise: 0, set: 0, to: 8.5)
        s.logCardio(2, CardioLog(exerciseId: "cinta", durationSeconds: 480, distanceKm: 1.6, doneAt: 1_500_000))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(s)) as? [String: Any])

        XCTAssertEqual(Set(json.keys), ["id", "programId", "dayId", "name", "startedAt", "exercises", "focus", "restStartedAt", "restEndsAt", "version", "updatedAt", "threadId"])
        XCTAssertEqual(json["startedAt"] as? Double, 1_000_000)
        XCTAssertEqual(json["restStartedAt"] as? Double, 1_060_000)
        XCTAssertEqual(json["restEndsAt"] as? Double, 1_180_000)
        XCTAssertEqual(json["version"] as? Int, 0)
        XCTAssertEqual(json["focus"] as? Int, 0)
        XCTAssertTrue(json["threadId"] is NSNull)

        let exercises = try XCTUnwrap(json["exercises"] as? [[String: Any]])
        XCTAssertEqual(Set(exercises[0].keys), ["id", "exerciseId", "name", "equipment", "kind", "modality", "repMin", "repMax", "targetRpe", "targetRir",
                                               "restSeconds", "notes", "hint", "sets", "cardio", "cardioLog", "skipped"])
        XCTAssertEqual(exercises[0]["id"] as? String, "pe1")
        XCTAssertEqual(exercises[0]["equipment"] as? String, "barbell")
        XCTAssertTrue(exercises[0]["modality"] is NSNull)
        XCTAssertTrue(exercises[0]["cardio"] is NSNull)
        XCTAssertEqual(exercises[0]["skipped"] as? Bool, false)

        let sets = try XCTUnwrap(exercises[0]["sets"] as? [[String: Any]])
        XCTAssertEqual(Set(sets[0].keys), ["id", "weightKg", "reps", "rpe", "doneAt"])
        XCTAssertEqual(sets[0]["doneAt"] as? Double, 1_060_000)
        XCTAssertEqual(sets[0]["rpe"] as? Double, 8.5)
        XCTAssertTrue(sets[1]["doneAt"] is NSNull)
        XCTAssertTrue(sets[1]["rpe"] is NSNull)

        let log = try XCTUnwrap(exercises[2]["cardioLog"] as? [String: Any])
        XCTAssertEqual(Set(log.keys), ["exerciseId", "durationSeconds", "distanceKm", "level", "inclinePercent", "avgHr", "kcal", "doneAt"])
        XCTAssertTrue(log["kcal"] is NSNull)
        XCTAssertEqual((exercises[2]["cardio"] as? [String: Any])?["zone"] as? Int, 4)
    }

    func testRoundTripsThroughJSON() throws {
        var s = state()
        s.toggle(exercise: 1, set: 0, now: t0.addingTimeInterval(30))
        s.logCardio(2, CardioLog(exerciseId: "cinta", durationSeconds: 480, avgHr: 150, doneAt: 1_500_000))
        s.setSkipped(0, true)
        s.threadId = "t1"
        s.version = 7
        let decoded = try JSONDecoder().decode(LiveSessionState.self, from: JSONEncoder().encode(s))
        XCTAssertEqual(decoded, s)
        XCTAssertEqual(LiveSessionState.decodeStored(try JSONEncoder().encode(s)), s)
    }

    func testDecodesTheEngineCopyWithOptionalKeysLeftOut() throws {
        let json = #"""
        {"session":{"id":"s1","programId":null,"dayId":"d1","name":"Torso A","startedAt":1790000000000,"focus":1,
          "restStartedAt":null,"restEndsAt":null,"version":4,"updatedAt":1790000060000,"threadId":"th",
          "exercises":[
            {"id":"pe1","exerciseId":"press-banca","name":"Press de banca","equipment":"barbell","kind":"compound",
             "repMin":6,"repMax":8,"targetRpe":null,"targetRir":2,"restSeconds":120,"notes":null,"hint":null,
             "sets":[{"id":"a","weightKg":80,"reps":8,"rpe":null,"doneAt":1790000030000}],"cardio":null,"cardioLog":null,"skipped":false},
            {"id":"x","exerciseId":"eliptica","name":"Elíptica","equipment":"machine","kind":"cardio","modality":"elliptical",
             "repMin":1,"repMax":1,"targetRpe":null,"targetRir":null,"restSeconds":0,"notes":null,"hint":null,
             "sets":[],"cardio":{"durationMinutes":20,"zone":2},"cardioLog":null,"skipped":false}]}}
        """#
        struct Envelope: Decodable { var session: LiveSessionState? }
        let s = try XCTUnwrap(JSONDecoder().decode(Envelope.self, from: Data(json.utf8)).session)
        XCTAssertEqual(s.version, 4)
        XCTAssertEqual(s.focus, 1)
        XCTAssertEqual(s.threadId, "th")
        XCTAssertEqual(s.startedAt, Date(timeIntervalSince1970: 1_790_000_000))
        XCTAssertEqual(s.exercises[0].sets[0].doneAt, Date(timeIntervalSince1970: 1_790_000_030))
        XCTAssertNil(s.exercises[0].modality)
        XCTAssertEqual(s.exercises[1].cardio?.durationMinutes, 20)
        XCTAssertEqual(s.focused?.name, "Elíptica")
    }

    func testRestoresASessionSavedByTheEarlierBuild() throws {
        // What builds before the contract wrote: Dates as seconds since 2001, UUID set ids,
        // a prescription string and a weight step, no version or focus; nil keys left out.
        let json = #"""
        {"id":"s-old","programId":"p","dayId":"d1","name":"Torso A","startedAt":800000000,
         "restStartedAt":800000100,"restEndsAt":800000220,
         "exercises":[
          {"id":"pe1","exerciseId":"press-banca","name":"Press de banca","prescription":"3 × 6–8 · RIR 2","restSeconds":120,"weightStep":2.5,"hint":"Mantén 80 kg",
           "sets":[{"id":"E621E1F8-C36C-495A-93FC-0C247A3E6E5F","weightKg":80,"reps":7,"doneAt":800000100},
                   {"id":"0B9C3D2E-1111-4A4A-9C9C-123456789ABC","weightKg":80,"reps":7}]},
          {"id":"pe2","exerciseId":"curl","name":"Curl","prescription":"2 × 10–12 · RPE 8,5","restSeconds":60,"weightStep":1,
           "sets":[{"id":"5B9C3D2E-1111-4A4A-9C9C-123456789ABC","weightKg":12,"reps":10}]}]}
        """#
        let s = try XCTUnwrap(LiveSessionState.decodeStored(Data(json.utf8)))
        XCTAssertEqual(s.id, "s-old")
        XCTAssertEqual(s.version, 0)
        XCTAssertNil(s.threadId)
        XCTAssertEqual(s.startedAt, Date(timeIntervalSinceReferenceDate: 800_000_000))
        XCTAssertEqual(s.restEndsAt, Date(timeIntervalSinceReferenceDate: 800_000_220))
        XCTAssertEqual(s.focus, 0)

        let press = s.exercises[0]
        XCTAssertEqual(press.equipment, "barbell")
        XCTAssertEqual(press.kind, "compound")
        XCTAssertEqual([press.repMin, press.repMax], [6, 8])
        XCTAssertEqual(press.targetRir, 2)
        XCTAssertEqual(press.hint, "Mantén 80 kg")
        XCTAssertEqual(press.sets[0].id, "e621e1f8-c36c-495a-93fc-0c247a3e6e5f")
        XCTAssertEqual(press.sets[0].doneAt, Date(timeIntervalSinceReferenceDate: 800_000_100))
        XCTAssertNil(press.sets[1].doneAt)

        let curl = s.exercises[1]
        XCTAssertEqual(curl.equipment, "dumbbell")
        XCTAssertEqual(curl.weightStep, 1)
        XCTAssertEqual([curl.repMin, curl.repMax], [10, 12])
        XCTAssertEqual(curl.targetRpe, 8.5)

        // From then on it is saved in the contract format.
        let again = try XCTUnwrap(LiveSessionState.decodeStored(JSONEncoder().encode(s)))
        XCTAssertEqual(again.exercises, s.exercises)
        XCTAssertEqual(again.startedAt, s.startedAt)
    }

    // MARK: Sets, rest and focus

    func testFinishingAnExerciseRestsThenAdvances() {
        var s = state()
        s.toggle(exercise: 0, set: 0, now: t0)
        s.toggle(exercise: 0, set: 1, now: t0)
        XCTAssertFalse(s.advanceIfDone(), "Not done yet")
        s.toggle(exercise: 0, set: 2, now: t0.addingTimeInterval(10))
        XCTAssertEqual(s.restEndsAt, t0.addingTimeInterval(130))
        XCTAssertTrue(s.resting(at: t0.addingTimeInterval(60)))
        XCTAssertEqual(s.focus, 0, "Focus waits for the rest")
        XCTAssertTrue(s.advanceIfDone())
        XCTAssertEqual(s.focus, 1)
        XCTAssertEqual(s.current?.exercise, 1)
    }

    func testRestStillRunsBeforeAPendingCardioBlock() {
        var s = state()
        for (e, set) in [(0, 0), (0, 1), (0, 2), (1, 0), (1, 1)] { s.toggle(exercise: e, set: set, now: t0) }
        XCTAssertNil(s.current)
        XCTAssertFalse(s.allDone)
        XCTAssertNotNil(s.restEndsAt)
        s.logCardio(2, CardioLog(exerciseId: "cinta", durationSeconds: 300, doneAt: 1))
        XCTAssertTrue(s.allDone)
    }

    func testTypedValuesRpeAndSetsAddedOrRemoved() {
        var s = state()
        s.setWeight(exercise: 0, set: 0, to: 81.25)
        s.setReps(exercise: 0, set: 0, to: -2)
        XCTAssertEqual(s.exercises[0].sets[0].weightKg, 81.25)
        XCTAssertEqual(s.exercises[0].sets[0].reps, 0)
        s.addSet(exercise: 0)
        XCTAssertEqual(s.exercises[0].sets.count, 4)
        XCTAssertEqual(s.exercises[0].sets[3].weightKg, 80)
        s.toggle(exercise: 0, set: 3, now: t0)
        s.removeSet(exercise: 0, set: 3)
        XCTAssertEqual(s.exercises[0].sets.count, 4, "A done set isn't removed")
        s.removeSet(exercise: 0, set: 2)
        XCTAssertEqual(s.exercises[0].sets.count, 3)
        s.addSet(exercise: 2)
        XCTAssertTrue(s.exercises[2].sets.isEmpty, "Cardio has no sets")
    }

    // MARK: Editing

    func testReorderKeepsTheExerciseOnScreen() {
        var s = state()
        s.setFocus(1)
        s.move(fromOffsets: [1], toOffset: 0)
        XCTAssertEqual(s.exercises.map(\.id), ["pe2", "pe1", "pe3"])
        XCTAssertEqual(s.focus, 0)
        XCTAssertEqual(s.focused?.id, "pe2")
        s.move(fromOffsets: [2], toOffset: 0)
        XCTAssertEqual(s.focused?.id, "pe2")
        XCTAssertEqual(s.focus, 1)
    }

    func testAddRemoveAndSkip() {
        var s = state()
        let added = s.add(rowing, weightKg: 45)
        XCTAssertEqual(added, 3)
        XCTAssertEqual(s.exercises[3].exerciseId, "remo-polea")
        XCTAssertEqual(s.exercises[3].sets.map(\.weightKg), [45, 45, 45])
        XCTAssertNotEqual(s.exercises[3].id, "remo-polea")

        s.toggle(exercise: 0, set: 0, now: t0)
        s.remove(at: 0)
        XCTAssertEqual(s.exercises.count, 4, "Logged work is never removed")
        s.remove(at: 3)
        XCTAssertEqual(s.exercises.count, 3)

        s.setFocus(1)
        s.setSkipped(1, true)
        XCTAssertTrue(s.exercises[1].skipped)
        XCTAssertEqual(s.focus, 2, "Skipping the exercise on screen moves on")
        XCTAssertEqual(s.setsTotal, 3 + 0, "Skipped sets don't count")
        XCTAssertEqual(s.current?.exercise, 0)
    }

    func testTargetEditsRespectDoneSets() {
        var s = state()
        s.toggle(exercise: 0, set: 0, now: t0)
        s.toggle(exercise: 0, set: 1, now: t0)
        s.updateTarget(0, sets: 1, repMin: 8, repMax: 10, weightKg: 85, restSeconds: 90)
        let ex = s.exercises[0]
        XCTAssertEqual(ex.sets.count, 2, "Can't drop below the sets done")
        XCTAssertEqual(ex.sets.map(\.weightKg), [80, 80])
        s.updateTarget(0, sets: 4, repMin: 8, repMax: 10, weightKg: 85, restSeconds: 90)
        XCTAssertEqual(s.exercises[0].sets.map(\.weightKg), [80, 80, 85, 85])
        XCTAssertEqual(s.exercises[0].sets.map(\.reps), [7, 7, 8, 8])
        XCTAssertEqual(s.exercises[0].restSeconds, 90)
        XCTAssertEqual([s.exercises[0].repMin, s.exercises[0].repMax], [8, 10])
    }

    func testSwapWithNothingLoggedReplacesInPlace() {
        var s = state()
        let index = s.swap(0, to: rowing, weightKg: 50)
        XCTAssertEqual(index, 0)
        let ex = s.exercises[0]
        XCTAssertEqual(ex.id, "pe1", "Keeps the program exercise's id")
        XCTAssertEqual(ex.exerciseId, "remo-polea")
        XCTAssertEqual(ex.equipment, "cable")
        XCTAssertEqual([ex.repMin, ex.repMax, ex.restSeconds], [6, 8, 120])
        XCTAssertEqual(ex.targetRir, 2)
        XCTAssertEqual(ex.sets.map(\.weightKg), [50, 50, 50])
        XCTAssertNil(ex.hint)
        XCTAssertEqual(s.exercises.count, 3)
    }

    func testSwapAfterLoggedSetsKeepsThemWithTheExercisePerformed() {
        var s = state()
        s.toggle(exercise: 0, set: 0, now: t0)
        let index = s.swap(0, to: rowing, weightKg: 0)
        XCTAssertEqual(index, 1)
        XCTAssertEqual(s.focus, 1)
        XCTAssertEqual(s.exercises.map(\.exerciseId), ["press-banca", "remo-polea", "curl-mancuernas", "cinta"])
        XCTAssertEqual(s.exercises[0].sets.count, 1)
        XCTAssertTrue(s.exercises[0].done)
        XCTAssertEqual(s.exercises[1].sets.count, 2, "The sets left move to the new exercise")
        XCTAssertNotEqual(s.exercises[1].id, "pe1")
        let session = s.session(endedAt: t0.addingTimeInterval(600))
        XCTAssertEqual(session.sets.map(\.exerciseId), ["press-banca"])
    }

    func testSwapBetweenStrengthAndCardio() {
        var s = state()
        let bike = LibraryExercise(id: "bici", name: "Bici", muscle: "cardio", secondary: [], equipment: "machine", kind: "cardio", modality: "bike")
        s.swap(1, to: bike, weightKg: 0)
        XCTAssertTrue(s.exercises[1].isCardio)
        XCTAssertTrue(s.exercises[1].sets.isEmpty)
        XCTAssertEqual(s.exercises[1].modality, "bike")
        s.swap(2, to: rowing, weightKg: 40)
        XCTAssertFalse(s.exercises[2].isCardio)
        XCTAssertEqual(s.exercises[2].sets.count, 3)
        XCTAssertNil(s.exercises[2].cardio)
    }

    // MARK: Merging the engine's copy

    func testMergeKeepsWhatThePhoneLoggedAndTheExerciseOnScreen() {
        var local = state()
        local.toggle(exercise: 0, set: 0, now: t0)
        local.setFocus(1)
        var remote = state()
        remote.id = local.id
        remote.exercises = local.exercises
        remote.exercises[0].sets[0].doneAt = nil
        remote.exercises.insert(.fresh(rowing, id: "new", weightKg: 40), at: 0)
        remote.version = 3
        remote.focus = 0

        let (merged, kept) = LiveSessionState.merge(remote: remote, local: local)
        XCTAssertTrue(kept)
        XCTAssertEqual(merged.version, 3)
        XCTAssertEqual(merged.exercises.map(\.id), ["new", "pe1", "pe2", "pe3"])
        XCTAssertNotNil(merged.exercises[1].sets[0].doneAt)
        XCTAssertEqual(merged.focused?.id, "pe2")
        XCTAssertEqual(merged.restEndsAt, local.restEndsAt)

        let (same, keptNothing) = LiveSessionState.merge(remote: local, local: local)
        XCTAssertFalse(keptNothing)
        XCTAssertEqual(same, local)
    }

    // MARK: Cardio and the saved session

    func testSessionIncludesCardioAndRpe() {
        var s = state()
        s.toggle(exercise: 0, set: 0, now: t0.addingTimeInterval(20))
        s.setRpe(exercise: 0, set: 0, to: 9)
        let log = CardioLog(exerciseId: "cinta", durationSeconds: 480, distanceKm: 1.6, level: nil, inclinePercent: 1, avgHr: 152, kcal: 90, doneAt: 1_700_000)
        s.logCardio(2, log)
        s.logCardio(0, log)
        XCTAssertNil(s.exercises[0].cardioLog, "Only cardio blocks log cardio")
        let session = s.session(endedAt: t0.addingTimeInterval(1_800))
        XCTAssertEqual(session.sets.count, 1)
        XCTAssertEqual(session.sets[0].rpe, 9)
        XCTAssertEqual(session.cardio, [log])
        XCTAssertNil(session.cardioMinutes)
        XCTAssertEqual(session.endedAt, 2_800_000)
        XCTAssertTrue(s.hasWork)
        s.clearCardioLog(2)
        XCTAssertEqual(s.session(endedAt: t0).cardio, [])
    }

    func testIntervalPhases() {
        let intervals = CardioIntervals(rounds: 3, workSeconds: 30, restSeconds: 90, workLabel: "Sprint")
        let phases = CardioPhase.phases(intervals)
        XCTAssertEqual(phases.count, 6)
        XCTAssertEqual(phases.last?.end, 360)
        XCTAssertEqual(CardioPhase.at(10, in: intervals)?.label, "Sprint")
        let recovery = CardioPhase.at(45, in: intervals)
        XCTAssertEqual(recovery?.label, "Suave")
        XCTAssertEqual(recovery?.round, 1)
        XCTAssertEqual(recovery?.work, false)
        XCTAssertEqual(CardioPhase.at(125, in: intervals)?.round, 2)
        XCTAssertNil(CardioPhase.at(360, in: intervals))
        XCTAssertEqual(CardioTarget(durationMinutes: 99, intervals: intervals).totalSeconds, 360)
        XCTAssertEqual(CardioTarget(durationMinutes: 20).totalSeconds, 1_200)
        XCTAssertEqual(CardioPhase.phases(CardioIntervals(rounds: 2, workSeconds: 20, restSeconds: 0)).count, 2)
    }

    func testCuesForEachPhaseChangeAhead() {
        let block = state().exercises[2]
        let cues = CardioCue.cues(block, elapsed: 100)
        // Phase starts at 120, 150, 240, 270 are ahead, then the end at 360.
        XCTAssertEqual(cues.map(\.after), [20, 50, 140, 170, 260])
        XCTAssertEqual(cues.first?.title, "Rápido · 0:30")
        XCTAssertEqual(cues.first?.body, "Ronda 2 de 3")
        XCTAssertEqual(cues.last?.title, "Intervalos terminados")
    }

    func testClockAndLockScreenStatus() {
        var clock = CardioClock(exerciseId: "pe3")
        clock.start(at: t0)
        clock.pause(at: t0.addingTimeInterval(40))
        clock.start(at: t0.addingTimeInterval(100))
        XCTAssertEqual(clock.elapsed(at: t0.addingTimeInterval(110)), 50)

        let s = state()
        let now = t0.addingTimeInterval(110)
        let status = CardioCue.status(s.exercises[2], clock: clock, zones: [HrZoneRange(zone: 4, minBpm: 150, maxBpm: 165)], now: now)
        XCTAssertEqual(status.phase, "Suave")
        XCTAssertEqual(status.detail, "Ronda 1 de 3 · Z4 · 150–165 ppm")
        XCTAssertEqual(status.elapsedFrom, now.addingTimeInterval(-50))
        XCTAssertEqual(status.phaseEndsAt, now.addingTimeInterval(70))
        XCTAssertFalse(status.work)

        let activity = s.activityState(now: now, cardio: (2, status))
        XCTAssertEqual(activity.exerciseName, "Cinta")
        XCTAssertEqual(activity.cardio, status)
        XCTAssertNil(s.activityState(now: now).cardio)
        XCTAssertEqual(CardioCue.zone(2, zones: nil), "Z2")
        XCTAssertEqual(CardioCue.clock(3_725), "1:02:05")
    }

    func testSaludWorkoutTypeByModality() {
        XCTAssertEqual(StrengthWorkout.workoutType("treadmill").0, .running)
        XCTAssertEqual(StrengthWorkout.workoutType("treadmill").1, .indoor)
        XCTAssertEqual(StrengthWorkout.workoutType("run").1, .outdoor)
        XCTAssertEqual(StrengthWorkout.workoutType("bike").0, .cycling)
        XCTAssertEqual(StrengthWorkout.workoutType("jump_rope").0, .jumpRope)
        XCTAssertEqual(StrengthWorkout.workoutType("hiit").0, .highIntensityIntervalTraining)
    }

    // MARK: History

    func testLastTimeRecordsAndPrefill() {
        func session(_ id: String, at: Double, _ sets: [(String, Double, Int)]) -> TrainingSession {
            TrainingSession(id: id, programId: nil, dayId: nil, name: "", startedAt: at, endedAt: at + 1, notes: nil,
                            sets: sets.enumerated().map { SetLog(exerciseId: $1.0, setIndex: $0, weightKg: $1.1, reps: $1.2, doneAt: at + Double($0)) })
        }
        let sessions = [
            session("new", at: 2_000, [("press-banca", 82.5, 6), ("press-banca", 80, 7), ("remo", 60, 10)]),
            session("old", at: 1_000, [("press-banca", 85, 3), ("press-banca", 70, 12)]),
        ]
        let last = LiveHistory.last("press-banca", in: sessions)
        XCTAssertEqual(last?.sets.map(\.weightKg), [82.5, 80])
        XCTAssertEqual(last.map { LiveHistory.line($0.sets) }, "\(82.5.formatted()) × 6 · 80 × 7")
        XCTAssertEqual(LiveHistory.best("press-banca", in: sessions)?.heaviestKg, 85)
        // 82,5 × 6 → 99 beats 85 × 3 → 93,5.
        XCTAssertEqual(LiveHistory.best("press-banca", in: sessions)?.e1rm ?? 0, 99, accuracy: 0.01)
        XCTAssertEqual(LiveHistory.lastWeight("press-banca", in: sessions), 80)
        XCTAssertNil(LiveHistory.lastWeight("sentadilla", in: sessions))
    }
}
