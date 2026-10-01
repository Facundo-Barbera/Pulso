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
}
