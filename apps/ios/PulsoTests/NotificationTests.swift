import XCTest
@testable import Pulso

final class NotificationRouterTests: XCTestCase {
    /// What the closures saw; only touched on the main thread once the test waits.
    private final class Seen: @unchecked Sendable {
        var events: [String] = []
    }

    /// `Thread.isMainThread` can't be read in an async closure directly.
    private static func onMainThread() -> Bool { Thread.isMainThread }

    /// The crash: UIKit's completion handler called from the cooperative pool aborts on
    /// iOS 27. Whatever thread the delegate is called on, work and completion run on main.
    func testCompletionRunsOnTheMainThreadWhenCalledFromAnother() {
        let done = expectation(description: "completion")
        let seen = Seen()
        DispatchQueue.global().async {
            NotificationRouter.onMain({ () -> Int in
                seen.events.append("work on main: \(Self.onMainThread())")
                return 7
            }, then: { value in
                seen.events.append("completion on main: \(Thread.isMainThread), \(value)")
                done.fulfill()
            })
        }
        wait(for: [done], timeout: 2)
        XCTAssertEqual(seen.events, ["work on main: true", "completion on main: true, 7"])
    }

    func testCompletionWaitsForTheWork() {
        let done = expectation(description: "completion")
        let seen = Seen()
        DispatchQueue.global().async {
            NotificationRouter.onMain({
                try? await Task.sleep(for: .milliseconds(50))
                seen.events.append("work")
            }, then: { _ in
                seen.events.append("completion")
                done.fulfill()
            })
        }
        wait(for: [done], timeout: 2)
        XCTAssertEqual(seen.events, ["work", "completion"])
    }

    func testRoutesFromTheIdentifiersTheAppGives() {
        XCTAssertEqual(NotificationRouter.route(identifier: "coach-t42", category: ""), .coach(threadId: "t42"))
        XCTAssertNil(NotificationRouter.route(identifier: "coach-", category: ""))
        XCTAssertEqual(NotificationRouter.route(identifier: "pulso.training.rest", category: ""), .training)
        XCTAssertEqual(NotificationRouter.route(identifier: "pulso.training.cardio.3", category: ""), .training)
        XCTAssertEqual(NotificationRouter.route(identifier: "pulso.medication.m1.2026-10-01.08:00", category: MedicationNotifications.category), .today)
        XCTAssertNil(NotificationRouter.route(identifier: "something-else", category: ""))
    }
}
