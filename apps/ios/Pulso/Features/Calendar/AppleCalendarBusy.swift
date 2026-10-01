import EventKit
import Foundation

/// Reads busy times from Apple Calendar so the Coach plans around them. Opt-in,
/// read-only: only title, dates and whether the event marks the person busy;
/// nothing is ever written back.
enum AppleCalendarBusy {
    struct Event: Encodable, Equatable {
        var externalId: String
        var title: String
        var allDay: Bool
        var date: String
        var endDate: String?
        var start: String?
        var end: String?
    }

    struct Sync: Encodable, Equatable {
        var from: String
        var to: String
        var events: [Event]
    }

    /// How far back and ahead each sync reads.
    static let pastDays = 7
    static let futureDays = 60

    private static let enabledKey = "pulso.calendar.apple"

    static var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: enabledKey) }
        set { UserDefaults.standard.set(newValue, forKey: enabledKey) }
    }

    static var authorized: Bool { EKEventStore.authorizationStatus(for: .event) == .fullAccess }

    /// Asks for access the first time; false when the person declined.
    static func requestAccess() async -> Bool {
        if authorized { return true }
        return (try? await EKEventStore().requestFullAccessToEvents()) ?? false
    }

    /// Busy events around `now`, ready to send.
    static func read(now: Date = .now, calendar: Calendar = .current) -> Sync {
        let store = EKEventStore()
        let start = calendar.date(byAdding: .day, value: -pastDays, to: calendar.startOfDay(for: now))!
        let end = calendar.date(byAdding: .day, value: futureDays + 1, to: calendar.startOfDay(for: now))!
        let events = store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: nil))
            .filter { $0.availability != .free && $0.status != .canceled }
            .map { busy($0, calendar: calendar) }
        return Sync(from: LocalClock.date(start), to: LocalClock.date(calendar.date(byAdding: .day, value: -1, to: end)!), events: events)
    }

    /// One event as a busy block: all-day events keep their last day (EventKit's end is the next midnight).
    static func busy(_ event: EKEvent, calendar: Calendar = .current) -> Event {
        busy(id: event.calendarItemExternalIdentifier ?? event.eventIdentifier, title: event.title ?? "", allDay: event.isAllDay, start: event.startDate, end: event.endDate, calendar: calendar)
    }

    static func busy(id: String, title: String, allDay: Bool, start: Date, end: Date, calendar: Calendar = .current) -> Event {
        let day = LocalClock.date(start)
        if allDay {
            let last = calendar.date(byAdding: .second, value: -1, to: end) ?? end
            return Event(externalId: id, title: title, allDay: true, date: day, endDate: LocalClock.date(max(start, last)))
        }
        // Past midnight it ends at 23:59 of its first day; the engine stores single-day timed blocks.
        let endTime = LocalClock.date(end) == day ? LocalClock.time(end) : "23:59"
        return Event(externalId: id, title: title, allDay: false, date: day, start: LocalClock.time(start), end: endTime)
    }
}
