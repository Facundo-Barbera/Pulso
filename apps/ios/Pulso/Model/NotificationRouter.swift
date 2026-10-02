import Foundation
import Observation
import UserNotifications

/// The app's notification delegate: dose actions go to Medicación, a tapped
/// notification becomes a `Route` that RootView opens once the scene is active.
///
/// UIKit's completion handlers for these callbacks update the app snapshot, and
/// iOS 27 aborts when that happens off the main thread. The `async` delegate
/// variants run on the cooperative pool (the protocol isn't main-actor) and call
/// the handler there, which crashed every launch from a notification; so the
/// completion-handler variants are implemented and always finish on the main actor.
@MainActor
@Observable
final class NotificationRouter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationRouter()

    enum Route: Equatable {
        case coach(threadId: String)
        /// The live session (rest over, cardio cue).
        case training
        /// A dose reminder: Hoy shows the day's doses.
        case today
    }

    /// The route waiting for the scene to be active.
    private(set) var pending: Route?

    private var activated = false

    /// Must run at launch so a notification that launches the app reaches `didReceive`; idempotent.
    func activate() {
        guard !activated else { return }
        activated = true
        UNUserNotificationCenter.current().delegate = self
    }

    /// Hands the pending route to RootView, once.
    func take() -> Route? {
        defer { pending = nil }
        return pending
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        Self.onMain({ [.banner, .list, .sound] }, then: completionHandler)
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        Self.onMain({ await NotificationRouter.shared.handle(response) }, then: { _ in completionHandler() })
    }

    /// Runs `work` on the main actor and calls `completion` there after it, whatever thread asked.
    nonisolated static func onMain<Value>(_ work: @escaping @MainActor () async -> Value, then completion: @escaping (Value) -> Void) {
        Task { @MainActor in completion(await work()) }
    }

    private func handle(_ response: UNNotificationResponse) async {
        let request = response.notification.request
        if request.content.categoryIdentifier == MedicationNotifications.category {
            await MedicationNotifications.shared.respond(to: response)
        }
        // "Tomada" and "Posponer" are done without opening anything.
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier else { return }
        pending = Self.route(identifier: request.identifier, category: request.content.categoryIdentifier)
    }

    /// Where a tapped notification leads, from the identifiers the app gives them.
    nonisolated static func route(identifier: String, category: String) -> Route? {
        if category == MedicationNotifications.category { return .today }
        if identifier.hasPrefix("coach-") {
            let threadId = String(identifier.dropFirst("coach-".count))
            return threadId.isEmpty ? nil : .coach(threadId: threadId)
        }
        if identifier.hasPrefix("pulso.training.") { return .training }
        return nil
    }
}
