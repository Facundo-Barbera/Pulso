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

    func testActionCardsCarryLinesPlaceAndUndo() throws {
        let json = #"{"type":"tool","name":"update_profile","status":"done","access":"write","result":{"title":"Perfil actualizado","detail":"Objetivo: Bajar de peso → Bajar 10 kg","tab":"cuerpo","place":"perfil","lines":[{"label":"Objetivo","before":"Bajar de peso","value":"Bajar 10 kg"}],"undo":"available"}}"#
        guard case let .tool(_, _, access, result?) = try event(json) else { return XCTFail("no card") }
        XCTAssertEqual(access, "write")
        XCTAssertEqual(result.shownLines, [AgentActionLine(label: "Objetivo", before: "Bajar de peso", value: "Bajar 10 kg")])
        XCTAssertTrue(result.undoable)
        XCTAssertEqual(CoachResultPlace(result: result).name, "Perfil")
        XCTAssertFalse(CoachResultPlace(result: result).opens)
        // An older card has only its detail, which becomes its one line.
        let old = AgentToolResult(title: "Comida registrada", detail: "Avena · 350 kcal", tab: "dieta")
        XCTAssertEqual(old.shownLines.map(\.value), ["Avena · 350 kcal"])
        XCTAssertFalse(old.undoable)
        // Writes are actions even without a card yet; older tools without access count by their card.
        XCTAssertTrue(AgentToolUse(name: "log_meal", status: .running, access: "write").isAction)
        XCTAssertFalse(AgentToolUse(name: "list_meals", status: .done, access: "read").isAction)
        XCTAssertTrue(AgentToolUse(name: "log_meal", status: .done, result: old).isAction)
        XCTAssertEqual(CoachResultPlace(result: AgentToolResult(title: "", detail: nil, tab: "hoy", place: "medicacion")).name, "Medicación")
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

    func testMessagesCarryTheirPhotosAndOlderOnesDecodeWithout() throws {
        let base = #""id":"m","threadId":"t","role":"user","text":"","tools":[],"status":"done","error":null,"createdAt":1"#
        let withPhotos = try JSONDecoder().decode(AgentMessage.self, from: Data(#"{\#(base),"attachments":[{"id":"a","mime":"image/jpeg","width":1600,"height":1200}]}"#.utf8))
        XCTAssertEqual(withPhotos.attachments, [AgentAttachment(id: "a", width: 1600, height: 1200)])
        XCTAssertEqual(try JSONDecoder().decode(AgentMessage.self, from: Data("{\(base)}".utf8)).attachments, [])
    }

    func testPhotosGoAsAMultipartFormWithTheText() throws {
        let body = PulsoAPI.multipart(text: "Registra esto", photos: [Data([0xFF, 0xD8]), Data([0xFF, 0xD9])], boundary: "b")
        let text = String(decoding: body, as: UTF8.self)
        XCTAssertTrue(text.hasPrefix("--b\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\nRegistra esto\r\n"))
        XCTAssertEqual(text.components(separatedBy: #"name="image""#).count - 1, 2)
        XCTAssertTrue(text.contains(#"filename="foto-2.jpg""#))
        XCTAssertTrue(text.hasSuffix("--b--\r\n"))
    }

    func testMessagesCarryScannedProductsAndOlderOnesDecodeWithout() throws {
        let base = #""id":"m","threadId":"t","role":"user","text":"una cucharada","tools":[],"status":"done","error":null,"createdAt":1"#
        let product = #"{"barcode":"8480000123456","name":"Crema de cacahuete","brand":"Hacendado","per100g":{"kcal":588,"protein":25,"carbs":12,"fat":49,"fiber":6},"servingGrams":15,"imageUrl":null,"liquid":false,"packageSize":350,"packageKind":null}"#
        let message = try JSONDecoder().decode(AgentMessage.self, from: Data(#"{\#(base),"products":[{"barcode":"8480000123456","product":\#(product)},{"barcode":"12345678","product":null}]}"#.utf8))
        XCTAssertEqual(message.products.map(\.barcode), ["8480000123456", "12345678"])
        XCTAssertEqual(message.products.first?.product?.name, "Crema de cacahuete")
        XCTAssertNil(message.products.last?.product)
        XCTAssertEqual(try JSONDecoder().decode(AgentMessage.self, from: Data("{\(base)}".utf8)).products, [])
    }

    func testScannedProductsGoAsBarcodeFieldsWithThePhotos() throws {
        let body = PulsoAPI.multipart(text: "", photos: [Data([0xFF, 0xD8])], barcodes: ["8480000123456"], boundary: "b")
        let text = String(decoding: body, as: UTF8.self)
        XCTAssertTrue(text.contains("Content-Disposition: form-data; name=\"barcode\"\r\n\r\n8480000123456\r\n"))
        XCTAssertTrue(text.hasSuffix("--b--\r\n"))
    }

    func testPhotosAreDownscaledToJpeg() throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let big = UIGraphicsImageRenderer(size: CGSize(width: 4000, height: 3000), format: format).image { context in
            UIColor.orange.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 4000, height: 3000))
        }
        let photo = try XCTUnwrap(ChatPhoto(big))
        XCTAssertEqual(photo.attachment.width, 1600)
        XCTAssertEqual(photo.attachment.height, 1200)
        XCTAssertEqual(Array(photo.jpeg.prefix(2)), [0xFF, 0xD8])
        let small = try XCTUnwrap(ChatPhoto(UIGraphicsImageRenderer(size: CGSize(width: 300, height: 200), format: format).image { _ in }))
        XCTAssertEqual(small.attachment.width, 300)
    }

    @MainActor
    func testFotoDeComidaOpensTheCoachWithTheCamera() {
        let launcher = CoachLauncher()
        launcher.photo("Registra esto")
        XCTAssertEqual(launcher.take()?.request, .photo("Registra esto"))
    }

    private func message(_ id: String, _ role: AgentMessage.Role, _ text: String = "") -> AgentMessage {
        AgentMessage(id: id, threadId: "t1", role: role, text: text, tools: [], status: .done, error: nil, createdAt: 0)
    }

    /// Re-reading a thread after a send must not re-key the rows on screen (the chat went blank).
    func testReloadKeepsTheLocalIdsOfRowsOnScreen() {
        let shown = [message("m1", .user), message("m2", .assistant), message("local-a-user", .user, "hola"), message("local-a", .assistant)]
        let saved = [message("m1", .user), message("m2", .assistant), message("m3", .user, "hola"), message("m4", .assistant, "¡Hola!")]
        let kept = AgentMessage.keepingIds(of: shown, in: saved)
        XCTAssertEqual(kept.map(\.id), ["m1", "m2", "local-a-user", "local-a"])
        XCTAssertEqual(kept.last?.text, "¡Hola!")
    }

    func testReloadTakesServerIdsWhereRowsDoNotLineUp() {
        // A send the Mac never saved: nothing to keep.
        XCTAssertEqual(AgentMessage.keepingIds(of: [message("m1", .user), message("local-a", .assistant)], in: [message("m1", .user)]).map(\.id), ["m1"])
        XCTAssertEqual(AgentMessage.keepingIds(of: [message("local-a", .assistant)], in: [message("m1", .user), message("m2", .assistant)]).map(\.id), ["m1", "m2"])
        XCTAssertEqual(AgentMessage.keepingIds(of: [], in: [message("m1", .user)]).map(\.id), ["m1"])
    }
}
