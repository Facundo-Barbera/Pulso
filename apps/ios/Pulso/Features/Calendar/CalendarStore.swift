import Foundation
import Observation

/// Calendar state shared by the full screen and the week strip on Hoy. Items are
/// cached per day; views ask for the range they show with `ensure(from:to:)`.
@MainActor
@Observable
final class CalendarStore {
    static let shared = CalendarStore()

    private(set) var itemsByDate: [String: [CalendarItem]] = [:]
    private(set) var healthEvents: [HealthEvent] = []
    private(set) var busyBlocks: [BusyBlock] = []
    /// What the last change did to planned training, for a banner. Cleared on dismiss.
    var lastReplan: Replan?
    private(set) var loading = false
    private(set) var healthLoaded = false

    private var loadedDays: Set<String> = []
    private var model: PulsoModel { .shared }

    func items(on day: Date) -> [CalendarItem] { itemsByDate[LocalClock.date(day)] ?? [] }

    /// Colour keys present on a day, in the strip's order. Planned meal times don't count: they're every day.
    func dots(on day: Date) -> [String] {
        let keys = Set(items(on: day).filter { $0.kind != .meal_time }.map(\.color))
        return CalendarStyle.dotOrder.filter(keys.contains)
    }

    var activeHealth: [HealthEvent] { healthEvents.filter(\.isActive) }
    var pastHealth: [HealthEvent] { healthEvents.filter { !$0.isActive } }

    /// Loads [from, to] unless every day of it is already cached.
    func ensure(from: Date, to: Date) async {
        let days = CalendarMath.days(from: from, count: (Calendar.current.dateComponents([.day], from: from, to: to).day ?? 0) + 1).map(LocalClock.date)
        guard !days.allSatisfy(loadedDays.contains) else { return }
        await load(days.first!, days.last!)
    }

    /// Re-reads every cached day (after a change) plus the given range.
    func refresh(around day: Date = .now) async {
        let week = CalendarMath.week(of: day)
        let cached = loadedDays.sorted()
        var from = LocalClock.date(Calendar.current.date(byAdding: .day, value: -7, to: week[0])!)
        var to = LocalClock.date(Calendar.current.date(byAdding: .day, value: 13, to: week[0])!)
        if let first = cached.first, let last = cached.last {
            from = min(from, first)
            to = max(to, last)
        }
        loadedDays = []
        // The engine serves at most 125 days at once; past that, keep the range around `day`.
        if let start = LocalClock.day(from), let end = LocalClock.day(to), (Calendar.current.dateComponents([.day], from: start, to: end).day ?? 0) >= 120 {
            from = LocalClock.date(Calendar.current.date(byAdding: .day, value: -35, to: week[0])!)
            to = LocalClock.date(Calendar.current.date(byAdding: .day, value: 48, to: week[0])!)
            itemsByDate = [:]
        }
        await load(from, to)
        await loadDefinitions()
    }

    private func load(_ from: String, _ to: String) async {
        guard let api = model.api else { return }
        loading = true
        defer { loading = false }
        do {
            let range = try await api.calendar(from: from, to: to)
            var byDate = itemsByDate
            var day = from
            while day <= to {
                byDate[day] = []
                loadedDays.insert(day)
                guard let next = LocalClock.day(day).flatMap({ Calendar.current.date(byAdding: .day, value: 1, to: $0) }) else { break }
                day = LocalClock.date(next)
            }
            for item in range.items { byDate[item.date, default: []].append(item) }
            itemsByDate = byDate
        } catch {
            model.handle(error)
        }
    }

    /// Busy block and health event definitions (for editing from the timeline and the Salud list).
    func loadDefinitions() async {
        guard let api = model.api else { return }
        do {
            async let blocks = api.busyBlocks()
            async let events = api.healthEvents()
            (busyBlocks, healthEvents) = try await (blocks, events)
            healthLoaded = true
        } catch {
            model.handle(error)
        }
    }

    func busyBlock(id: String?) -> BusyBlock? { busyBlocks.first { $0.id == id } }
    func healthEvent(id: String?) -> HealthEvent? { healthEvents.first { $0.id == id } }

    // MARK: Changes

    func saveBusy(_ draft: BusyBlockDraft, id: String?) async -> Bool {
        await change { api in
            id == nil ? try await api.addBusyBlock(draft).replan : try await api.updateBusyBlock(id: id!, draft).replan
        }
    }

    func deleteBusy(id: String) async {
        _ = await change { try await $0.deleteBusyBlock(id: id).replan }
    }

    func saveHealth(_ draft: HealthEventDraft, id: String?) async -> Bool {
        await change { api in
            id == nil ? try await api.addHealthEvent(draft).replan : try await api.updateHealthEvent(id: id!, draft).replan
        }
    }

    func deleteHealth(id: String) async {
        _ = await change { try await $0.deleteHealthEvent(id: id).replan }
    }

    /// Sends Apple Calendar's busy times when the person turned it on. Quietly does nothing otherwise.
    func syncAppleCalendar() async {
        guard AppleCalendarBusy.enabled, AppleCalendarBusy.authorized else { return }
        _ = await change { try await $0.syncAppleCalendar(AppleCalendarBusy.read()).replan }
    }

    /// Turns the Apple Calendar import on (asking for access) or off.
    func setAppleCalendar(_ on: Bool) async -> Bool {
        if on {
            guard await AppleCalendarBusy.requestAccess() else { return false }
            AppleCalendarBusy.enabled = true
            await syncAppleCalendar()
        } else {
            AppleCalendarBusy.enabled = false
        }
        return true
    }

    private func change(_ run: (PulsoAPI) async throws -> Replan) async -> Bool {
        guard let api = model.api else { return false }
        do {
            let replan = try await run(api)
            if !replan.isEmpty { lastReplan = replan }
            await refresh()
            return true
        } catch {
            model.handle(error)
            return false
        }
    }
}
