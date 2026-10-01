import Foundation
import Observation

/// The Dieta tab's state: the selected day, its log, plan and water, the last 7
/// days and frequent foods. Errors go to `PulsoModel.shared.handle(_:)`.
@MainActor
@Observable
final class NutritionStore {
    var date = Date.now
    private(set) var day: NutritionDay?
    private(set) var week: [NutritionSummary] = []
    /// Water ml per day of `week`, by `YYYY-MM-DD`.
    private(set) var weekWater: [String: Double] = [:]
    private(set) var frequent: [FrequentFood] = []
    /// Snacks and drinks logged most lately, for the "Snack o bebida" sheet.
    private(set) var frequentSnacks: [FrequentFood] = []
    private(set) var loading = false
    /// The dated plan from today over its horizon (nil without a plan, or from an engine that predates it).
    private(set) var horizon: DietHorizon?
    /// The slot "Lo cambié por…" is replacing: what Registrar logs meanwhile is linked to it when it closes.
    private(set) var replacing: PlanSlot?
    private var replacementIds: [String] = []

    private var api: PulsoAPI? { PulsoModel.shared.api }

    /// The selected day as the plan lays it out. Only today: past days are never laid out from the phone.
    var planDay: DietDay? { isToday ? horizon?.day(dateKey) : nil }
    var dateKey: String { NutritionDate.string(date) }
    var isToday: Bool { Calendar.current.isDateInToday(date) }
    var targets: NutritionTargets? { day?.summary.targets }
    var water: WaterDay? { day?.water }

    func meals(in slot: MealSlot) -> [MealEntry] { day?.meals.filter { $0.slot == slot } ?? [] }

    func isEaten(_ item: DietPlanItem) -> Bool { day?.plan?.eatenItemIds.contains(item.id) ?? false }

    /// The first planned meal with nothing logged in its slot yet.
    var nextMeal: DietPlanForDay.Meal? {
        guard let day, let plan = day.plan else { return nil }
        let logged = Set(day.meals.map(\.slot))
        return plan.meals.first { meal in !logged.contains(meal.slot) && !meal.items.allSatisfy(isEaten) }
    }

    /// Frequent foods and snacks in one list, for the Registrar sheet.
    var allFrequent: [FrequentFood] {
        var seen = Set<String>()
        return (frequent + frequentSnacks).filter { seen.insert($0.id).inserted }
    }

    func shift(days: Int) async {
        date = Calendar.current.date(byAdding: .day, value: days, to: date) ?? date
        await load()
    }

    func goToToday() async {
        date = .now
        await load()
    }

    func load() async {
        guard let api else { return }
        loading = true
        defer { loading = false }
        do {
            let key = dateKey
            async let day = api.nutritionDay(key)
            async let week = api.nutritionHistory(days: 7, to: key)
            async let frequent = api.frequentFoods()
            async let snacks = api.frequentFoods(snacks: true)
            async let horizon = api.dietHorizon(from: NutritionDate.string(.now))
            let history: (days: [NutritionSummary], water: [String: Double])
            (self.day, history, self.frequent, frequentSnacks) = try await (day, week, frequent, snacks)
            (self.week, weekWater) = history
            // The dated plan is extra: an older engine without it still shows the day.
            self.horizon = (try? await horizon) ?? nil
        } catch {
            PulsoModel.shared.handle(error)
        }
    }

    /// Logs a food on the selected day, at the current time of day. Returns whether it worked.
    @discardableResult
    func log(_ input: MealInput) async -> Bool {
        guard let api else { return false }
        var input = input
        input.date = dateKey
        input.eatenAt = (eatenAtNow().timeIntervalSince1970 * 1000).rounded()
        return await run {
            let meal = try await api.logMeal(input)
            if replacing != nil { replacementIds.append(meal.id) }
        }
    }

    func delete(_ meal: MealEntry) async {
        guard let api else { return }
        // Drop it right away so the swipe feels instant; the reload confirms.
        day?.meals.removeAll { $0.id == meal.id }
        await run { try await api.deleteMeal(meal.id) }
    }

    func eat(_ item: DietPlanItem) async {
        guard let api else { return }
        await run { _ = try await api.eatPlanItem(item.id, date: dateKey) }
    }

    /// "Comí lo del plan": every item of the meal not yet logged, with one reload.
    @discardableResult
    func eat(_ meal: DietPlanForDay.Meal) async -> Bool {
        guard let api else { return false }
        let items = meal.items.filter { !isEaten($0) }
        let key = dateKey
        return await run { for item in items { _ = try await api.eatPlanItem(item.id, date: key) } }
    }

    /// "Copiar ayer": every entry of the previous day onto the selected one.
    func copyPreviousDay() async -> Int {
        guard let api, let previous = Calendar.current.date(byAdding: .day, value: -1, to: date) else { return 0 }
        var copied = 0
        await run { copied = try await api.copyMeals(from: NutritionDate.string(previous), to: dateKey).count }
        return copied
    }

    // MARK: Dated plan

    /// Runs a plan change; the Mac answers with its Spanish summary and the revision to undo.
    func apply(_ op: PlanOp) async -> PlanChange? {
        guard let api else { return nil }
        return await value { try await api.applyPlanOp(op) }
    }

    /// Undoes a change (the latest when `id` is nil).
    func undo(_ id: String? = nil) async -> PlanChange? {
        guard let api else { return nil }
        return await value { try await api.undoPlanRevision(id) }
    }

    /// "Me lo comí": logs what the slot holds now (adjusted portions included); the Mac links each entry to it.
    func eat(_ slot: PlanSlot) async -> [MealEntry] {
        guard let api else { return [] }
        return await value { try await api.eatSlot(slot.id) } ?? []
    }

    /// Takes back entries just logged, e.g. undoing "Me lo comí".
    func deleteMeals(_ ids: [String]) async {
        guard let api else { return }
        await run { for id in ids { try await api.deleteMeal(id) } }
    }

    func beginReplacing(_ slot: PlanSlot) {
        replacing = slot
        replacementIds = []
    }

    /// Registrar closed: what was logged while replacing now replaces the slot. Nil when nothing was logged.
    func finishReplacing() async -> PlanChange? {
        guard let slot = replacing else { return nil }
        let ids = replacementIds
        replacing = nil
        replacementIds = []
        guard !ids.isEmpty else { return nil }
        return await apply(.replace(slot, entryIds: ids))
    }

    // MARK: Water

    /// Adds water right away (the card fills before the Mac answers), then mirrors it to Salud.
    /// Returns the logged entry, so it can be undone.
    @discardableResult
    func addWater(ml: Double) async -> WaterEntry? {
        guard let api, ml > 0 else { return nil }
        let key = dateKey
        if var water = day?.water {
            water.totalMl += ml
            day?.water = water
        }
        do {
            let (entry, updated) = try await api.logWater(ml: ml, date: key, loggedAt: (eatenAtNow().timeIntervalSince1970 * 1000).rounded())
            if dateKey == key { day?.water = updated }
            await WaterHealth.save(entry)
            return entry
        } catch {
            PulsoModel.shared.handle(error)
            await load()
            return nil
        }
    }

    /// Removes the day's latest water entry, here and in Salud.
    func undoWater() async {
        guard let last = day?.water?.entries.last else { return }
        await removeWater(last)
    }

    func removeWater(_ entry: WaterEntry) async {
        guard let api else { return }
        if day?.water?.entries.contains(entry) == true {
            day?.water?.entries.removeAll { $0.id == entry.id }
            day?.water?.totalMl -= entry.amountMl
        }
        do {
            try await api.deleteWater(entry.id)
            await WaterHealth.delete(entry.id)
        } catch {
            PulsoModel.shared.handle(error)
        }
        await load()
    }

    func saveWaterSettings(_ settings: WaterSettings) async {
        guard let api else { return }
        await run { _ = try await api.saveWaterSettings(settings) }
    }

    /// "Volver al plan": drops the Coach's adjustment for the selected day.
    func clearAdjustment() async {
        guard let api else { return }
        await run { try await api.clearAdjustment(date: dateKey) }
    }

    func saveTargets(_ targets: NutritionTargets) async {
        guard let api else { return }
        await run { _ = try await api.setTargets(targets) }
    }

    func lookup(_ code: String) async throws -> FoodProduct? {
        guard let api else { return nil }
        return try await api.lookupBarcode(code)
    }

    func estimatePortion(_ barcode: String, amount: String) async throws -> PortionEstimate? {
        guard let api else { return nil }
        return try await api.estimatePortion(barcode: barcode, amount: amount)
    }

    @discardableResult
    private func run(_ action: () async throws -> Void) async -> Bool {
        do {
            try await action()
            await load()
            return true
        } catch {
            PulsoModel.shared.handle(error)
            await load()
            return false
        }
    }

    /// Like `run`, keeping what the request answered; nil when it failed.
    private func value<T>(_ action: () async throws -> T) async -> T? {
        do {
            let result = try await action()
            await load()
            return result
        } catch {
            PulsoModel.shared.handle(error)
            await load()
            return nil
        }
    }

    private func eatenAtNow() -> Date {
        let now = Date.now
        if isToday { return now }
        let time = Calendar.current.dateComponents([.hour, .minute], from: now)
        return Calendar.current.date(bySettingHour: time.hour ?? 12, minute: time.minute ?? 0, second: 0, of: date) ?? date
    }
}
