import Foundation

// Mirrors of `@pulso/contract` nutrition types. Energy in kcal, the rest in grams.

struct NutritionMacros: Codable, Equatable {
    var kcal: Double
    var protein: Double
    var carbs: Double
    var fat: Double
    var fiber: Double

    static let zero = NutritionMacros(kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0)

    func scaled(by factor: Double) -> NutritionMacros {
        NutritionMacros(kcal: (kcal * factor).rounded(), protein: Self.r1(protein * factor), carbs: Self.r1(carbs * factor),
               fat: Self.r1(fat * factor), fiber: Self.r1(fiber * factor))
    }

    private static func r1(_ x: Double) -> Double { (x * 10).rounded() / 10 }
}

enum MealSlot: String, Codable, CaseIterable, Identifiable {
    case desayuno, media_manana, comida, merienda, cena, snack
    var id: String { rawValue }

    var title: String {
        switch self {
        case .desayuno: "Desayuno"
        case .media_manana: "Media mañana"
        case .comida: "Comida"
        case .merienda: "Merienda"
        case .cena: "Cena"
        case .snack: "Snack"
        }
    }

    var systemImage: String {
        switch self {
        case .desayuno: "sunrise"
        case .media_manana: "cup.and.saucer"
        case .comida: "sun.max"
        case .merienda: "takeoutbag.and.cup.and.straw"
        case .cena: "moon.stars"
        case .snack: "carrot"
        }
    }

    /// A sensible slot for "now", used as the default in quick add.
    static func forHour(_ hour: Int) -> MealSlot {
        switch hour {
        case ..<11: .desayuno
        case 11..<13: .media_manana
        case 13..<16: .comida
        case 16..<20: .merienda
        default: .cena
        }
    }
}

enum FoodUnit: String, Codable, CaseIterable {
    case g, serving
    var label: String { self == .g ? "g" : "porción" }
}

struct MealEntry: Codable, Identifiable, Equatable {
    var id: String
    var date: String
    var eatenAt: Double
    var slot: MealSlot
    var name: String
    var quantity: Double
    var unit: FoodUnit
    var kcal: Double
    var protein: Double
    var carbs: Double
    var fat: Double
    var fiber: Double
    var source: String
    var barcode: String?
    var planItemId: String?
}

/// What the phone posts to log a food. Macros are totals for `quantity`.
struct MealInput: Codable, Equatable {
    var name: String
    var slot: MealSlot
    var quantity: Double
    var unit: FoodUnit
    var kcal: Double
    var protein: Double
    var carbs: Double
    var fat: Double
    var fiber: Double
    var eatenAt: Double?
    var date: String?
    var source: String = "manual"
    var barcode: String?

    init(name: String, slot: MealSlot, quantity: Double, unit: FoodUnit, macros: NutritionMacros, source: String = "manual", barcode: String? = nil) {
        self.name = name
        self.slot = slot
        self.quantity = quantity
        self.unit = unit
        kcal = macros.kcal
        protein = macros.protein
        carbs = macros.carbs
        fat = macros.fat
        fiber = macros.fiber
        self.source = source
        self.barcode = barcode
    }
}

struct NutritionTargets: Codable, Equatable {
    var kcal: Double
    var protein: Double
    var carbs: Double
    var fat: Double
    var fiber: Double
    var updatedAt: Double?
}

struct NutritionSummary: Codable, Equatable, Identifiable {
    var date: String
    var totals: NutritionMacros
    var targets: NutritionTargets?
    var remaining: NutritionMacros?
    var bySlot: [String: NutritionMacros]
    var entries: Int
    var id: String { date }
}

struct DietPlanItem: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var quantity: Double
    var unit: FoodUnit
    var kcal: Double
    var protein: Double
    var carbs: Double
    var fat: Double
    var fiber: Double
}

struct DietPlanMeal: Codable, Equatable {
    var slot: MealSlot
    var name: String?
    var items: [DietPlanItem]
}

struct DietPlanDay: Codable, Equatable {
    var label: String
    var meals: [DietPlanMeal]
}

struct DietPlan: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var notes: String?
    var startsOn: String
    var active: Bool
    var createdAt: Double
    var days: [DietPlanDay]
}

struct DietPlanForDay: Codable, Equatable {
    var plan: DietPlan
    var dayIndex: Int
    var day: DietPlanDay
    var eatenItemIds: [String]
}

struct NutritionDay: Codable, Equatable {
    var summary: NutritionSummary
    var meals: [MealEntry]
    var plan: DietPlanForDay?
}

struct FoodProduct: Codable, Equatable, Identifiable {
    var barcode: String
    var name: String
    var brand: String?
    var per100g: NutritionMacros
    var servingGrams: Double?
    var imageUrl: String?
    var id: String { barcode }

    func macros(grams: Double) -> NutritionMacros { per100g.scaled(by: grams / 100) }
}

struct FrequentFood: Codable, Equatable, Identifiable {
    var name: String
    var quantity: Double
    var unit: FoodUnit
    var slot: MealSlot
    var barcode: String?
    var count: Int
    var kcal: Double
    var protein: Double
    var carbs: Double
    var fat: Double
    var fiber: Double
    var id: String { name.lowercased() }
    var macros: NutritionMacros { NutritionMacros(kcal: kcal, protein: protein, carbs: carbs, fat: fat, fiber: fiber) }
}

extension MealEntry {
    var macros: NutritionMacros { NutritionMacros(kcal: kcal, protein: protein, carbs: carbs, fat: fat, fiber: fiber) }
}

extension DietPlanItem {
    var macros: NutritionMacros { NutritionMacros(kcal: kcal, protein: protein, carbs: carbs, fat: fat, fiber: fiber) }
}

/// The engine keys days as local `YYYY-MM-DD`.
enum NutritionDate {
    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func string(_ date: Date) -> String { formatter.string(from: date) }
    static func date(_ key: String) -> Date? { formatter.date(from: key) }
}

/// "180 g", "1,5 porciones".
func foodQuantityText(_ quantity: Double, _ unit: FoodUnit) -> String {
    let n = quantity.formatted(.number.precision(.fractionLength(0...1)))
    return unit == .g ? "\(n) g" : (quantity == 1 ? "1 porción" : "\(n) porciones")
}
