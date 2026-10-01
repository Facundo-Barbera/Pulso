import SwiftUI

/// `@pulso/contract` shopping types. Dates are local "yyyy-MM-dd".
enum ShoppingCategory: String, Codable, CaseIterable, Identifiable {
    case frutasVerduras = "frutas_verduras"
    case carnesPescados = "carnes_pescados"
    case lacteosHuevos = "lacteos_huevos"
    case panaderiaCereales = "panaderia_cereales"
    case despensa, bebidas, congelados, otros

    var id: String { rawValue }

    var label: String {
        switch self {
        case .frutasVerduras: "Frutas y verduras"
        case .carnesPescados: "Carnes y pescados"
        case .lacteosHuevos: "Lácteos y huevos"
        case .panaderiaCereales: "Panadería y cereales"
        case .despensa: "Despensa"
        case .bebidas: "Bebidas"
        case .congelados: "Congelados"
        case .otros: "Otros"
        }
    }

    var symbol: String {
        switch self {
        case .frutasVerduras: "carrot.fill"
        case .carnesPescados: "fish.fill"
        case .lacteosHuevos: "cup.and.saucer.fill"
        case .panaderiaCereales: "birthday.cake.fill"
        case .despensa: "archivebox.fill"
        case .bebidas: "waterbottle.fill"
        case .congelados: "snowflake"
        case .otros: "bag.fill"
        }
    }

    var tint: Color {
        switch self {
        case .frutasVerduras: Theme.body
        case .carnesPescados: Theme.protein
        case .lacteosHuevos: Theme.training
        case .panaderiaCereales: Theme.carbs
        case .despensa: Theme.energy
        case .bebidas: Theme.water
        case .congelados: Theme.fat
        case .otros: .secondary
        }
    }
}

struct ShoppingItem: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    /// As shown: "1,4 kg", "2 L", "12", "3 latas".
    var amount: String?
    var quantity: Double?
    var unit: String?
    var category: ShoppingCategory
    var source: String
    /// Bought.
    var checked: Bool
    /// "Ya tengo": at home already, not needed this time.
    var pantry: Bool
    var note: String?

    var isManual: Bool { source == "manual" }
}

struct ShoppingList: Codable, Equatable {
    var from: String?
    var to: String?
    var days: Int?
    var planId: String?
    var planName: String?
    var generatedAt: Double?
    var hasPlan: Bool
    var stale: Bool
    var items: [ShoppingItem]
    var done: Int
    var total: Int
    /// What's left to buy as plain text, for sharing.
    var text: String

    /// Items to buy, by aisle in the engine's order. «Ya tengo» items are apart.
    var sections: [ShoppingSection] {
        ShoppingCategory.allCases.compactMap { category in
            let items = items.filter { $0.category == category && !$0.pantry }
            return items.isEmpty ? nil : ShoppingSection(category: category, items: items)
        }
    }

    /// «Ya tengo»: not needed this time.
    var alreadyHave: [ShoppingItem] { items.filter(\.pantry) }

    /// Counted from the items so an optimistic tick moves the hero at once.
    var bought: Int { items.filter { $0.checked && !$0.pantry }.count }
    var toBuy: Int { items.filter { !$0.pantry }.count }
    var progress: Double { toBuy == 0 ? 0 : Double(bought) / Double(toBuy) }
    var pending: Int { toBuy - bought }

    /// "1 – 7 oct." in the person's locale.
    var rangeText: String? {
        guard let from, let to, let start = LocalClock.day(from), let end = LocalClock.day(to) else { return nil }
        return (start..<end.addingTimeInterval(1)).formatted(.interval.day().month(.abbreviated))
    }
}

struct ShoppingSection: Identifiable {
    var category: ShoppingCategory
    var items: [ShoppingItem]
    var id: ShoppingCategory { category }
}

/// What the add and edit sheet sends. Every field is encoded (nil as null) so clearing one clears it on the Mac.
struct ShoppingItemDraft: Encodable, Equatable {
    var name = ""
    var amount = ""
    /// nil: let the Mac pick the aisle from the name.
    var category: ShoppingCategory?
    var note = ""
    var pantry = false

    init() {}

    init(_ item: ShoppingItem) {
        name = item.name
        amount = item.amount ?? ""
        category = item.category
        note = item.note ?? ""
        pantry = item.pantry
    }

    var isValid: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty }

    enum CodingKeys: String, CodingKey { case name, amount, category, note, pantry }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        let trimmed = { (s: String) in s.trimmingCharacters(in: .whitespacesAndNewlines) }
        try c.encode(trimmed(name), forKey: .name)
        try c.encode(trimmed(amount).isEmpty ? nil : trimmed(amount), forKey: .amount)
        try c.encodeIfPresent(category, forKey: .category)
        try c.encode(trimmed(note).isEmpty ? nil : trimmed(note), forKey: .note)
        try c.encode(pantry, forKey: .pantry)
    }
}

extension ShoppingList {
    /// The list with one item changed, for optimistic updates.
    func updating(_ id: String, _ change: (inout ShoppingItem) -> Void) -> ShoppingList {
        var copy = self
        if let index = copy.items.firstIndex(where: { $0.id == id }) { change(&copy.items[index]) }
        return copy
    }
}
