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

    // MARK: Despensa (`/api/mobile/nutrition/pantry`). Every call answers with the whole pantry.

    private struct PantryResponse: Decodable { var items: [PantryItem] }
    private struct PantryAdd: Encodable { var items: [PantryDraft] }

    func pantry() async throws -> [PantryItem] {
        let response: PantryResponse = try await call("api/mobile/nutrition/pantry", method: "GET")
        return response.items
    }

    func addPantryItem(_ draft: PantryDraft) async throws -> [PantryItem] {
        let response: PantryResponse = try await call("api/mobile/nutrition/pantry", method: "POST", body: PantryAdd(items: [draft]))
        return response.items
    }

    func updatePantryItem(id: String, _ draft: PantryDraft) async throws -> [PantryItem] {
        let response: PantryResponse = try await call("api/mobile/nutrition/pantry/\(id)", method: "PATCH", body: draft)
        return response.items
    }

    func deletePantryItem(id: String) async throws -> [PantryItem] {
        let response: PantryResponse = try await call("api/mobile/nutrition/pantry/\(id)", method: "DELETE")
        return response.items
    }
}
