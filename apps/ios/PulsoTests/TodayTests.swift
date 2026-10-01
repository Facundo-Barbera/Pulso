import HealthKit
import XCTest
@testable import Pulso

final class TodayTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_790_000_000)

    func testUnionCountsOverlapsOnce() {
        let a = DateInterval(start: t0, duration: 3600)
        let b = DateInterval(start: t0.addingTimeInterval(1800), duration: 3600)
        let c = DateInterval(start: t0.addingTimeInterval(10_000), duration: 600)
        XCTAssertEqual(HealthMetrics.union([c, b, a]), 5400 + 600)
        XCTAssertEqual(HealthMetrics.union([]), 0)
    }

    func testNightBelongsToTheMorningItEnds() {
        let calendar = Calendar.current
        let morning = calendar.date(bySettingHour: 7, minute: 0, second: 0, of: t0)!
        let lateEvening = calendar.date(bySettingHour: 23, minute: 30, second: 0, of: calendar.date(byAdding: .day, value: -1, to: morning)!)!
        XCTAssertEqual(DayKey.night(endingAt: lateEvening), DayKey.string(morning))
        XCTAssertEqual(DayKey.night(endingAt: morning), DayKey.string(morning))
    }

    func testNightsDedupeSourcesAndSplitStages() {
        let core = HealthMetrics.SleepSegment(stage: .asleepCore, interval: DateInterval(start: t0, duration: 3 * 3600))
        let deep = HealthMetrics.SleepSegment(stage: .asleepDeep, interval: DateInterval(start: t0.addingTimeInterval(3 * 3600), duration: 3600))
        // The iPhone's coarse "asleep" over the same span must not add time.
        let phone = HealthMetrics.SleepSegment(stage: .asleepUnspecified, interval: DateInterval(start: t0, duration: 4 * 3600))
        let inBed = HealthMetrics.SleepSegment(stage: .inBed, interval: DateInterval(start: t0, duration: 5 * 3600))
        let nights = HealthMetrics.nights([core, deep, phone, inBed])
        XCTAssertEqual(nights.count, 1)
        let night = nights.values.first!
        XCTAssertEqual(night.asleep, 240)
        XCTAssertEqual(night.core, 180)
        XCTAssertEqual(night.deep, 60)
        XCTAssertEqual(night.rem, 0)
        XCTAssertNil(night.awake)
    }

    func testGreetingByTimeOfDay() {
        let at = { Calendar.current.date(bySettingHour: $0, minute: 0, second: 0, of: self.t0)! }
        XCTAssertEqual(TodayView.greeting(at: at(8)), "Buenos días")
        XCTAssertEqual(TodayView.greeting(at: at(15)), "Buenas tardes")
        XCTAssertEqual(TodayView.greeting(at: at(23)), "Buenas noches")
        XCTAssertEqual(TodayView.greeting(at: at(3)), "Buenas noches")
    }

    func testDailyResponseDecodes() throws {
        let json = Data(#"{"days":[{"date":"2026-10-01","steps":3200,"hrv":null,"updatedAt":1}],"readiness":{"date":"2026-10-01","score":null,"level":"unknown","factors":[{"key":"sleep","label":"Sueño","value":null,"baseline":480,"score":null,"detail":"x"}],"explanation":"y","baselineDays":0}}"#.utf8)
        let response = try JSONDecoder().decode(PulsoAPI.DailyResponse.self, from: json)
        XCTAssertEqual(response.days.first?.steps, 3200)
        XCTAssertNil(response.readiness.score)
    }
}
