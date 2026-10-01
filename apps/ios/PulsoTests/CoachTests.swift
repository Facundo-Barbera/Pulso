import XCTest
@testable import Pulso

final class CoachTests: XCTestCase {
    private func event(_ json: String) throws -> AgentStreamEvent {
        try JSONDecoder().decode(AgentStreamEvent.self, from: Data(json.utf8))
    }

    func testStreamEventsDecode() throws {
        XCTAssertEqual(try event(#"{"type":"text","delta":"Hola"}"#), .text("Hola"))
        XCTAssertEqual(try event(#"{"type":"tool","name":"list_workouts","status":"running"}"#), .tool(name: "list_workouts", status: .running))
        XCTAssertEqual(try event(#"{"type":"done","messageId":"m1"}"#), .done(messageId: "m1"))
        XCTAssertEqual(try event(#"{"type":"error","message":"no"}"#), .error("no"))
        XCTAssertEqual(try event(#"{"type":"start","messageId":"m1","userMessageId":"u1"}"#), .start(messageId: "m1", userMessageId: "u1"))
        XCTAssertEqual(try event(#"{"type":"ping"}"#), .unknown)
    }

    func testToolEventsCarryAnOptionalResultCard() throws {
        let created = try event(#"{"type":"tool","name":"create_program","status":"done","result":{"title":"Programa creado","detail":"Torso/Pierna · 4 días","tab":"entreno"}}"#)
        XCTAssertEqual(created, .tool(name: "create_program", status: .done, result: AgentToolResult(title: "Programa creado", detail: "Torso/Pierna · 4 días", tab: "entreno")))
        // A result the app cannot read only loses the card.
        XCTAssertEqual(try event(#"{"type":"tool","name":"create_program","status":"done","result":{"oops":1}}"#), .tool(name: "create_program", status: .done))
        let saved = try JSONDecoder().decode(AgentToolUse.self, from: Data(#"{"name":"set_targets","status":"done","result":{"title":"Objetivos","detail":null,"tab":"dieta"}}"#.utf8))
        XCTAssertEqual(saved.result?.tab, "dieta")
        XCTAssertNil(try JSONDecoder().decode(AgentToolUse.self, from: Data(#"{"name":"list_meals","status":"done"}"#.utf8)).result)
    }

    func testResultCardsNameTheirTab() {
        XCTAssertEqual(CoachResultPlace(tab: "entreno").name, "Entreno")
        XCTAssertEqual(CoachResultPlace(tab: "dieta").name, "Dieta")
        XCTAssertEqual(CoachResultPlace(tab: "cuerpo").name, "Cuerpo")
        XCTAssertEqual(CoachResultPlace(tab: "hoy").name, "Hoy")
    }

    func testToolLabelsAreSpanishAndGuessOtherFeatures() {
        XCTAssertEqual(CoachToolLabel.describe("list_workouts").label, "Revisando tus entrenamientos")
        XCTAssertEqual(CoachToolLabel.describe("list_meals").label, "Revisando tu alimentación")
        XCTAssertEqual(CoachToolLabel.describe("log_body_weight").label, "Guardando tus medidas")
    }

    func testProfileSavesShowAsNews() {
        XCTAssertEqual(CoachToolLabel.doneLabel("update_profile"), "Perfil actualizado")
        XCTAssertNil(CoachToolLabel.doneLabel("list_meals"))
    }

    func testBriefsDecodeWithLocalDay() throws {
        let json = #"{"daily":{"id":"b1","kind":"daily","period":"2026-10-01","status":"done","text":"**Hoy:** Pierna","error":null,"createdAt":1,"updatedAt":2},"weekly":null}"#
        let briefs = try JSONDecoder().decode(CoachBriefs.self, from: Data(json.utf8))
        XCTAssertEqual(briefs.daily?.kind, .daily)
        XCTAssertNil(briefs.weekly)
        let day = try XCTUnwrap(briefs.daily?.day)
        XCTAssertEqual(Calendar.current.dateComponents([.year, .month, .day], from: day), DateComponents(year: 2026, month: 10, day: 1))
    }

    @MainActor
    func testLauncherHandsEachLaunchOverOnce() {
        let launcher = CoachLauncher()
        launcher.ask("Arma mi plan de comidas")
        XCTAssertEqual(launcher.take()?.request, .prompt("Arma mi plan de comidas", send: true))
        XCTAssertNil(launcher.take())
        AskCoachAction()("Diseña mi rutina", send: false)
        XCTAssertEqual(CoachLauncher.shared.take()?.request, .prompt("Diseña mi rutina", send: false))
    }

    @MainActor
    func testLauncherHandsATabRequestOverOnce() {
        let launcher = CoachLauncher()
        launcher.show(tab: "entreno")
        XCTAssertNotNil(launcher.tabRequest)
        XCTAssertEqual(launcher.takeTab(), "entreno")
        XCTAssertNil(launcher.takeTab())
    }
}
