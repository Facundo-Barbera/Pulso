import XCTest
@testable import Pulso

/// The same cases as the engine's `src/training/units.test.ts`, so both sides read a load the same.
final class WeightUnitTests: XCTestCase {
    private let lb = WeightUnit.lb
    private let kg = WeightUnit.kg

    func testAPoundEntryIsStoredAsItsExactKg() {
        XCTAssertEqual(lb.fromUnit(45), 20.41165665, accuracy: 1e-8)
        XCTAssertEqual(kg.fromUnit(45), 45)
        XCTAssertEqual(lb.toUnit(WeightUnit.kgPerLb), 1)
    }

    func testRoundTripIsStableAcrossSwitches() {
        for pounds in [2.5, 22.5, 45, 47.5, 70, 135, 225, 405] {
            var stored = lb.fromUnit(pounds)
            for _ in 0..<5 { stored = lb.snapKg(lb.snapKg(stored)) }
            XCTAssertEqual(lb.snap(stored), pounds)
            XCTAssertEqual(lb.shown(stored), pounds)
            XCTAssertEqual(lb.format(stored), "\(WeightUnit.number(pounds)) lb")
        }
        for kilos in [1, 9, 14, 20, 32.5, 61.25, 100] {
            XCTAssertEqual(kg.snap(kg.fromUnit(kilos)), kilos)
            XCTAssertEqual(kg.shown(kilos), kilos)
        }
        XCTAssertEqual(kg.format(61.25), "61,25 kg")
    }

    func testKgFromTheOtherUnitGoesToPoundPlates() {
        XCTAssertEqual(lb.snap(20), 45)
        XCTAssertEqual(lb.snap(100), 220)
        XCTAssertEqual(lb.snap(10), 22.5)
        XCTAssertEqual(lb.snap(31.75), 70, "The 70 lb row machine read as 31,75 kg")
    }

    func testPoundsFromTheOtherUnitGoToKiloSteps() {
        XCTAssertEqual(kg.snap(lb.fromUnit(45)), 20)
        XCTAssertEqual(kg.snap(lb.fromUnit(70)), 32.5)
        XCTAssertEqual(kg.snap(lb.fromUnit(15)), 7)
    }

    func testARealWeightStaysEvenOffTheCoarseStep() {
        XCTAssertEqual(kg.snap(14), 14)
        XCTAssertEqual(lb.snap(lb.fromUnit(47.5)), 47.5)
        XCTAssertEqual(kg.snap(-1), 0)
    }

    func testPoundSteppers() {
        XCTAssertEqual(lb.stepUp(45), 50)
        XCTAssertEqual(lb.stepUp(47), 50)
        XCTAssertEqual(lb.stepUp(22.5), 25)
        XCTAssertEqual(lb.stepUp(25), 30)
        XCTAssertEqual(lb.stepDown(30), 25)
        XCTAssertEqual(lb.stepDown(25), 22.5)
        XCTAssertEqual(lb.stepDown(27), 25)
        XCTAssertEqual(lb.stepDown(2.5), 0)
        XCTAssertEqual(lb.stepDown(0), 0)
    }

    func testKiloSteppers() {
        XCTAssertEqual(kg.stepUp(9), 10)
        XCTAssertEqual(kg.stepUp(10), 12.5)
        XCTAssertEqual(kg.stepUp(14), 15)
        XCTAssertEqual(kg.stepDown(12.5), 10)
        XCTAssertEqual(kg.stepDown(10), 9)
        XCTAssertEqual(kg.stepDown(11), 10)
    }

    func testFloatNoiseDoesNotSkipAStep() {
        XCTAssertEqual(lb.stepUp(lb.toUnit(lb.fromUnit(45))), 50)
        XCTAssertEqual(lb.stepDown(lb.toUnit(lb.fromUnit(45))), 40)
    }

    func testFormattingInSpanishWithTheOtherUnitSecond() {
        XCTAssertEqual(lb.format(lb.fromUnit(45)), "45 lb")
        XCTAssertEqual(kg.format(lb.fromUnit(45)), "20,4 kg")
        XCTAssertEqual(lb.formatBoth(lb.fromUnit(100)), "100 lb · 45,4 kg")
        XCTAssertEqual(lb.formatBoth(lb.fromUnit(70)), "70 lb · 31,8 kg")
        XCTAssertEqual(kg.formatTotal(1074.4), "1074 kg")
    }

    // MARK: Settings

    func testSettingsDecodeLenientlyFromAnOlderEngine() throws {
        let old = try JSONDecoder().decode(TrainingSettings.self, from: Data(#"{"preferredEquipment":["machine"]}"#.utf8))
        XCTAssertEqual(old.defaultUnit, .kg)
        XCTAssertEqual(old.exerciseUnits, [:])
        XCTAssertEqual(old.unit(for: "remo-maquina"), .kg)

        let new = try JSONDecoder().decode(TrainingSettings.self, from: Data(#"{"preferredEquipment":[],"defaultUnit":"lb","exerciseUnits":{"remo-maquina":"kg","x":"stone"}}"#.utf8))
        XCTAssertEqual(new.defaultUnit, .lb)
        XCTAssertEqual(new.exerciseUnits, ["remo-maquina": .kg], "An unknown unit is skipped")
        XCTAssertEqual(new.unit(for: "remo-maquina"), .kg)
        XCTAssertEqual(new.unit(for: "press-banca"), .lb)
    }

    func testSettingsUpdatesSendOnlyWhatChanged() throws {
        let body = try JSONEncoder().encode(TrainingSettingsUpdate(defaultUnit: .lb))
        XCTAssertEqual(String(decoding: body, as: UTF8.self), #"{"defaultUnit":"lb"}"#)
        let pin = try JSONEncoder().encode(ExerciseUnitBody(unit: .lb))
        XCTAssertEqual(String(decoding: pin, as: UTF8.self), #"{"unit":"lb"}"#)
        let follow = try JSONEncoder().encode(ExerciseUnitBody(unit: nil))
        XCTAssertEqual(String(decoding: follow, as: UTF8.self), #"{"unit":null}"#, "null, not a missing key: the engine requires it")
    }

    // MARK: The live session in a unit

    private let day = ProgramDay(id: "d1", name: "Torso A", focus: nil, weekday: nil, exercises: [
        ProgramExercise(id: "pe1", exerciseId: "remo-maquina", exerciseName: "Remo en máquina", equipment: "machine", sets: 3, repMin: 8, repMax: 10, targetRpe: nil, targetRir: 2, restSeconds: 150, notes: nil, kind: "compound", weightKg: 31.75),
    ])
    private let t0 = Date(timeIntervalSince1970: 1_000)

    func testHechoLogsTheShownWeightsExactKg() {
        var s = LiveSessionState(day: day, programId: nil, suggestions: [:], now: t0)
        s.toggle(exercise: 0, set: 0, now: t0, unit: .lb)
        XCTAssertEqual(s.exercises[0].sets[0].weightKg, lb.fromUnit(70), "31,75 kg on a pound machine is logged as 70 lb")
        XCTAssertEqual(s.exercises[0].sets[1].weightKg, lb.fromUnit(70), "The load carries to the sets left")
        XCTAssertEqual(lb.shown(s.session(endedAt: t0).sets[0].weightKg), 70)
    }

    func testStepsAndTypedValuesAreInTheUnit() {
        var s = LiveSessionState(day: day, programId: nil, suggestions: [:], now: t0)
        s.stepWeight(exercise: 0, set: 0, up: true, unit: .lb)
        XCTAssertEqual(s.exercises[0].sets[0].weightKg, lb.fromUnit(75))
        s.stepWeight(exercise: 0, set: 0, up: false, unit: .lb)
        s.stepWeight(exercise: 0, set: 0, up: false, unit: .lb)
        XCTAssertEqual(s.exercises[0].sets[0].weightKg, lb.fromUnit(65))
        s.setWeight(exercise: 0, set: 1, to: 45, unit: .lb)
        XCTAssertEqual(s.exercises[0].sets[1].weightKg, 20.41165665, accuracy: 1e-8)
        XCTAssertEqual(lb.snap(s.exercises[0].sets[1].weightKg), 45, "45 lb reads 45 lb again")
        s.setWeight(exercise: 0, set: 1, to: 22.3, unit: .kg)
        XCTAssertEqual(s.exercises[0].sets[1].weightKg, 22.25, "Typed to the quarter")
    }

    func testSwitchingUnitSnapsOpenSetsAndKeepsDoneOnes() {
        var s = LiveSessionState(day: day, programId: nil, suggestions: [:], now: t0)
        s.setWeight(exercise: 0, set: 0, to: 20, unit: .kg)
        s.toggle(exercise: 0, set: 0, now: t0, unit: .kg)
        s.snapOpenSets(exercise: 0, to: .lb)
        XCTAssertEqual(s.exercises[0].sets[0].weightKg, 20, "Done: what was lifted stays")
        XCTAssertEqual(s.exercises[0].sets[1].weightKg, lb.fromUnit(45), "Open: 20 kg goes to the 45 lb step")
        s.snapOpenSets(exercise: 0, to: .kg)
        XCTAssertEqual(s.exercises[0].sets[1].weightKg, 20)
    }

    func testTheLiveActivityShowsTheExercisesUnit() {
        let s = LiveSessionState(day: day, programId: nil, suggestions: [:], now: t0)
        let activity = s.activityState(now: t0) { _ in .lb }
        XCTAssertEqual(activity.weight, "70 lb")
        XCTAssertEqual(activity.target, "70 lb, 8 repeticiones")
        XCTAssertEqual(s.activityState(now: t0).weight, "31,75 kg")
    }

    func testRecordsReadInTheExercisesUnit() {
        let record = TrainingRecord(exerciseId: "remo-maquina", exerciseName: "Remo", kind: "weight", value: lb.fromUnit(75), previous: lb.fromUnit(70))
        XCTAssertEqual(record.valueText(.lb), "75 lb")
        XCTAssertEqual(record.previousText(.lb), "70 lb")
        XCTAssertEqual(TrainingRecord(exerciseId: "x", exerciseName: "X", kind: "reps", value: 12, previous: 10).previousText(.lb), "10")
    }
}
