import Foundation

// Mirrors of `@pulso/contract` diet.ts: the active plan laid out as dated slots,
// the recipes and prep batches that fill them, and the undoable changes.

/// What fills a slot. Unknown kinds from a newer engine read as a plain item list.
enum SlotKind: String, Codable {
    case items, recipe, prep, eatOut = "eat_out"

    init(from decoder: Decoder) throws {
        self = SlotKind(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .items
    }
}

/// `eaten` is derived on the Mac from linked log entries.
enum SlotStatus: String, Codable {
    case planned, eaten, replaced, skipped

    init(from decoder: Decoder) throws {
        self = SlotStatus(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .planned
    }

    var title: String {
        switch self {
        case .planned: "Pendiente"
        case .eaten: "Listo"
        case .replaced: "Cambiado"
        case .skipped: "Saltado"
        }
    }

    var systemImage: String {
        switch self {
        case .planned: "circle"
        case .eaten: "checkmark.circle.fill"
        case .replaced: "arrow.left.arrow.right.circle.fill"
        case .skipped: "minus.circle.fill"
        }
    }
}

/// One meal on one date.
struct PlanSlot: Codable, Identifiable, Equatable {
    var id: String
    var date: String
    var slot: MealSlot
    var kind: SlotKind
    var name: String?
    var recipeId: String?
    var prepId: String?
    var portions: Double?
    var items: [DietPlanItem]
    var adjusted: [DietPlanItem]?
    var macros: NutritionMacros
    var status: SlotStatus
    var entryIds: [String]
    var replacedBy: String?
    var cookMinutes: Double?
    var note: String?

    /// What to eat now: the Coach's adjusted portions when there are some.
    var current: [DietPlanItem] { adjusted ?? items }
    var isPlanned: Bool { status == .planned }
    /// Dish name, else the foods.
    var what: String { name ?? items.map(\.name).joined(separator: ", ") }
    /// A meal cooked on the day that takes a while: where "Hoy no cocino" makes sense.
    var needsCooking: Bool {
        switch kind {
        case .recipe: (cookMinutes ?? 0) > 15
        case .items: [.comida, .cena].contains(slot) && cookMinutes != 0
        case .prep, .eatOut: false
        }
    }
}

struct DietDay: Codable, Identifiable, Equatable {
    var date: String
    /// The rotation's label ("Día C"): secondary to the date.
    var label: String
    var slots: [PlanSlot]
    var planned: NutritionMacros
    var shiftKcal: Double
    var goalKcal: Double
    var adjustment: DayAdjustment?
    var id: String { date }

    var day: Date? { NutritionDate.date(date) }
    var pending: Int { slots.filter(\.isPlanned).count }
    var done: Int { slots.filter { $0.status != .planned }.count }
}

struct RecipeIngredient: Codable, Equatable, Identifiable {
    var name: String
    var quantity: Double
    var unit: MeasureUnit
    var kcal: Double
    var protein: Double
    var carbs: Double
    var fat: Double
    var fiber: Double
    var id: String { name }

    /// "300 g", "2 latas", "1 unidad".
    var amountText: String {
        let n = quantity.formatted(.number.precision(.fractionLength(0...1)))
        return "\(n) \(unit.label(quantity))"
    }
}

struct Recipe: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var servings: Double
    var prepMinutes: Double
    var batch: Bool
    var ingredients: [RecipeIngredient]
    var perServing: NutritionMacros
    var steps: String?
    var variantOf: String?

    var isQuick: Bool { prepMinutes <= 15 }
}

enum PrepStatus: String, Codable {
    case planned, cooked, discarded

    init(from decoder: Decoder) throws {
        self = PrepStatus(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .planned
    }
}

/// A recipe cooked on one date that yields several portions, assigned to slots.
struct PrepBatch: Codable, Equatable, Identifiable {
    var id: String
    var recipeId: String
    var recipeName: String
    var cookDate: String
    var portions: Int
    var status: PrepStatus
    var cookedAt: Double?
    var slotIds: [String]
    var eaten: Int
    var leftover: Int

    var cooked: Bool { status == .cooked }
}

struct PlanRevision: Codable, Equatable, Identifiable {
    var id: String
    var op: String
    /// What changed, in Spanish.
    var summary: String
    var dates: [String]
    var createdAt: Double
    var undoneAt: Double?

    var isLive: Bool { undoneAt == nil }
    var created: Date { Date(timeIntervalSince1970: createdAt / 1000) }
}

/// The plan over a range of dates.
struct DietHorizon: Codable, Equatable {
    var planId: String
    var planName: String
    var from: String
    var to: String
    var horizonDays: Int
    var days: [DietDay]
    var preps: [PrepBatch]
    var lastRevision: PlanRevision?

    func day(_ date: String) -> DietDay? { days.first { $0.date == date } }
    func prep(_ id: String?) -> PrepBatch? { id.flatMap { id in preps.first { $0.id == id } } }
    func preps(cookingOn date: String) -> [PrepBatch] { preps.filter { $0.cookDate == date && $0.status != .discarded } }

    /// The recipe a slot opens: its own, or the batch's for a prep portion.
    func recipeId(of slot: PlanSlot) -> String? { slot.recipeId ?? prep(slot.prepId)?.recipeId }

    /// Where a meal comes from, as one quiet line: "Pollo con arroz · porción 2 de 4", "Receta rápida · 10 min", "Comer fuera".
    func source(of slot: PlanSlot) -> String? {
        switch slot.kind {
        case .prep:
            guard let batch = prep(slot.prepId) else { return "Porción del prep" }
            guard let index = batch.slotIds.firstIndex(of: slot.id) else { return "Porción del prep · \(batch.recipeName)" }
            return "Porción del prep · \(index + 1) de \(batch.portions)"
        case .recipe:
            guard let minutes = slot.cookMinutes else { return "Receta" }
            return minutes <= 15 ? "Receta rápida · \(Int(minutes)) min" : "Receta · \(Int(minutes)) min"
        case .eatOut: return "Comer fuera"
        case .items: return nil
        }
    }
}

struct Compensation: Codable, Equatable {
    var mode: String
    var deviationKcal: Double
    var absorbedKcal: Double
    var unabsorbedKcal: Double
    var summary: String
}

/// What every plan change returns.
struct PlanChange: Codable, Equatable {
    var revision: PlanRevision
    var summary: String
    var slots: [PlanSlot]
    var compensation: Compensation?
    var shoppingRefreshed: Bool
}

/// A plan change on the wire: `op` plus the fields it uses (engine: src/nutrition/plan-inputs.ts).
struct PlanOp: Encodable, Equatable {
    var op: String
    var date: String?
    var slot: MealSlot?
    var slotId: String?
    var entryIds: [String]?
    var prepId: String?
    var cooked: Bool?

    static func skip(_ slot: PlanSlot) -> PlanOp { PlanOp(op: "skip", date: slot.date, slotId: slot.id) }
    static func replace(_ slot: PlanSlot, entryIds: [String]) -> PlanOp {
        PlanOp(op: "replace", date: slot.date, slotId: slot.id, entryIds: entryIds)
    }
    /// The engine picks: a free batch portion already cooked, else a swap with a meal that needs no cooking.
    static func noTimeToCook(_ slot: PlanSlot) -> PlanOp { PlanOp(op: "no_time_to_cook", date: slot.date, slot: slot.slot) }
    static func prepCooked(_ batch: PrepBatch, _ cooked: Bool = true) -> PlanOp { PlanOp(op: "prep_cooked", prepId: batch.id, cooked: cooked) }
}
