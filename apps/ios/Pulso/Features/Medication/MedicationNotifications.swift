import Foundation
import UserNotifications

/// Local reminders for every scheduled dose, with "Tomada" and "Posponer 15 min"
/// right on the notification. iOS keeps at most 64 pending requests, so the
/// next week of doses is planned (capped) from the engine's resolved slots and
/// re-planned on every refresh, every action and after every workout.
final class MedicationNotifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = MedicationNotifications()

    static let category = "pulso.medication.dose"
    static let takeAction = "pulso.medication.take"
    static let snoozeAction = "pulso.medication.snooze"
    static let prefix = "pulso.medication."
    static let snoozeMinutes = 15
    static let maxPending = 56

    private let center = UNUserNotificationCenter.current()
    private var activated = false

    /// Registers the actions and becomes the notification delegate. Must run at launch so
    /// an action tapped while the app is closed reaches `didReceive`; idempotent.
    func activate() {
        guard !activated else { return }
        activated = true
        let take = UNNotificationAction(identifier: Self.takeAction, title: "Tomada", options: [.authenticationRequired], icon: .init(systemImageName: "checkmark.circle.fill"))
        let snooze = UNNotificationAction(identifier: Self.snoozeAction, title: "Posponer \(Self.snoozeMinutes) min", options: [], icon: .init(systemImageName: "clock.arrow.circlepath"))
        let category = UNNotificationCategory(identifier: Self.category, actions: [take, snooze], intentIdentifiers: [], options: [])
        center.setNotificationCategories([category])
        center.delegate = self
    }

    @discardableResult
    func requestAuthorization() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    // MARK: Planning

    struct Reminder: Equatable {
        var medicationId: String
        var date: String
        /// The slot key it logs under: "HH:mm" or a moment ("entreno"…).
        var slot: String
        var title: String
        var body: String
        var fireAt: Date
        /// A workout already ended and the dose is still pending: it fires right away, once.
        var catchUp = false

        var identifier: String { "\(MedicationNotifications.prefix)\(medicationId).\(date).\(slot)" }
    }

    /// How soon a catch-up reminder fires.
    static let catchUpDelay: TimeInterval = 5

    /// Reminders from the engine's resolved slots, soonest first, capped to what iOS keeps.
    /// - A slot with a time fires then.
    /// - A slot waiting for a workout fires at its rest-day `fallback`; a workout replans it.
    /// - A workout that already ended with the dose pending fires in a few seconds while
    ///   still within its window, unless it already did (`nudged` holds `DoseSlot.id`s).
    static func plan(slots: [DoseSlot], now: Date, nudged: Set<String> = [], calendar: Calendar = .current) -> [Reminder] {
        var reminders: [Reminder] = []
        for slot in slots where slot.status == .pendiente {
            let training = slot.training
            var fireAt: Date?
            var catchUp = false
            if let time = slot.time, let at = LocalClock.instant(date: slot.date, time: time, calendar: calendar) {
                if at > now {
                    fireAt = at
                } else if training?.state == .trained, !nudged.contains(slot.id),
                          let until = training?.until, let deadline = LocalClock.instant(date: slot.date, time: until, calendar: calendar), deadline > now {
                    fireAt = now.addingTimeInterval(catchUpDelay)
                    catchUp = true
                }
            } else if slot.time == nil, let fallback = training?.fallback,
                      let at = LocalClock.instant(date: slot.date, time: fallback, calendar: calendar), at > now {
                fireAt = at
            }
            guard let fireAt else { continue }
            reminders.append(Reminder(medicationId: slot.medicationId, date: slot.date, slot: slot.slot, title: title(slot),
                                      body: body(slot), fireAt: fireAt, catchUp: catchUp))
        }
        return Array(reminders.sorted { $0.fireAt < $1.fireAt }.prefix(maxPending))
    }

    /// "Toma tu creatina" after training; the med's name otherwise.
    static func title(_ slot: DoseSlot) -> String {
        slot.moment == .entreno ? "Toma tu \(slot.name.lowercased())" : slot.name
    }

    static func body(_ slot: DoseSlot) -> String {
        var parts = [slot.doseText]
        switch slot.moment {
        case .entreno:
            if slot.training?.state == .trained, let until = slot.training?.until {
                parts.append("antes de las \(LocalClock.display(until))")
            } else if slot.time == nil {
                parts.append("hoy sin entreno")
            }
        case .desayuno, .comida, .cena, .dormir:
            parts.append(slot.moment.title.lowercased())
        case .hora:
            break
        }
        if let instructions = slot.instructions { parts.append(instructions) }
        return parts.joined(separator: " · ")
    }

    /// Fallback for an engine without `/upcoming`: fixed times expanded here, from `now`,
    /// soonest first, skipping slots already logged (`handled` holds `DoseSlot.id`s).
    static func plan(medications: [Medication], handled: Set<String>, now: Date, days: Int = 7, calendar: Calendar = .current) -> [Reminder] {
        var reminders: [Reminder] = []
        let start = calendar.startOfDay(for: now)
        for offset in 0..<days {
            guard let day = calendar.date(byAdding: .day, value: offset, to: start) else { continue }
            let date = LocalClock.date(day)
            let weekday = LocalClock.isoWeekday(day, calendar: calendar)
            for med in medications where med.active && !med.schedule.asNeeded {
                if date < med.startDate { continue }
                if let end = med.endDate, date > end { continue }
                if !med.schedule.days.isEmpty && !med.schedule.days.contains(weekday) { continue }
                for time in med.schedule.times {
                    guard !handled.contains("\(med.id)|\(date)|\(time)"),
                          let fireAt = LocalClock.instant(date: date, time: time, calendar: calendar), fireAt > now
                    else { continue }
                    let body = [med.doseText, med.instructions].compactMap { $0 }.joined(separator: " · ")
                    reminders.append(Reminder(medicationId: med.id, date: date, slot: time, title: med.name, body: body, fireAt: fireAt))
                }
            }
        }
        return Array(reminders.sorted { $0.fireAt < $1.fireAt }.prefix(maxPending))
    }

    /// Replaces every pending dose reminder with `reminders`. Snoozed and catch-up ones
    /// (both on a short timer) are kept: a replan seconds later must not drop them.
    func schedule(_ reminders: [Reminder]) async {
        let pending = await center.pendingNotificationRequests()
        let stale = pending
            .filter { $0.identifier.hasPrefix(Self.prefix) && !$0.identifier.hasSuffix(".snooze") && !($0.trigger is UNTimeIntervalNotificationTrigger) }
            .map(\.identifier)
        center.removePendingNotificationRequests(withIdentifiers: stale)
        for reminder in reminders {
            let trigger: UNNotificationTrigger
            if reminder.catchUp {
                trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, reminder.fireAt.timeIntervalSinceNow), repeats: false)
                markNudged("\(reminder.medicationId)|\(reminder.date)|\(reminder.slot)")
            } else {
                let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: reminder.fireAt)
                trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
            }
            try? await center.add(UNNotificationRequest(identifier: reminder.identifier, content: content(for: reminder), trigger: trigger))
        }
    }

    private func content(for reminder: Reminder) -> UNMutableNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = reminder.title
        content.body = reminder.body
        content.sound = .default
        content.categoryIdentifier = Self.category
        content.threadIdentifier = "pulso.medication"
        content.userInfo = ["medicationId": reminder.medicationId, "date": reminder.date, "slot": reminder.slot]
        return content
    }

    // MARK: Catch-up reminders already sent

    private static let nudgedKey = "pulso.medication.nudged"

    /// Slot ids (`DoseSlot.id`) whose post-workout catch-up already fired, so a replan doesn't repeat it.
    var nudged: Set<String> { Set(UserDefaults.standard.stringArray(forKey: Self.nudgedKey) ?? []) }

    private func markNudged(_ slotId: String) {
        // Only today's and yesterday's matter; older ids are dropped as new ones come.
        let recent = Set([LocalClock.date(.now), LocalClock.date(.now.addingTimeInterval(-86_400))])
        let kept = nudged.filter { id in recent.contains { id.contains("|\($0)|") } }
        UserDefaults.standard.set(Array(kept.union([slotId])), forKey: Self.nudgedKey)
    }

    // MARK: Delegate

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let content = response.notification.request.content
        guard content.categoryIdentifier == Self.category,
              let medicationId = content.userInfo["medicationId"] as? String,
              let date = content.userInfo["date"] as? String,
              // "time" is what builds before slot keys wrote; it's the key of a fixed-time slot.
              let slot = content.userInfo["slot"] as? String ?? content.userInfo["time"] as? String
        else { return }

        switch response.actionIdentifier {
        case Self.takeAction:
            await MedicationStore.shared.log(DoseLog(medicationId: medicationId, date: date, scheduledTime: slot, status: .tomada, takenAt: (Date.now.timeIntervalSince1970 * 1000).rounded()))
        case Self.snoozeAction:
            let again = (content.mutableCopy() as? UNMutableNotificationContent) ?? UNMutableNotificationContent()
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: TimeInterval(Self.snoozeMinutes * 60), repeats: false)
            let identifier = "\(Self.prefix)\(medicationId).\(date).\(slot).snooze"
            try? await center.add(UNNotificationRequest(identifier: identifier, content: again, trigger: trigger))
            await MedicationStore.shared.log(DoseLog(medicationId: medicationId, date: date, scheduledTime: slot, status: .pospuesta), replan: false)
        default:
            break // Tapping the notification just opens the app.
        }
    }

    /// Drops a slot's pending reminder, snooze or catch-up once its dose is logged from the app.
    func clearSnooze(for slotId: String) {
        let parts = slotId.split(separator: "|")
        guard parts.count == 3 else { return }
        let id = "\(Self.prefix)\(parts[0]).\(parts[1]).\(parts[2])"
        center.removePendingNotificationRequests(withIdentifiers: [id, "\(id).snooze"])
        center.removeDeliveredNotifications(withIdentifiers: [id, "\(id).snooze"])
    }
}
