import HealthKit
import XCTest
@testable import Pulso

final class BodyTests: XCTestCase {
    func testDecodesTheDashboard() throws {
        let json = #"""
        {"scans":[{"id":"s1","measuredAt":1767225600000,"source":"inbody","externalId":"inbody:1","device":"270",
          "weight":80.5,"skeletalMuscleMass":35,"bodyFatMass":18,"percentBodyFat":22.4,"bmi":null,"visceralFatLevel":null,
          "bmr":1700,"totalBodyWater":45,"ecwRatio":null,"inbodyScore":null,"softLeanMass":null,"protein":null,"mineral":null,
          "boneMineralContent":null,"bodyCellMass":null,"intracellularWater":null,"extracellularWater":null,"smi":null,
          "waistHipRatio":0.9,"waistCircumference":null,"visceralFatArea":null,"phaseAngle":null,
          "segmentalLean":{"rightArm":3.5,"leftArm":3.4,"trunk":27,"rightLeg":9,"leftLeg":9},"segmentalFat":null,"segmentalEcw":null,"raw":null}],
         "goals":[{"metric":"percentBodyFat","target":18,"setAt":1}],
         "projections":[{"metric":"percentBodyFat","unit":"%","observed":[{"at":1,"value":22.4}],"current":22.3,"slopePerWeek":-0.2,
           "band":[{"at":2,"value":22,"low":21,"high":23}],"horizons":[{"weeks":4,"at":3,"value":21.5,"low":20.5,"high":22.5}],
           "goal":{"target":18,"eta":null,"message":"A este ritmo…"},"note":"Bajando"}]}
        """#
        let dashboard = try JSONDecoder().decode(BodyDashboard.self, from: Data(json.utf8))
        let scan = try XCTUnwrap(dashboard.scans.first)
        XCTAssertEqual(scan.device, "270")
        XCTAssertEqual(scan.segmentalLean?.trunk, 27)
        XCTAssertEqual(scan.leanMass, 62.5)
        XCTAssertEqual(BodyMetric.percentBodyFat.value(in: scan), 22.4)
        XCTAssertEqual(dashboard.goals.first?.metric, .percentBodyFat)
        XCTAssertEqual(dashboard.projections.first?.horizons.first?.weeks, 4)
    }

    func testAParsedQRScanHasNoIdYet() throws {
        let json = #"{"measuredAt":1,"source":"inbody","externalId":"inbody:1","weight":70,"percentBodyFat":20}"#
        let scan = try JSONDecoder().decode(BodyScan.self, from: Data(json.utf8))
        XCTAssertNil(scan.id)
        let sent = try JSONSerialization.jsonObject(with: JSONEncoder().encode(scan)) as? [String: Any]
        XCTAssertNil(sent?["id"])
        XCTAssertEqual(sent?["externalId"] as? String, "inbody:1")
    }

    func testHealthBodyFatIsSentAsPercent() {
        let type = HKQuantityType(.bodyFatPercentage)
        let start = Date(timeIntervalSince1970: 1_000)
        let sample = HKQuantitySample(type: type, quantity: HKQuantity(unit: .percent(), doubleValue: 0.2234), start: start, end: start)
        let (_, metric, unit, factor) = BodyHealth.types[1]
        let converted = BodyHealth.sample(sample, metric: metric, value: sample.quantity.doubleValue(for: unit) * factor)
        XCTAssertEqual(converted.metric, "percentBodyFat")
        XCTAssertEqual(converted.value, 22.34, accuracy: 0.0001)
        XCTAssertEqual(converted.measuredAt, 1_000_000)
        XCTAssertEqual(converted.externalId, sample.uuid.uuidString)
    }
}
