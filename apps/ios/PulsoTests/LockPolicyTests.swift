import XCTest
@testable import Pulso

final class LockPolicyTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_790_000_000)

    private func away(_ seconds: TimeInterval) -> Date { now.addingTimeInterval(-seconds) }

    func testOffNeverLocks() {
        let policy = LockPolicy(enabled: false, interval: .immediately)
        XCTAssertFalse(policy.shouldLock(coldLaunch: true, backgroundedAt: nil, now: now))
        XCTAssertFalse(policy.shouldLock(coldLaunch: false, backgroundedAt: away(86_400), now: now))
    }

    func testColdLaunchLocksWhateverTheInterval() {
        for interval in LockPolicy.Interval.allCases {
            XCTAssertTrue(LockPolicy(enabled: true, interval: interval).shouldLock(coldLaunch: true, backgroundedAt: nil, now: now))
        }
    }

    func testOnlyInactiveNeverLocks() {
        // Control Center, a system alert or the Face ID sheet: never in the background.
        XCTAssertFalse(LockPolicy(enabled: true, interval: .immediately).shouldLock(coldLaunch: false, backgroundedAt: nil, now: now))
    }

    func testImmediatelyLocksOnAnyReturn() {
        let policy = LockPolicy(enabled: true, interval: .immediately)
        XCTAssertTrue(policy.shouldLock(coldLaunch: false, backgroundedAt: now, now: now))
        XCTAssertTrue(policy.shouldLock(coldLaunch: false, backgroundedAt: away(2), now: now))
    }

    func testIntervalIsTheThreshold() {
        let five = LockPolicy(enabled: true, interval: .fiveMinutes)
        XCTAssertFalse(five.shouldLock(coldLaunch: false, backgroundedAt: away(299), now: now))
        XCTAssertTrue(five.shouldLock(coldLaunch: false, backgroundedAt: away(300), now: now))
        XCTAssertTrue(five.shouldLock(coldLaunch: false, backgroundedAt: away(3_600), now: now))

        let one = LockPolicy(enabled: true, interval: .oneMinute)
        XCTAssertFalse(one.shouldLock(coldLaunch: false, backgroundedAt: away(59), now: now))
        XCTAssertTrue(one.shouldLock(coldLaunch: false, backgroundedAt: away(61), now: now))

        let fifteen = LockPolicy(enabled: true, interval: .fifteenMinutes)
        XCTAssertFalse(fifteen.shouldLock(coldLaunch: false, backgroundedAt: away(600), now: now))
        XCTAssertTrue(fifteen.shouldLock(coldLaunch: false, backgroundedAt: away(900), now: now))
    }

    func testClockThatWentBackwardsLocks() {
        let policy = LockPolicy(enabled: true, interval: .fifteenMinutes)
        XCTAssertTrue(policy.shouldLock(coldLaunch: false, backgroundedAt: now.addingTimeInterval(120), now: now))
    }

    func testDefaultIsFiveMinutesAndLabelsAreSpanish() {
        XCTAssertEqual(LockPolicy.Interval.default, .fiveMinutes)
        XCTAssertEqual(LockPolicy.Interval.allCases.map(\.rawValue), [0, 60, 300, 900])
        XCTAssertEqual(LockPolicy.Interval.immediately.label, "Inmediatamente")
    }
}
