import HealthKit
import XCTest
@testable import Pulso

final class SleepTests: XCTestCase {
    func testHealthKitStagesMapToEngineNames() {
        XCTAssertEqual(SleepHealth.stage(.asleepDeep), .deep)
        XCTAssertEqual(SleepHealth.stage(.asleepUnspecified), .asleep)
        XCTAssertEqual(SleepHealth.stage(.inBed), .inBed)
        XCTAssertEqual(SleepStage.rem.rawValue, "rem")
    }

    func testSourceKindFromProductType() {
        XCTAssertEqual(SleepHealth.sourceKind(productType: "Watch7,1"), "watch")
        XCTAssertEqual(SleepHealth.sourceKind(productType: "iPhone17,2"), "phone")
        XCTAssertEqual(SleepHealth.sourceKind(productType: ""), "other")
    }

    func testClockAndDurationFormatting() {
        XCTAssertEqual(sleepClock(-60), "23:00")
        XCTAssertEqual(sleepClock(435), "07:15")
        XCTAssertEqual(sleepDuration(450), "7 h 30 min")
        XCTAssertEqual(sleepDuration(480), "8 h")
        XCTAssertEqual(sleepDuration(45), "45 min")
    }

    func testDecodesTheEngineOverview() throws {
        let json = #"""
        {"targetMin":480,"nights":[{"night":"2026-09-30","source":"Apple Watch","sourceKind":"watch","tzOffsetMin":-180,
          "inBedStart":1,"inBedEnd":2,"asleepStart":1,"asleepEnd":2,
          "minutes":{"inBed":480,"asleep":460,"awake":20,"core":270,"deep":80,"rem":110,"unspecified":0},
          "efficiency":0.96,"stagePct":null,"bedtimeMin":-60,"wakeMin":420,
          "score":{"value":91,"factors":[{"key":"duration","label":"Duración","points":38,"maxPoints":40,"detail":"x"}],"explanation":"Buena noche"},
          "insights":[],"segments":[{"start":1,"end":2,"stage":"deep"}]}],
         "summary":{"nights":1,"from":"2026-09-30","to":"2026-09-30","targetMin":480,"avgAsleepMin":460,"avgScore":91,"avgEfficiency":0.96,
          "avgBedtimeMin":-60,"avgWakeMin":420,"bedtimeSdMin":null,"wakeSdMin":null,"regularity":null,"debtMin":20,"insights":[]}}
        """#
        let overview = try JSONDecoder().decode(SleepOverview.self, from: Data(json.utf8))
        XCTAssertEqual(overview.nights.first?.segments.first?.stage, .deep)
        XCTAssertNil(overview.nights.first?.stagePct)
        XCTAssertEqual(overview.summary.debtMin, 20)
    }
}
