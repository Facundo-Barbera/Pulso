import XCTest
@testable import Pulso

final class RecordedWorkoutsTests: XCTestCase {
    /// "Torso A" as the engine sends it with the Watch's "Fuerza" and "Caminata" merged in.
    private let mergedJSON = """
    {"id":"s1","programId":null,"dayId":null,"name":"Torso A","startedAt":1790860800000,"endedAt":1790863260000,"notes":null,
     "sets":[{"exerciseId":"press-banca","setIndex":0,"weightKg":30.65,"reps":8,"rpe":null,"doneAt":1790860900000}],
     "cardio":[{"exerciseId":"caminadora","durationSeconds":540,"distanceKm":0.49,"level":null,"inclinePercent":null,"avgHr":104,"kcal":67,"doneAt":1790862840000,"recordedBy":"w2"}],
     "cardioMinutes":9,"merged":true,
     "recorded":{"startedAt":1790860680000,"endedAt":1790863260000,"energy":201,"distance":490,"avgHeartRate":114,"maxHeartRate":151,
       "heartRate":[{"at":1790860700000,"bpm":110},{"at":1790860760000,"bpm":140}],
       "parts":[
         {"workoutId":"w1","activity":"strength","title":"Fuerza","startedAt":1790860680000,"endedAt":1790861820000,"energy":134,"distance":null,"avgHeartRate":118,"maxHeartRate":151,"sourceName":"Apple Watch de Facundo","cardio":false,"link":"overlap"},
         {"workoutId":"w2","activity":"walking","title":"Caminata","startedAt":1790862300000,"endedAt":1790862840000,"energy":67,"distance":490,"avgHeartRate":104,"maxHeartRate":122,"sourceName":"Apple Watch de Facundo","cardio":true,"link":"overlap"}]},
     "joinable":[{"workoutId":"w3","activity":"running","title":"Carrera","startedAt":1790850000000,"endedAt":1790851800000,"energy":300,"distance":5000,"avgHeartRate":null,"maxHeartRate":null,"sourceName":"Apple Watch","cardio":true,"joinedTo":null}]}
    """

    func testAMergedSessionDecodesWithWhatTheWatchRecorded() throws {
        let session = try JSONDecoder().decode(TrainingSession.self, from: Data(mergedJSON.utf8))
        XCTAssertEqual(session.merged, true)
        XCTAssertEqual(session.recorded?.parts.map(\.title), ["Fuerza", "Caminata"])
        XCTAssertEqual(session.recorded?.byWatch, true)
        XCTAssertEqual(session.recorded?.parts[0].facts, "19 min · 134 kcal · FC media 118")
        let km = 0.49.formatted(.number.precision(.fractionLength(0...2)))
        XCTAssertEqual(session.recorded?.parts[1].facts, "9 min · 67 kcal · FC media 104 · \(km) km")
        // The row spans what the Watch recorded: 13:18 → 14:01, not just Pulso's 13:20 → 14:01.
        XCTAssertEqual(session.spanDuration, 2580)
        XCTAssertEqual(session.joinable?.first?.title, "Carrera")
        XCTAssertNil(session.joinable?.first?.link)
    }

    func testTheEngineAdditionsAreNotSentBack() throws {
        let session = try JSONDecoder().decode(TrainingSession.self, from: Data(mergedJSON.utf8)).sanitized
        XCTAssertNil(session.recorded)
        XCTAssertNil(session.joinable)
        XCTAssertNil(session.merged)
        XCTAssertNil(session.cardio?.first?.recordedBy)
        XCTAssertEqual(session.cardio?.first?.kcal, 67)
    }

    func testActivityRowsReadAsOneEach() throws {
        let json = """
        [{"kind":"session","id":"s1","title":"Torso A","activity":null,"startedAt":1790860800000,"endedAt":1790863260000,"energy":201,"distance":490,
          "avgHeartRate":114,"maxHeartRate":151,"sets":10,"volumeKg":2452,"merged":true,"parts":[],"sourceName":"Pulso"},
         {"kind":"workout","id":"w3","title":"Carrera","activity":"running","startedAt":1790850000000,"endedAt":1790851920000,"energy":310,"distance":5100,
          "avgHeartRate":null,"maxHeartRate":null,"sets":null,"volumeKg":null,"merged":false,"parts":[],"sourceName":"Apple Watch"}]
        """
        let entries = try JSONDecoder().decode([ActivityEntry].self, from: Data(json.utf8))
        XCTAssertEqual(entries[0].details, "41 min · 10 series · 201 kcal")
        XCTAssertEqual(entries[0].symbol, "figure.strengthtraining.traditional")
        XCTAssertEqual(entries[1].details, "32 min · 310 kcal · \(5.1.formatted(.number.precision(.fractionLength(2)))) km")
        XCTAssertEqual(entries[1].symbol, "figure.run")
    }
}
