import HealthKit
import XCTest
@testable import Pulso

final class PulsoAPITests: XCTestCase {
    func testUnauthorizedMapsToUnpaired() {
        let body = Data(#"{"code":"unauthorized","message":"not paired"}"#.utf8)
        XCTAssertEqual(PulsoAPI.failure(status: 401, data: body).kind, .unpaired)
    }

    func testOtherRefusalsKeepTheirCode() {
        let body = Data(#"{"code":"expired_code","message":"expired"}"#.utf8)
        XCTAssertEqual(PulsoAPI.failure(status: 401, data: body).kind, .refused(code: "expired_code"))
    }

    func testUnlistedActivityKeepsRawValue() {
        XCTAssertEqual(HealthSync.activityName(.running), "running")
        XCTAssertEqual(HealthSync.activityName(.archery), "other_\(HKWorkoutActivityType.archery.rawValue)")
    }
}
