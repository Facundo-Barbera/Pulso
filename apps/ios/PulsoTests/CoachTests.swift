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

    func testCardsOfOneGroupFoldIntoOneChange() throws {
        let decoded = try JSONDecoder().decode(AgentToolResult.self, from: Data(#"{"title":"Programa actualizado","detail":null,"tab":"entreno","group":"program:p1"}"#.utf8))
        XCTAssertEqual(decoded.group, "program:p1")

        func tool(_ value: String, group: String? = nil, undo: String? = nil, status: AgentToolUse.Status = .done) -> AgentToolUse {
            AgentToolUse(name: "update_program", status: status, access: "write",
                         result: AgentToolResult(title: "Programa actualizado", detail: value, tab: "entreno", lines: [AgentActionLine(value: value)], undo: undo, group: group))
        }
        let meal = AgentToolResult(title: "Comida registrada", detail: "Avena", tab: "dieta", undo: "available")
        let views = CoachActionView.views(of: [
            AgentToolUse(name: "list_meals", status: .done, access: "read"),
            tool("Torso/Pierna", group: "program:p1", undo: "available"),
            tool("Día 2", group: "program:p1", undo: "done"),
            tool("Torso/Pierna", group: "program:p1", undo: "available"),
            AgentToolUse(name: "log_meal", status: .done, access: "write", result: meal),
            tool("Día 4", group: "program:p1"),
            tool("Día 5", group: ""),
            tool("Día 6", group: ""),
        ])
        XCTAssertEqual(views.map(\.indices), [[1, 2, 3], [4], [5], [6], [7]])
        let program = views[0]
        XCTAssertEqual(program.count, 3)
        XCTAssertEqual(program.result.title, "Programa actualizado")
        XCTAssertEqual(program.result.shownLines.map(\.value), ["Torso/Pierna", "Día 2"])
        XCTAssertEqual(program.result.detail, "Torso/Pierna · Día 2")
        XCTAssertTrue(program.result.undoable)
        XCTAssertEqual(program.undoOrder, [3, 1])
        // A card alone is shown as it came.
        XCTAssertEqual(views[1], CoachActionView(result: meal, indices: [4], undoOrder: [4]))
    }

    func testAFoldedCardCapsItsLinesAndSumsItsUndo() {
        func run(_ undos: [String?], values: [String]? = nil) -> CoachActionView? {
            let tools = undos.enumerated().map { i, undo in
                AgentToolUse(name: "update_program", status: .done, access: "write",
                             result: AgentToolResult(title: "Programa actualizado", detail: nil, tab: "entreno",
                                                     lines: [AgentActionLine(label: "Cambio", value: values?[i] ?? "Día \(i + 1)")], undo: undo, group: "g"))
            }
            return CoachActionView.views(of: tools).first
        }
        let long = run(Array(repeating: nil, count: 7))
        XCTAssertEqual(long?.result.lines?.count, 5)
        XCTAssertEqual(long?.result.lines?.last, AgentActionLine(value: "y 3 cambios más"))
        XCTAssertNil(long?.result.undo)
        XCTAssertEqual(run(["done", "done"])?.result.undo, "done")
        XCTAssertEqual(run(["done", nil])?.result.undo, "done")
        XCTAssertEqual(run(["done", "done"])?.undoOrder, [])
        XCTAssertEqual(run(["available", "done", "available"])?.undoOrder, [2, 0])
        XCTAssertEqual(AgentActionLine(label: "Día 2", before: "Sentadilla", value: "Prensa").text, "Día 2: Sentadilla → Prensa")
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

    private func item(_ id: String, _ role: AgentMessage.Role = .user) -> AgentFeedItem { .message(message(id, role)) }
    private func mark(_ id: String) -> AgentFeedItem { .marker(AgentFeedMarker(id: id, kind: .compacted, contextId: "c", createdAt: 0)) }

    /// The feed's latest page keeps the local ids of rows sent here (mapped from the Mac's, not by position)
    /// and the older pages above it.
    func testFeedReloadKeepsLocalIdsAndOlderRows() {
        let shown = [item("m0"), mark("k1"), item("m1"), item("local-a-user"), item("local-a", .assistant)]
        let page = [mark("k1"), item("m1"), item("s-u"), item("s-a", .assistant), mark("k2")]
        let (items, continuous) = AgentFeedItem.mergingLatest(page, into: shown, localOf: ["s-u": "local-a-user", "s-a": "local-a"])
        XCTAssertTrue(continuous)
        XCTAssertEqual(items.map(\.id), ["m0", "marker:k1", "m1", "local-a-user", "local-a", "marker:k2"])
        XCTAssertEqual(AgentFeedItem.mergingLatest([item("m5")], into: [item("m0")], localOf: [:]).continuous, false)
        XCTAssertEqual(AgentFeedItem.prependingOlder([item("m1"), mark("k")], to: [mark("k"), item("m2")]).map(\.id), ["m1", "marker:k", "m2"])
    }

    func testConversationPagesAndCompactionEventsDecode() throws {
        let json = #"{"threadId":"t","activeContextId":"c2","contexts":[{"id":"c2","startedAt":2,"lastMessageAt":null,"messageCount":0,"active":true}],"items":[{"type":"marker","marker":{"id":"k","kind":"context","contextId":"c2","createdAt":2}},{"type":"marker","marker":{"id":"x","kind":"futuro","contextId":"c2","createdAt":3}},{"type":"message","message":{"id":"m","threadId":"t","contextId":"c2","source":{"kind":"brief","title":"Resumen del 2 oct"},"role":"assistant","text":"Hoy: pierna.","tools":[],"status":"done","error":null,"createdAt":4}}],"before":null,"running":false,"compacting":true}"#
        let page = try JSONDecoder().decode(AgentConversation.self, from: Data(json.utf8))
        XCTAssertEqual(page.items.map(\.id), ["marker:k", "marker:x", "m"])
        if case let .marker(unknown) = page.items[1] { XCTAssertEqual(unknown.kind, .unknown) } else { XCTFail() }
        XCTAssertEqual(page.items[2].message?.source?.title, "Resumen del 2 oct")
        XCTAssertTrue(page.compacting)
        let decode = { (line: String) in try JSONDecoder().decode(AgentStreamEvent.self, from: Data(line.utf8)) }
        XCTAssertEqual(try decode(#"{"type":"status","status":"compacting"}"#), .compacting(true))
        XCTAssertEqual(try decode(#"{"type":"status","status":null}"#), .compacting(false))
        XCTAssertEqual(try decode(#"{"type":"compacted"}"#), .compacted)
    }

    @MainActor
    func testLauncherOpensTheConversation() {
        let launcher = CoachLauncher()
        launcher.open()
        XCTAssertEqual(launcher.take()?.request, .open)
        XCTAssertNil(launcher.take())
    }
}
