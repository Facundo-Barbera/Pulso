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

    /// A drink goes with breakfast, lunch or dinner when it's that time; between meals it's a snack.
    static func forDrink(hour: Int) -> MealSlot {
        switch hour {
        case 6..<10: .desayuno
        case 13..<16: .comida
        case 20..<23: .cena
        default: .snack
        }
    }
}

/// What macros are counted against. Older engines logged drinks as `g`.
enum FoodUnit: String, Codable, CaseIterable {
    case g, ml, serving

    var label: String {
        switch self {
        case .g: "g"
        case .ml: "ml"
        case .serving: "porción"
        }
    }

    /// A unit a newer engine adds reads as grams instead of failing the whole day.
    init(from decoder: Decoder) throws {
        self = FoodUnit(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .g
    }
}

/// Measures as people say them. Household ones convert to g or ml (mirrors `HOUSEHOLD_SIZES`).
enum MeasureUnit: String, Codable, CaseIterable, Identifiable {
    case taza, vaso, lata, botella, cucharada, cucharadita, unidad, puño, ml, g, serving
    var id: String { rawValue }

    init(from decoder: Decoder) throws {
        self = MeasureUnit(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unidad
    }

    var isHousehold: Bool { ![.g, .ml, .serving].contains(self) }

    /// g or ml in one unit; nil for unidad (a count of things) and the plain units.
    var defaultSize: Double? {
        switch self {
        case .taza: 240
        case .vaso: 250
        case .lata: 355
        case .botella: 500
        case .cucharada: 15
        case .cucharadita: 5
        case .puño: 30
        case .unidad, .ml, .g, .serving: nil
        }
    }

    /// What a household unit converts to.
    var base: FoodUnit {
        switch self {
        case .g, .unidad, .puño: .g
        case .serving: .serving
        default: .ml
        }
    }

    var systemImage: String {
        switch self {
        case .taza: "cup.and.saucer.fill"
        case .vaso: "mug.fill"
        case .lata: "cylinder.fill"
        case .botella: "waterbottle.fill"
        case .cucharada: "drop.halffull"
        case .cucharadita: "eyedropper.halffull"
        case .unidad: "circle.grid.2x2.fill"
        case .puño: "hand.raised.fill"
        case .ml: "drop.fill"
        case .g: "scalemass.fill"
        case .serving: "chart.pie.fill"
        }
    }

    func label(_ amount: Double = 1) -> String {
        let plural = amount > 1
        switch self {
        case .g, .ml: return rawValue
        case .serving: return plural ? "porciones" : "porción"
        case .unidad: return plural ? "unidades" : "unidad"
        default: return plural ? rawValue + "s" : rawValue
        }
    }

    /// The +/- step: halves of a household unit, sensible ones for g and ml.
    var step: Double {
        switch self {
        case .g: 10
        case .ml: 50
        default: 0.5
        }
    }

    /// What the stepper starts at.
    var defaultAmount: Double {
        switch self {
        case .g: 30
        case .ml: 250
        default: 1
        }
    }
}

/// How much, as the person said it: "2 latas", "1 taza de 300 ml".
struct Measure: Codable, Equatable {
    var amount: Double
    var unit: MeasureUnit
    /// g or ml in one household unit when not its default.
    var size: Double?

    /// The normalized amount macros count against (mirrors the engine's `toQuantity`).
    var quantity: (amount: Double, unit: FoodUnit) {
        guard unit.isHousehold else { return (amount, unit.base) }
        guard let size = size ?? unit.defaultSize else { return (amount, .serving) }
        return ((amount * size * 10).rounded() / 10, unit.base)
    }

    /// "2 latas", "250 ml", "½ taza".
    var text: String {
        let n = amount == 0.5 && unit.isHousehold ? "½" : amount.formatted(.number.precision(.fractionLength(0...1)))
        return "\(n) \(unit.label(amount))"
    }
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
    /// The dated plan slot it eats or replaces. Absent from older engines.
    var slotId: String? = nil
    /// Eaten instead of, or on top of, the plan. Absent from older engines.
    var offPlan: Bool?
    /// The person's own words for the meal, when the Coach logged it.
    var note: String?
    /// The amount as said ("2 latas"); nil for plain g/ml/serving logs and older engines.
    var measure: Measure? = nil
    var caffeineMg: Double? = nil
    var alcoholG: Double? = nil
    /// The dish it is a component of; nil for a food on its own and older engines.
    var dish: DishRef? = nil
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
    var measure: Measure?
    var caffeineMg: Double?
    var alcoholG: Double?

    init(name: String, slot: MealSlot, quantity: Double, unit: FoodUnit, macros: NutritionMacros, source: String = "manual", barcode: String? = nil,
         measure: Measure? = nil, caffeineMg: Double? = nil, alcoholG: Double? = nil) {
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
        self.measure = measure
        self.caffeineMg = caffeineMg
        self.alcoholG = alcoholG
    }

    /// Logs a measure: the quantity is its normalized amount.
    init(name: String, slot: MealSlot, measure: Measure, macros: NutritionMacros, caffeineMg: Double? = nil, alcoholG: Double? = nil) {
        let (quantity, unit) = measure.quantity
        self.init(name: name, slot: slot, quantity: quantity, unit: unit, macros: macros, measure: measure, caffeineMg: caffeineMg, alcoholG: alcoholG)
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
    /// The day's caffeine (mg) and alcohol (g); absent from older engines.
    var caffeineMg: Double? = nil
    var alcoholG: Double? = nil
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

/// A remaining meal as the Coach rewrote it: portions scaled, or swapped for another dish.
struct AdjustedMeal: Codable, Equatable {
    var slot: MealSlot
    var name: String?
    var items: [DietPlanItem]
    /// "scaled", "swapped" or "same".
    var change: String
}

/// The Coach's rewrite of what is left of a day, on top of the unchanged plan.
struct DayAdjustment: Codable, Equatable {
    var date: String
    var factor: Double
    var meals: [AdjustedMeal]
    var projected: NutritionMacros
    var summary: String
    var note: String?
    var createdAt: Double
}

struct DietPlanForDay: Codable, Equatable {
    var plan: DietPlan
    var dayIndex: Int
    var day: DietPlanDay
    var eatenItemIds: [String]
    var adjustment: DayAdjustment?

    /// One plan meal as it should be eaten that day, and whether the Coach changed it.
    struct Meal: Identifiable, Equatable {
        var slot: MealSlot
        var name: String?
        var items: [DietPlanItem]
        var change: String?
        var id: String { slot.rawValue }
        var adjusted: Bool { change == "scaled" || change == "swapped" }
    }

    /// The day's meals with the adjustment laid over them, in slot order.
    var meals: [Meal] {
        var bySlot = Dictionary(day.meals.map { ($0.slot, Meal(slot: $0.slot, name: $0.name, items: $0.items)) }, uniquingKeysWith: { a, _ in a })
        for meal in adjustment?.meals ?? [] {
            bySlot[meal.slot] = Meal(slot: meal.slot, name: meal.name ?? bySlot[meal.slot]?.name, items: meal.items, change: meal.change)
        }
        return MealSlot.allCases.compactMap { bySlot[$0] }
    }
}

struct NutritionDay: Codable, Equatable {
    var summary: NutritionSummary
    var meals: [MealEntry]
    var plan: DietPlanForDay?
    var water: WaterDay?
    /// Mis platillos, most used first; nil from older engines.
    var dishes: [SavedDish]? = nil
}

/// A packaged food. Macros per 100 g, or per 100 ml for a drink; sizes in the same unit.
struct FoodProduct: Codable, Equatable, Identifiable {
    var barcode: String
    var name: String
    var brand: String?
    var per100g: NutritionMacros
    var servingGrams: Double?
    var imageUrl: String?
    /// Absent from older engines: those products read as solids.
    var liquid: Bool? = nil
    var packageSize: Double? = nil
    /// "lata" or "botella".
    var packageKind: String? = nil
    var id: String { barcode }

    var isLiquid: Bool { liquid ?? false }
    var unit: FoodUnit { isLiquid ? .ml : .g }

    /// `amount` is g or ml, whichever the product counts in.
    func macros(grams amount: Double) -> NutritionMacros { per100g.scaled(by: amount / 100) }

    /// A one-tap amount, and how it is logged when it is a measure people say ("1 lata").
    struct Portion: Identifiable, Equatable {
        var title: String
        var amount: Double
        var measure: Measure?
        var id: String { title }
    }

    /// Drinks: the package ("Botella (600 ml)"), the label's serving, a glass and half the package.
    /// Solids: the serving, half of it and the package; 100 g and 30 g only when the label says nothing.
    var portions: [Portion] {
        var portions: [Portion] = []
        let n = { (x: Double) in x.formatted(.number.precision(.fractionLength(0...1))) }
        if isLiquid {
            let kind = packageKind.flatMap(MeasureUnit.init(rawValue:)).flatMap { [.lata, .botella].contains($0) ? $0 : nil }
            let measure = { (amount: Double, size: Double) in
                kind.map { Measure(amount: amount, unit: $0, size: size == $0.defaultSize ? nil : size) }
            }
            if let size = packageSize {
                let name = kind == .lata ? "Lata" : kind == .botella ? "Botella" : "Envase"
                portions.append(Portion(title: "\(name) (\(n(size)) ml)", amount: size, measure: measure(1, size)))
            }
            if let serving = servingGrams { portions.append(Portion(title: "Porción (\(n(serving)) ml)", amount: serving)) }
            portions.append(Portion(title: "Vaso (250 ml)", amount: 250, measure: Measure(amount: 1, unit: .vaso)))
            if let size = packageSize, size >= 330 {
                portions.append(Portion(title: "Media (\(n(size / 2)) ml)", amount: size / 2, measure: measure(0.5, size)))
            }
        } else {
            if let serving = servingGrams {
                portions.append(Portion(title: "Porción (\(n(serving)) g)", amount: serving))
                portions.append(Portion(title: "½ porción", amount: (serving * 5).rounded() / 10))
            }
            if let size = packageSize { portions.append(Portion(title: "Paquete (\(n(size)) g)", amount: size)) }
            if portions.isEmpty {
                portions = [Portion(title: "100 g", amount: 100), Portion(title: "30 g", amount: 30)]
            }
        }
        // A glass the size of the package is one button, not two.
        var seen = Set<Double>()
        return portions.filter { seen.insert($0.amount).inserted }
    }

    /// Where the picker starts: a drink's whole package up to a litre, else a serving, else a glass or 100 g.
    var defaultPortion: Portion {
        let all = portions
        if isLiquid, let size = packageSize, size <= 1000, let whole = all.first(where: { $0.amount == size }) { return whole }
        if let serving = servingGrams, let portion = all.first(where: { $0.amount == serving }) { return portion }
        return all.first { $0.amount == (isLiquid ? 250 : 100) } ?? Portion(title: "100 g", amount: 100)
    }
}

/// How much of a packaged product an amount said in words is, with its macros (`PortionEstimate`).
struct PortionEstimate: Codable, Equatable {
    var barcode: String
    var name: String
    /// g, or ml for a drink.
    var quantity: Double
    var unit: FoodUnit
    /// Totals for `quantity`.
    var macros: NutritionMacros
    /// The amount as said, to log; nil for a share of a package that isn't a can or bottle.
    var measure: Measure?
    /// Share of the package (0–1) when its size is known.
    var packageShare: Double?
    /// "1 cucharada de Crema de cacahuete ≈ 16 g → 94 kcal".
    var assumption: String
}

struct FrequentFood: Codable, Equatable, Identifiable {
    var name: String
    var quantity: Double
    var unit: FoodUnit
    var measure: Measure?
    var caffeineMg: Double?
    var alcoholG: Double?
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
    var amountText: String { foodAmountText(quantity, unit, measure: measure) }

    /// Logs it again as last time, in `slot`.
    func input(slot: MealSlot) -> MealInput {
        MealInput(name: name, slot: slot, quantity: quantity, unit: unit, macros: macros, source: barcode == nil ? "manual" : "barcode",
                  barcode: barcode, measure: measure, caffeineMg: caffeineMg, alcoholG: alcoholG)
    }
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

/// "180 g", "250 ml", "1,5 porciones".
func foodQuantityText(_ quantity: Double, _ unit: FoodUnit) -> String {
    let n = quantity.formatted(.number.precision(.fractionLength(0...1)))
    switch unit {
    case .g, .ml: return "\(n) \(unit.rawValue)"
    case .serving: return quantity == 1 ? "1 porción" : "\(n) porciones"
    }
}

/// The amount as said, with what it came to when that differs: "2 latas · 710 ml", "30 g".
func foodAmountText(_ quantity: Double, _ unit: FoodUnit, measure: Measure?) -> String {
    guard let measure else { return foodQuantityText(quantity, unit) }
    guard measure.unit.isHousehold, unit != .serving else { return measure.text }
    return "\(measure.text) · \(foodQuantityText(quantity, unit))"
}
