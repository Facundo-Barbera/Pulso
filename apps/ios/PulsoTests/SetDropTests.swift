import XCTest
@testable import Pulso

/// Sets where the load dropped mid-set: the prompt's rule, its prefill, and the set as the engine gets it.
final class SetDropTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_000)

    private func done(_ kg: Double, _ reps: Int, drops: [SetSegment] = []) -> LiveSet {
        LiveSet(weightKg: kg, reps: reps, doneAt: t0, drops: drops)
    }

    private func state(repMin: Int = 8, restSeconds: Int = 120) -> LiveSessionState {
        let day = ProgramDay(id: "d", name: "Torso", focus: nil, weekday: nil, exercises: [
            ProgramExercise(id: "pe", exerciseId: "press-banca", exerciseName: "Press de banca", equipment: "barbell", sets: 3, repMin: repMin, repMax: 10, targetRpe: nil, targetRir: nil, restSeconds: restSeconds, notes: nil, kind: "compound"),
        ])
        return LiveSessionState(day: day, programId: nil, suggestions: ["pe": LoadSuggestion(exerciseId: "press-banca", weightKg: 80, reps: 8, reason: "", lastSessionAt: 1)], now: t0)
    }

    // MARK: When to offer

    func testOffersOnlyForALoadedSetShortOfTheBottomOfTheRange() {
        XCTAssertEqual(SetDrop.offer(for: done(80, 5), repMin: 8, unit: .kg), SetSegment(weightKg: 67.5, reps: 3))
        XCTAssertNil(SetDrop.offer(for: done(80, 8), repMin: 8, unit: .kg), "Met the target")
        XCTAssertNil(SetDrop.offer(for: done(80, 10), repMin: 8, unit: .kg))
        XCTAssertNil(SetDrop.offer(for: done(0, 4), repMin: 8, unit: .kg), "Bodyweight: nothing to drop")
        XCTAssertNil(SetDrop.offer(for: done(80, 0), repMin: 8, unit: .kg))
        XCTAssertNil(SetDrop.offer(for: done(80, 5, drops: [SetSegment(weightKg: 60, reps: 3)]), repMin: 8, unit: .kg), "Already has one")
        XCTAssertNil(SetDrop.offer(for: LiveSet(weightKg: 80, reps: 5), repMin: 8, unit: .kg), "Not done yet")
    }

    // MARK: Prefill

    func testPrefillIsTenToTwentyPercentLighterOnTheUnitsSteps() {
        let loads: [(WeightUnit, Double)] = [(.kg, 20), (.kg, 32.5), (.kg, 80), (.kg, 140), (.lb, 45), (.lb, 100), (.lb, 225)]
        for (unit, top) in loads {
            let kg = unit.fromUnit(top)
            let drop = SetDrop.next(top: SetSegment(weightKg: kg, reps: 4), drops: [], repMin: 10, unit: unit)
            let cut = 1 - drop.weightKg / kg
            XCTAssert((0.09...0.21).contains(cut), "\(top) \(unit.rawValue) → \(unit.shown(drop.weightKg))")
            XCTAssertEqual(unit.shown(drop.weightKg).truncatingRemainder(dividingBy: unit == .lb ? 5 : 2.5), 0, "On a plate step")
            XCTAssertEqual(drop.reps, 6, "The reps missing")
        }
        XCTAssertEqual(SetDrop.next(top: SetSegment(weightKg: WeightUnit.lb.fromUnit(100), reps: 4), drops: [], repMin: 8, unit: .lb),
                       SetSegment(weightKg: WeightUnit.lb.fromUnit(85), reps: 4))
        // A second drop goes from the last one, for what is still missing; small dumbbells by 1 kg, at least 1 rep.
        XCTAssertEqual(SetDrop.next(top: SetSegment(weightKg: 80, reps: 4), drops: [SetSegment(weightKg: 67.5, reps: 2)], repMin: 8, unit: .kg), SetSegment(weightKg: 57.5, reps: 2))
        XCTAssertEqual(SetDrop.next(top: SetSegment(weightKg: 10, reps: 9), drops: [], repMin: 8, unit: .kg), SetSegment(weightKg: 9, reps: 1))
    }

    // MARK: In the session

    func testADropCountsInVolumeAndTravelsAsSegments() throws {
        var s = state()
        s.setReps(exercise: 0, set: 0, to: 5)
        s.toggle(exercise: 0, set: 0, now: t0.addingTimeInterval(60))
        s.addDrop(exercise: 0, set: 0, SetSegment(weightKg: 60, reps: 3), now: t0.addingTimeInterval(90))
        XCTAssertEqual(s.volumeKg, 80 * 5 + 60 * 3)
        XCTAssertEqual(SetDrop.short(s.exercises[0].sets[0].segments, unit: .kg), "80 × 5 → 60 × 3")
        XCTAssertEqual(SetDrop.text(s.exercises[0].sets[0].segments, unit: .kg), "80 kg × 5 → 60 kg × 3")
        XCTAssertEqual(s.exercises[0].sets[1].weightKg, 80, "The next set keeps the top load")
        XCTAssertTrue(s.exercises[0].sets[1].drops.isEmpty)

        let log = try XCTUnwrap(s.session(endedAt: t0.addingTimeInterval(600)).sets.first)
        XCTAssertEqual(log.weightKg, 80)
        XCTAssertEqual(log.reps, 5)
        XCTAssertEqual(log.segments, [SetSegment(weightKg: 80, reps: 5), SetSegment(weightKg: 60, reps: 3)])
        XCTAssertEqual(log.volumeKg, 580)

        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(s.exercises[0].sets[0])) as? [String: Any])
        XCTAssertEqual((json["segments"] as? [[String: Any]])?.count, 2)
        XCTAssertEqual(try JSONDecoder().decode(LiveSet.self, from: JSONEncoder().encode(s.exercises[0].sets[0])), s.exercises[0].sets[0])
    }

    func testTheRestStartsAfterTheLastSegment() {
        var s = state()
        s.toggle(exercise: 0, set: 0, now: t0.addingTimeInterval(60))
        XCTAssertEqual(s.restEndsAt, t0.addingTimeInterval(180))
        s.addDrop(exercise: 0, set: 0, SetSegment(weightKg: 60, reps: 3), now: t0.addingTimeInterval(80))
        XCTAssertEqual(s.restStartedAt, t0.addingTimeInterval(80))
        XCTAssertEqual(s.restEndsAt, t0.addingTimeInterval(200))
        // A drop planned on a set not done yet leaves the rest alone.
        s.addDrop(exercise: 0, set: 2, SetSegment(weightKg: 60, reps: 3), now: t0.addingTimeInterval(90))
        XCTAssertEqual(s.restEndsAt, t0.addingTimeInterval(200))
    }

    func testAPoundDropLandsOnItsStepsAndReadsTheSameAgain() throws {
        var s = state()
        s.addDrop(exercise: 0, set: 0, SetSegment(weightKg: 27, reps: 2), unit: .lb)
        XCTAssertEqual(WeightUnit.lb.shown(s.exercises[0].sets[0].drops[0].weightKg), 60, "59,5 lb → 60 lb")
        s.setDropWeight(exercise: 0, set: 0, drop: 0, to: 45, unit: .lb)
        s.stepDropWeight(exercise: 0, set: 0, drop: 0, up: false, unit: .lb)
        let decoded = try JSONDecoder().decode(LiveSet.self, from: JSONEncoder().encode(s.exercises[0].sets[0]))
        XCTAssertEqual(WeightUnit.lb.shown(decoded.drops[0].weightKg), 40)
        s.removeDrop(exercise: 0, set: 0, drop: 0)
        XCTAssertTrue(s.exercises[0].sets[0].drops.isEmpty)
    }

    func testAnOldEngineCopyWithoutSegmentsIsOneSegment() throws {
        let json = #"{"id":"s","weightKg":80,"reps":8,"rpe":null,"doneAt":null}"#
        let set = try JSONDecoder().decode(LiveSet.self, from: Data(json.utf8))
        XCTAssertTrue(set.drops.isEmpty)
        XCTAssertEqual(set.segments, [SetSegment(weightKg: 80, reps: 8)])
        let log = try JSONDecoder().decode(SetLog.self, from: Data(#"{"exerciseId":"x","setIndex":0,"weightKg":80,"reps":8,"rpe":null,"doneAt":1}"#.utf8))
        XCTAssertEqual(log.volumeKg, 640)
    }

    func testAMergeKeepsADropTheEngineDoesNotHaveYet() {
        var local = state()
        local.toggle(exercise: 0, set: 0, now: t0.addingTimeInterval(60))
        var remote = local
        remote.version = 3
        local.addDrop(exercise: 0, set: 0, SetSegment(weightKg: 60, reps: 3), now: t0.addingTimeInterval(80))
        let (merged, kept) = LiveSessionState.merge(remote: remote, local: local)
        XCTAssertTrue(kept)
        XCTAssertEqual(merged.exercises[0].sets[0].drops, [SetSegment(weightKg: 60, reps: 3)])
    }

    func testTheLockScreenShowsAPlannedDrop() {
        var s = state()
        s.addDrop(exercise: 0, set: 0, SetSegment(weightKg: 60, reps: 3))
        XCTAssertEqual(s.activityState(now: t0).target, "80 kg, 8 repeticiones → 60 kg × 3")
    }
}
