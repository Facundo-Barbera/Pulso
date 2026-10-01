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

    func testMarkdownBlocks() {
        let blocks = MarkdownBlock.parse("""
        ### Lunes
        Calentar **bien**.
        - Sentadilla 3×5
          - Pausa 2 s
        1. Press banca

        | Día | Ejercicio |
        |---|---|
        | Lun | Sentadilla |
        ---
        """)
        XCTAssertEqual(blocks, [
            .heading(level: 3, text: "Lunes"),
            .paragraph("Calentar **bien**."),
            .item(marker: "•", text: "Sentadilla 3×5", depth: 0),
            .item(marker: "•", text: "Pausa 2 s", depth: 1),
            .item(marker: "1.", text: "Press banca", depth: 0),
            .table([["Día", "Ejercicio"], ["Lun", "Sentadilla"]]),
            .rule,
        ])
    }

    func testUnclosedCodeFenceStillRendersWhileStreaming() {
        XCTAssertEqual(MarkdownBlock.parse("Mira:\n```\nA 3x5"), [.paragraph("Mira:"), .code("A 3x5")])
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
}
