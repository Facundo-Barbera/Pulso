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

    func testDecodesTheAnalysisAndToleratesAnOlderEngine() throws {
        let json = #"""
        {"scans":[],"goals":[],"projections":[],
         "analysis":{"basis":{"heightCm":180,"heightFrom":"profile","sex":"male","standardWeight":71.3},
           "muscleFat":{"measuredAt":2,"gauges":[{"metric":"weight","measuredAt":2,"value":84,"previous":85,"unit":"kg",
             "normal":{"low":60.6,"high":82},"band":"high","percent":118,"at":{"value":0.42,"previous":0.43,"low":0.2,"high":0.4},
             "ticks":["55","70","85","100","115","130","145","160","175","190","205"]}]},
           "obesity":[{"metric":"visceralFatLevel","measuredAt":2,"value":8,"previous":null,"unit":"nivel","normal":{"low":1,"high":9},
             "band":"normal","percent":null,"at":{"value":0.37,"previous":null,"low":0,"high":0.42},"ticks":["1","5","10","15","20"]}],
           "segments":{"measuredAt":2,"basis":"height",
             "lean":{"rightArm":{"kg":3.9,"percent":117,"band":"high"},"leftArm":{"kg":3.8,"percent":114,"band":"high"},
               "trunk":{"kg":29,"percent":100,"band":"normal"},"rightLeg":{"kg":10,"percent":95,"band":"normal"},"leftLeg":{"kg":9.6,"percent":88,"band":"low"}},
             "fat":null,"balance":[{"text":"Brazos equilibrados","even":true}]}}}
        """#
        let analysis = try XCTUnwrap(JSONDecoder().decode(BodyDashboard.self, from: Data(json.utf8)).analysis)
        let weight = try XCTUnwrap(analysis.muscleFat?.gauges.first)
        XCTAssertEqual(weight.band, .high)
        XCTAssertEqual(weight.band.title, "Alto")
        XCTAssertEqual(BodyGaugeStyle.isGood(weight), false)
        XCTAssertEqual(analysis.obesity.first?.previous, nil)
        XCTAssertEqual(BodySegment.leftLeg.value(in: try XCTUnwrap(analysis.segments?.lean)).band, .low)
        XCTAssertNil(analysis.segments?.fat)

        let older = try JSONDecoder().decode(BodyDashboard.self, from: Data(#"{"scans":[],"goals":[],"projections":[]}"#.utf8))
        XCTAssertNil(older.analysis)
    }

    func testMoreMuscleThanStandardIsGoodButMoreFatIsNot() {
        func gauge(_ metric: String, _ band: BodyBand) -> BodyGauge {
            BodyGauge(metric: metric, measuredAt: 0, value: 1, unit: "kg", normal: .init(low: 0, high: 2), band: band, at: .init(value: 0.5, low: 0.2, high: 0.4), ticks: [])
        }
        XCTAssertEqual(BodyGaugeStyle.isGood(gauge("skeletalMuscleMass", .high)), true)
        XCTAssertEqual(BodyGaugeStyle.isGood(gauge("skeletalMuscleMass", .low)), false)
        XCTAssertEqual(BodyGaugeStyle.isGood(gauge("bodyFatMass", .high)), false)
        XCTAssertNil(BodyGaugeStyle.isGood(gauge("bodyFatMass", .low)))
        XCTAssertEqual(BodyGaugeStyle.isGood(gauge("bmi", .normal)), true)
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
