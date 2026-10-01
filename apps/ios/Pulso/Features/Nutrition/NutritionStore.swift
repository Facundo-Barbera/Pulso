import Foundation
import Observation

/// The Dieta tab's state: the selected day, its log and plan, the last 7 days
/// and frequent foods. Errors go to `PulsoModel.shared.handle(_:)`.
@MainActor
@Observable
final class NutritionStore {
    var date = Date.now
    private(set) var day: NutritionDay?
    private(set) var week: [NutritionSummary] = []
    private(set) var frequent: [FrequentFood] = []
    private(set) var loading = false

    private var api: PulsoAPI? { PulsoModel.shared.api }
    var dateKey: String { NutritionDate.string(date) }
    var isToday: Bool { Calendar.current.isDateInToday(date) }
    var targets: NutritionTargets? { day?.summary.targets }

    func meals(in slot: MealSlot) -> [MealEntry] { day?.meals.filter { $0.slot == slot } ?? [] }

    func isEaten(_ item: DietPlanItem) -> Bool { day?.plan?.eatenItemIds.contains(item.id) ?? false }

    func shift(days: Int) async {
        date = Calendar.current.date(byAdding: .day, value: days, to: date) ?? date
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
            (self.day, self.week, self.frequent) = try await (day, week, frequent)
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
        input.eatenAt = eatenAtNow().timeIntervalSince1970 * 1000
        return await run { _ = try await api.logMeal(input) }
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

    /// "Copiar ayer": every entry of the previous day onto the selected one.
    func copyPreviousDay() async -> Int {
        guard let api, let previous = Calendar.current.date(byAdding: .day, value: -1, to: date) else { return 0 }
        var copied = 0
        await run { copied = try await api.copyMeals(from: NutritionDate.string(previous), to: dateKey).count }
        return copied
    }

    func saveTargets(_ targets: NutritionTargets) async {
        guard let api else { return }
        await run { _ = try await api.setTargets(targets) }
    }

    func lookup(_ code: String) async throws -> FoodProduct? {
        guard let api else { return nil }
        return try await api.lookupBarcode(code)
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

    private func eatenAtNow() -> Date {
        let now = Date.now
        if isToday { return now }
        let time = Calendar.current.dateComponents([.hour, .minute], from: now)
        return Calendar.current.date(bySettingHour: time.hour ?? 12, minute: time.minute ?? 0, second: 0, of: date) ?? date
    }
}
