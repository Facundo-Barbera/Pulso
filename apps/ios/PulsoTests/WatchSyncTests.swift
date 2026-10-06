import XCTest
@testable import Pulso

/// The phone and the Watch editing one session: what travels and who wins.
final class WatchSyncTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_000)

    private let day = ProgramDay(id: "d1", name: "Torso A", focus: nil, weekday: nil, exercises: [
        ProgramExercise(id: "pe1", exerciseId: "press-banca", exerciseName: "Press de banca", equipment: "barbell", sets: 3, repMin: 8, repMax: 10, targetRpe: nil, targetRir: 2, restSeconds: 90, notes: nil, kind: "compound"),
        ProgramExercise(id: "pe2", exerciseId: "cinta", exerciseName: "Caminadora", equipment: "machine", sets: 1, repMin: 1, repMax: 1, targetRpe: nil, targetRir: nil, restSeconds: 0, notes: nil, kind: "cardio", modality: "treadmill",
                        cardio: CardioTarget(durationMinutes: 15, speedKmh: 5.5)),
    ])

    private func state() -> LiveSessionState { LiveSessionState(day: day, programId: "p", suggestions: [:], now: t0) }

    func testAHechoTravelsAsTheSetAndTheRest() {
        let before = state()
        var after = before
        after.toggle(exercise: 0, set: 0, now: t0)
        let changes = before.changes(to: after)
        XCTAssertEqual(changes.map(\.key), ["set:\(after.exercises[0].sets[0].id)", "rest"], "Later sets kept their load: only the set done and the rest")

        var phone = before
        for change in changes { phone.apply(change) }
        XCTAssertEqual(phone.exercises, after.exercises)
        XCTAssertEqual(phone.restEndsAt, after.restEndsAt)
    }

    func testTheCardioClockTravelsWithItsBlock() {
        let before = state()
        var after = before
        var clock = CardioClock(exerciseId: "pe2")
        clock.start(at: t0)
        after.cardioClock = clock
        XCTAssertEqual(before.changes(to: after), [.cardio(exerciseId: "pe2", clock: clock, log: nil)])
        XCTAssertEqual(after.runningCardio?.id, "pe2")

        var phone = before
        phone.apply(.cardio(exerciseId: "pe2", clock: clock, log: nil))
        XCTAssertEqual(phone.cardioClock, clock)
        phone.apply(.cardio(exerciseId: "pe2", clock: nil, log: CardioLog(exerciseId: "cinta", durationSeconds: 900, doneAt: 2)))
        XCTAssertNil(phone.cardioClock)
        XCTAssertEqual(phone.exercises[1].cardioLog?.durationSeconds, 900)
    }

    func testAnEditForSomethingGoneIsDropped() {
        var phone = state()
        XCTAssertFalse(phone.apply(.set(exerciseId: "nope", set: LiveSet(weightKg: 1, reps: 1))))
    }

    func testTheLatestChangeWins() {
        let edit = WatchEdit(sessionId: "s", at: t0, change: .rest(startedAt: nil, endsAt: nil))
        XCTAssertTrue(edit.wins(over: nil), "Nothing changed here: it applies")
        XCTAssertTrue(edit.wins(over: t0.addingTimeInterval(-60)), "Changed here before it")
        XCTAssertFalse(edit.wins(over: t0.addingTimeInterval(60)), "Changed here after it")
    }

    func testMessagesRoundTrip() throws {
        let edit = WatchEdit(sessionId: "s", at: t0, change: .finish(save: true))
        let sync = WatchSync(state: state(), closed: .init(id: "old", saved: false), applied: ["a"], units: ["press-banca": .lb],
                             plan: WatchPlan(day: day, programId: "p", suggestions: [:]))
        for message in [WatchMessage.edits([edit]), .sync(sync)] {
            let back = try XCTUnwrap(WatchMessage.decode(message.encoded()))
            switch (message, back) {
            case (.edits(let a), .edits(let b)): XCTAssertEqual(a.map(\.id), b.map(\.id))
            case (.sync(let a), .sync(let b)):
                XCTAssertEqual(a.state, b.state)
                XCTAssertEqual(a.units, b.units)
                XCTAssertEqual(a.plan, b.plan)
            default: XCTFail("decoded as another message")
            }
        }
    }

    func testTheTreadmillIsAWalkUnlessARunningPace() {
        XCTAssertEqual(WorkoutStage.cardio("treadmill", speedKmh: 5.5).activityType, .walking)
        XCTAssertEqual(WorkoutStage.cardio("treadmill", speedKmh: nil).activityType, .walking)
        XCTAssertEqual(WorkoutStage.cardio("treadmill", speedKmh: 10).activityType, .running)
        XCTAssertFalse(WorkoutStage.cardio("run", speedKmh: nil).indoor)
    }
}
