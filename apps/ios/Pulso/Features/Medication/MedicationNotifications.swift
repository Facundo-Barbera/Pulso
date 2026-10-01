import Foundation
import UserNotifications

/// Local reminders for every scheduled dose, with "Tomada" and "Posponer 15 min"
/// right on the notification. iOS keeps at most 64 pending requests, so the
/// next week of doses is planned (capped) and re-planned on every refresh and
/// every action.
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
        var name: String
        var doseText: String
        var instructions: String?
        var date: String
        var time: String
        var fireAt: Date

        var identifier: String { "\(MedicationNotifications.prefix)\(medicationId).\(date).\(time)" }
    }

    /// Upcoming dose reminders from `now`, soonest first, skipping slots already
    /// logged (`handled` holds `DoseSlot.id`s) and capped to what iOS will keep.
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
                    reminders.append(Reminder(medicationId: med.id, name: med.name, doseText: med.doseText, instructions: med.instructions, date: date, time: time, fireAt: fireAt))
                }
            }
        }
        return Array(reminders.sorted { $0.fireAt < $1.fireAt }.prefix(maxPending))
    }

    /// Replaces every pending dose reminder with `reminders`. Snoozed ones are kept.
    func schedule(_ reminders: [Reminder]) async {
        let pending = await center.pendingNotificationRequests()
        let stale = pending.map(\.identifier).filter { $0.hasPrefix(Self.prefix) && !$0.hasSuffix(".snooze") }
        center.removePendingNotificationRequests(withIdentifiers: stale)
        for reminder in reminders {
            let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: reminder.fireAt)
            let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
            try? await center.add(UNNotificationRequest(identifier: reminder.identifier, content: content(for: reminder), trigger: trigger))
        }
    }

    private func content(for reminder: Reminder) -> UNMutableNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = reminder.name
        content.body = [reminder.doseText, reminder.instructions].compactMap { $0 }.joined(separator: " · ")
        content.sound = .default
        content.categoryIdentifier = Self.category
        content.threadIdentifier = "pulso.medication"
        content.userInfo = ["medicationId": reminder.medicationId, "date": reminder.date, "time": reminder.time]
        return content
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
              let time = content.userInfo["time"] as? String
        else { return }

        switch response.actionIdentifier {
        case Self.takeAction:
            await MedicationStore.shared.log(DoseLog(medicationId: medicationId, date: date, scheduledTime: time, status: .tomada, takenAt: Date.now.timeIntervalSince1970 * 1000))
        case Self.snoozeAction:
            let again = (content.mutableCopy() as? UNMutableNotificationContent) ?? UNMutableNotificationContent()
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: TimeInterval(Self.snoozeMinutes * 60), repeats: false)
            let identifier = "\(Self.prefix)\(medicationId).\(date).\(time).snooze"
            try? await center.add(UNNotificationRequest(identifier: identifier, content: again, trigger: trigger))
            await MedicationStore.shared.log(DoseLog(medicationId: medicationId, date: date, scheduledTime: time, status: .pospuesta), replan: false)
        default:
            break // Tapping the notification just opens the app.
        }
    }

    /// Drops a pending snooze once its dose is logged from the app.
    func clearSnooze(for slotId: String) {
        let parts = slotId.split(separator: "|")
        guard parts.count == 3 else { return }
        let id = "\(Self.prefix)\(parts[0]).\(parts[1]).\(parts[2])"
        center.removePendingNotificationRequests(withIdentifiers: ["\(id).snooze"])
        center.removeDeliveredNotifications(withIdentifiers: [id, "\(id).snooze"])
    }
}
