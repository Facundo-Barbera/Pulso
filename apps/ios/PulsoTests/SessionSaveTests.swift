import XCTest
@testable import Pulso

/// A finished workout must always reach the Mac: it encodes whatever the
/// session holds, and it waits on disk until the Mac has it.
final class SessionSaveTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_000)

    /// Día 1 as it really went: lb loads, a superset, skipped exercises, one swapped
    /// after logging sets under its old id, and a treadmill block logged from the
    /// clock with the machine's readings left empty.
    private func finishedDay() -> LiveSessionState {
        let day = ProgramDay(id: "d1", name: "Torso A", focus: nil, weekday: nil, exercises: [
            ProgramExercise(id: "pe1", exerciseId: "press-pecho-maquina", exerciseName: "Press de pecho en máquina", equipment: "machine", sets: 3, repMin: 8, repMax: 10, targetRpe: nil, targetRir: 2, restSeconds: 120, notes: nil, kind: "compound", weightKg: 31.75),
            ProgramExercise(id: "pe2", exerciseId: "remo-maquina", exerciseName: "Remo en máquina", equipment: "machine", sets: 3, repMin: 8, repMax: 10, targetRpe: nil, targetRir: 2, restSeconds: 150, notes: nil, kind: "compound", supersetId: "s1"),
            ProgramExercise(id: "pe3", exerciseId: "jalon-pecho", exerciseName: "Jalón al pecho", equipment: "machine", sets: 3, repMin: 8, repMax: 10, targetRpe: nil, targetRir: 2, restSeconds: 150, notes: nil, kind: "compound", supersetId: "s1"),
            ProgramExercise(id: "pe4", exerciseId: "aperturas-polea", exerciseName: "Aperturas en polea", equipment: "cable", sets: 3, repMin: 12, repMax: 15, targetRpe: 8, targetRir: nil, restSeconds: 60, notes: nil, kind: "isolation"),
            ProgramExercise(id: "pe5", exerciseId: "curl", exerciseName: "Curl", equipment: "dumbbell", sets: 2, repMin: 10, repMax: 12, targetRpe: nil, targetRir: nil, restSeconds: 60, notes: nil, kind: "isolation"),
            ProgramExercise(id: "pe6", exerciseId: "cinta", exerciseName: "Cinta", equipment: "machine", sets: 1, repMin: 1, repMax: 1, targetRpe: nil, targetRir: nil, restSeconds: 0, notes: nil, kind: "cardio", modality: "treadmill", cardio: CardioTarget(durationMinutes: 20, zone: 2)),
            ProgramExercise(id: "pe7", exerciseId: "elevaciones", exerciseName: "Elevaciones laterales", equipment: "dumbbell", sets: 3, repMin: 12, repMax: 15, targetRpe: nil, targetRir: 1, restSeconds: 60, notes: nil, kind: "isolation"),
        ])
        var s = LiveSessionState(day: day, programId: "p", suggestions: [:], now: t0)
        for set in 0..<3 { s.toggle(exercise: 0, set: set, now: t0.addingTimeInterval(Double(set) * 120), unit: .lb) }
        s.setWeight(exercise: 1, set: 0, to: 70, unit: .lb)
        for (e, set) in [(1, 0), (2, 0), (1, 1), (2, 1)] { s.toggle(exercise: e, set: set, now: t0.addingTimeInterval(600 + Double(set * 10 + e)), unit: .lb) }
        // Two sets of the flyes, then swapped for another machine: those stay under the old id.
        s.toggle(exercise: 3, set: 0, now: t0.addingTimeInterval(900))
        s.toggle(exercise: 3, set: 1, now: t0.addingTimeInterval(960))
        let pecDeck = LibraryExercise(id: "contractora", name: "Contractora", muscle: "chest", secondary: [], equipment: "machine", kind: "isolation")
        let swapped = s.swap(3, to: pecDeck, weightKg: WeightUnit.lb.fromUnit(90))
        s.toggle(exercise: swapped, set: 0, now: t0.addingTimeInterval(1_020), unit: .lb)
        // The Coach skipped the curl and the laterals.
        s.setSkipped(swapped + 1, true)
        s.setSkipped(s.exercises.count - 1, true)
        XCTAssertEqual(s.skippedNames, ["Curl", "Elevaciones laterales"])
        // The treadmill: the time from the clock, nothing else typed.
        let cardio = s.exercises.firstIndex { $0.isCardio }!
        s.logCardio(cardio, CardioLog(exerciseId: "cinta", durationSeconds: CardioClock(exerciseId: "pe6", accumulated: 1_112.4).elapsed(), doneAt: LiveSessionState.ms(t0.addingTimeInterval(2_400))))
        return s
    }

    func testARealFinishedSessionEncodesAndRoundTrips() throws {
        let s = finishedDay()
        let session = s.session(endedAt: t0.addingTimeInterval(2_700))
        let data = try JSONEncoder().encode(session)
        let back = try JSONDecoder().decode(TrainingSession.self, from: data)
        XCTAssertEqual(back, session)
        XCTAssertEqual(session.sets.count, 3 + 4 + 2 + 1)
        XCTAssertEqual(session.sets.filter { $0.exerciseId == "aperturas-polea" }.count, 2, "Sets done before the swap stay with the old exercise")
        XCTAssertEqual(session.sets.filter { $0.exerciseId == "contractora" }.map(\.setIndex), [0])
        XCTAssertEqual(WeightUnit.lb.shown(session.sets[0].weightKg), 70, "31,75 kg on a pound machine is logged as 70 lb")
        XCTAssertEqual(session.cardio?.first?.durationSeconds ?? 0, 1_112.4, accuracy: 0.01)
        XCTAssertNil(session.cardio?.first?.distanceKm)
    }

    func testNonFiniteNumbersCantBreakTheSession() throws {
        var s = finishedDay()
        // Whatever produced them (a reading, a division by zero), they must not cost the workout.
        s.exercises[0].sets[0].weightKg = .nan
        s.exercises[0].sets[1].rpe = .infinity
        let cardio = s.exercises.firstIndex { $0.isCardio }!
        s.exercises[cardio].cardioLog?.distanceKm = .nan
        s.exercises[cardio].cardioLog?.kcal = -.infinity
        s.exercises[cardio].cardioLog?.durationSeconds = .nan

        let session = s.session(endedAt: t0.addingTimeInterval(2_700))
        XCTAssertNoThrow(try JSONEncoder().encode(session))
        XCTAssertEqual(session.sets[0].weightKg, 0)
        XCTAssertNil(session.sets[1].rpe)
        XCTAssertNil(session.cardio?.first?.distanceKm)
        XCTAssertNil(session.cardio?.first?.kcal)
        XCTAssertEqual(session.cardio?.first?.durationSeconds, 0)

        // A session built (or queued) elsewhere is cleaned the same way before it is sent.
        var raw = session
        raw.sets[0].weightKg = .infinity
        raw.cardioMinutes = .nan
        XCTAssertThrowsError(try JSONEncoder().encode(raw), "Plain JSONEncoder refuses it: why sending sanitizes")
        XCTAssertNoThrow(try JSONEncoder().encode(raw.sanitized))
        XCTAssertNil(raw.sanitized.cardioMinutes)

        // And the live copy the engine gets.
        XCTAssertNoThrow(try JSONEncoder().encode(s.session(endedAt: t0)))
        s.logCardio(cardio, CardioLog(exerciseId: "cinta", durationSeconds: .infinity, avgHr: .nan, doneAt: 1))
        XCTAssertNoThrow(try JSONEncoder().encode(s))
    }

    // MARK: The queue

    private func queueURL() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appending(path: "pulso-queue-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        return dir.appending(path: "pending-sessions.json")
    }

    func testTheQueueKeepsSessionsUntilTheMacHasThem() throws {
        let queue = SessionQueue(url: try queueURL())
        let first = finishedDay().session(endedAt: t0.addingTimeInterval(2_700))
        var second = first
        second.id = "s2"
        queue.add(first)
        queue.add(second)
        queue.add(first)
        XCTAssertEqual(queue.items.map(\.id), [second.id, first.id], "Queued once per id, the latest copy last")
        queue.remove(second.id)
        XCTAssertEqual(queue.items, [first])
        queue.remove(first.id)
        XCTAssertEqual(queue.items, [])
        XCTAssertFalse(FileManager.default.fileExists(atPath: queue.url.path))
    }

    func testAQueuedSessionWithBadNumbersIsStillWrittenAndSent() throws {
        let queue = SessionQueue(url: try queueURL())
        var session = finishedDay().session(endedAt: t0)
        session.sets[0].weightKg = .nan
        queue.add(session)
        XCTAssertEqual(queue.items.count, 1, "Written to disk, not silently dropped")
        XCTAssertEqual(queue.items.first?.sets.first?.weightKg, 0)
    }

    func testAnUnreadableQueueFileIsSetAsideNotOverwritten() throws {
        let url = try queueURL()
        try Data("{ not json".utf8).write(to: url)
        let queue = SessionQueue(url: url)
        XCTAssertEqual(queue.items, [])
        queue.add(finishedDay().session(endedAt: t0))
        XCTAssertEqual(queue.items.count, 1)
        let kept = try FileManager.default.contentsOfDirectory(at: url.deletingLastPathComponent(), includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.contains("unreadable") }
        XCTAssertEqual(kept.count, 1)
        XCTAssertEqual(try String(contentsOf: kept[0], encoding: .utf8), "{ not json")
    }
}
