import Foundation
import Observation

/// The shopping list screen's state. Ticks apply at once and the Mac's answer
/// replaces the list; if the Mac can't be reached the tick is rolled back.
@MainActor
@Observable
final class ShoppingStore {
    static let ranges = [3, 7, 14]

    private(set) var list: ShoppingList?
    private(set) var loading = false
    private(set) var generating = false
    /// Days the next generation covers; follows the list once loaded.
    var days = 7

    private var model: PulsoModel { .shared }

    func load() async {
        guard let api = model.api else { return }
        loading = true
        defer { loading = false }
        do {
            list = try await api.shoppingList()
            if let days = list?.days, Self.ranges.contains(days) { self.days = days }
        } catch {
            model.handle(error)
        }
    }

    func generate() async {
        guard let api = model.api else { return }
        generating = true
        defer { generating = false }
        await apply { try await api.generateShoppingList(days: self.days) }
    }

    func toggle(_ item: ShoppingItem) async {
        guard let api = model.api else { return }
        let checked = !item.checked
        await apply(optimistic: { $0.checked = checked; if checked { $0.pantry = false } }, on: item) {
            try await api.setShoppingItem(id: item.id, checked: checked)
        }
    }

    func setPantry(_ item: ShoppingItem, _ pantry: Bool) async {
        guard let api = model.api else { return }
        await apply(optimistic: { $0.pantry = pantry; if pantry { $0.checked = false } }, on: item) {
            try await api.setShoppingItem(id: item.id, pantry: pantry)
        }
    }

    func add(_ draft: ShoppingItemDraft) async {
        guard let api = model.api else { return }
        await apply { try await api.addShoppingItem(draft) }
    }

    func update(_ item: ShoppingItem, _ draft: ShoppingItemDraft) async {
        guard let api = model.api else { return }
        await apply { try await api.updateShoppingItem(id: item.id, draft) }
    }

    func delete(_ item: ShoppingItem) async {
        guard let api = model.api else { return }
        let before = list
        list?.items.removeAll { $0.id == item.id }
        do {
            list = try await api.deleteShoppingItem(id: item.id)
        } catch {
            list = before
            model.handle(error)
        }
    }

    private func apply(optimistic change: ((inout ShoppingItem) -> Void)? = nil, on item: ShoppingItem? = nil,
                       _ request: () async throws -> ShoppingList) async {
        let before = list
        if let change, let item { list = list?.updating(item.id, change) }
        do {
            list = try await request()
        } catch {
            list = before
            model.handle(error)
        }
    }
}
