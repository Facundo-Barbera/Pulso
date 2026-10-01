import Foundation

/// `/api/mobile/shopping/*`. Every write answers with the whole list.
extension PulsoAPI {
    private struct Generate: Encodable { var days: Int; var from: String }
    private struct Check: Encodable { var checked: Bool }
    private struct Pantry: Encodable { var pantry: Bool }

    func shoppingList() async throws -> ShoppingList {
        try await call("api/mobile/shopping", method: "GET")
    }

    /// From the active plan, `days` days starting today on this phone.
    func generateShoppingList(days: Int, from: Date = .now) async throws -> ShoppingList {
        try await call("api/mobile/shopping/generate", method: "POST", body: Generate(days: days, from: LocalClock.date(from)))
    }

    func addShoppingItem(_ draft: ShoppingItemDraft) async throws -> ShoppingList {
        try await call("api/mobile/shopping/items", method: "POST", body: draft)
    }

    func updateShoppingItem(id: String, _ draft: ShoppingItemDraft) async throws -> ShoppingList {
        try await call("api/mobile/shopping/items/\(id)", method: "PATCH", body: draft)
    }

    func setShoppingItem(id: String, checked: Bool) async throws -> ShoppingList {
        try await call("api/mobile/shopping/items/\(id)", method: "PATCH", body: Check(checked: checked))
    }

    func setShoppingItem(id: String, pantry: Bool) async throws -> ShoppingList {
        try await call("api/mobile/shopping/items/\(id)", method: "PATCH", body: Pantry(pantry: pantry))
    }

    func deleteShoppingItem(id: String) async throws -> ShoppingList {
        try await call("api/mobile/shopping/items/\(id)", method: "DELETE")
    }
}
