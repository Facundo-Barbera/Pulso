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
}
