import XCTest
@testable import Pulso

final class ShoppingTests: XCTestCase {
    private let json = """
    {"from":"2026-10-01","to":"2026-10-07","days":7,"planId":"p1","planName":"Definición","generatedAt":1790000000000,
     "hasPlan":true,"stale":false,"done":1,"total":3,"text":"Lista de compras",
     "items":[
      {"id":"a","name":"Tomate","amount":"1,1 kg","quantity":1050,"unit":"g","category":"frutas_verduras","source":"plan","checked":true,"pantry":false,"note":null,"updatedAt":1},
      {"id":"b","name":"Pechugas de pollo","amount":"1,4 kg","quantity":1400,"unit":"g","category":"carnes_pescados","source":"plan","checked":false,"pantry":false,"note":null,"updatedAt":1},
      {"id":"c","name":"Arroz","amount":"600 g","quantity":600,"unit":"g","category":"panaderia_cereales","source":"plan","checked":false,"pantry":true,"note":null,"updatedAt":1},
      {"id":"d","name":"Papel de cocina","amount":null,"quantity":null,"unit":null,"category":"otros","source":"manual","checked":false,"pantry":false,"note":"el grande","updatedAt":1}
     ]}
    """

    private func list() throws -> ShoppingList {
        try JSONDecoder().decode(ShoppingList.self, from: Data(json.utf8))
    }

    func testDecodesAndGroupsByAisleWithPantryApart() throws {
        let list = try list()
        XCTAssertEqual(list.sections.map(\.category), [.frutasVerduras, .carnesPescados, .otros])
        XCTAssertEqual(list.pantry.map(\.id), ["c"])
        XCTAssertEqual(list.items.last?.isManual, true)
        XCTAssertEqual(list.bought, 1)
        XCTAssertEqual(list.toBuy, 3)
        XCTAssertEqual(list.pending, 2)
    }

    func testOptimisticTickMovesProgress() throws {
        let ticked = try list().updating("b") { $0.checked = true }
        XCTAssertEqual(ticked.bought, 2)
        XCTAssertEqual(ticked.progress, 2.0 / 3.0, accuracy: 0.001)
    }

    func testDraftSendsNullsAndOmitsAutomaticAisle() throws {
        var draft = ShoppingItemDraft()
        draft.name = "  Café "
        let body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft)) as! [String: Any]
        XCTAssertEqual(body["name"] as? String, "Café")
        XCTAssertTrue(body["amount"] is NSNull)
        XCTAssertNil(body["category"])
        XCTAssertTrue(draft.isValid)
        XCTAssertFalse(ShoppingItemDraft().isValid)

        let edited = ShoppingItemDraft(try list().items[0])
        let patch = try JSONSerialization.jsonObject(with: JSONEncoder().encode(edited)) as! [String: Any]
        XCTAssertEqual(patch["category"] as? String, "frutas_verduras")
        XCTAssertEqual(patch["amount"] as? String, "1,1 kg")
    }

    func testDecodesThePantryByAisle() throws {
        let json = #"""
        {"items":[{"id":"ab84","name":"Aceite","quantity":null,"unit":null,"amount":null,"category":"despensa","source":"manual","shoppingItemId":null,"boughtOn":"2026-10-01","expiresOn":null,"updatedAt":1},
          {"id":"96f1","name":"Arroz","quantity":600,"unit":"g","amount":"600 g","category":"panaderia_cereales","source":"list","shoppingItemId":"b","boughtOn":"2026-10-01","expiresOn":null,"updatedAt":1}]}
        """#
        struct Response: Decodable { var items: [PantryItem] }
        let items = try JSONDecoder().decode(Response.self, from: Data(json.utf8)).items
        XCTAssertEqual(pantrySections(items).map(\.category), [.panaderiaCereales, .despensa])
        XCTAssertEqual(items.last?.fromList, true)
        XCTAssertNil(items.first?.quantity)
    }

    func testPantryDraftDropsTheUnitWithoutAnAmount() throws {
        var draft = PantryDraft()
        draft.name = " Huevos "
        draft.unit = "ud"
        var body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft)) as! [String: Any]
        XCTAssertEqual(body["name"] as? String, "Huevos")
        XCTAssertTrue(body["unit"] is NSNull)
        XCTAssertTrue(body["quantity"] is NSNull)
        draft.quantity = 6
        body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft)) as! [String: Any]
        XCTAssertEqual(body["unit"] as? String, "ud")
        XCTAssertEqual(body["quantity"] as? Double, 6)
    }
}
