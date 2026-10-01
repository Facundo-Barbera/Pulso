import ActivityKit
import Foundation
import Observation
import UIKit
import UserNotifications

/// The session on screen: wraps `LiveSessionState` with what the pure value
/// can't do — saving to disk on every change, the Live Activity, the rest
/// notification for a locked phone and the haptic when rest ends.
@MainActor
@Observable
final class LiveSession {
    private(set) var state: LiveSessionState {
        didSet {
            TrainingFiles.save(state, to: TrainingFiles.live)
            updateActivity()
        }
    }

    @ObservationIgnored private var activity: Activity<TrainingActivityAttributes>?
    @ObservationIgnored private var restTask: Task<Void, Never>?

    init(state: LiveSessionState) {
        self.state = state
        TrainingFiles.save(state, to: TrainingFiles.live)
    }

    /// The session left running when the app was last killed, if any.
    static func restore() -> LiveSession? {
        guard let state = TrainingFiles.load(LiveSessionState.self, from: TrainingFiles.live) else { return nil }
        let session = LiveSession(state: state)
        session.activity = Activity<TrainingActivityAttributes>.activities.first
        session.armRest()
        return session
    }

    func begin() {
        startActivity()
        Task { _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) }
    }

    // MARK: Editing

    func toggle(exercise e: Int, set s: Int) {
        state.toggle(exercise: e, set: s)
        armRest()
    }

    func adjustWeight(exercise e: Int, set s: Int, by steps: Double) { state.adjustWeight(exercise: e, set: s, by: steps) }
    func adjustReps(exercise e: Int, set s: Int, by delta: Int) { state.adjustReps(exercise: e, set: s, by: delta) }
    func addSet(exercise e: Int) { state.addSet(exercise: e) }

    func extendRest(by seconds: TimeInterval) {
        state.extendRest(by: seconds)
        armRest()
    }

    func skipRest() {
        state.skipRest()
        armRest()
    }

    /// Stops the timers and the Live Activity and forgets the session on disk.
    func close() async {
        restTask?.cancel()
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [Self.restNotification])
        TrainingFiles.remove(TrainingFiles.live)
        let final = ActivityContent(state: state.activityState(), staleDate: nil)
        for activity in Activity<TrainingActivityAttributes>.activities {
            await activity.end(final, dismissalPolicy: .immediate)
        }
        activity = nil
    }

    // MARK: Rest

    private static let restNotification = "pulso.training.rest"

    /// One timer for the foreground haptic, one notification for a phone in the pocket.
    private func armRest() {
        restTask?.cancel()
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [Self.restNotification])
        guard let end = state.restEndsAt, end > .now else { return }

        restTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(end.timeIntervalSinceNow))
            guard !Task.isCancelled, let self else { return }
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            self.updateActivity()
        }

        let content = UNMutableNotificationContent()
        content.title = "Descanso terminado"
        let next = state.activityState(now: end)
        content.body = next.target.isEmpty ? next.exerciseName : "\(next.exerciseName) · \(next.target)"
        content.sound = .default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, end.timeIntervalSinceNow), repeats: false)
        center.add(UNNotificationRequest(identifier: Self.restNotification, content: content, trigger: trigger))
    }

    // MARK: Live Activity

    private func startActivity() {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let attributes = TrainingActivityAttributes(sessionName: state.name, startedAt: state.startedAt)
        activity = try? Activity.request(attributes: attributes, content: ActivityContent(state: state.activityState(), staleDate: nil))
    }

    private func updateActivity() {
        guard let activity else { return }
        let content = ActivityContent(state: state.activityState(), staleDate: state.restEndsAt)
        Task { await activity.update(content) }
    }
}

/// JSON files under Application Support/Training: the live session and sessions waiting to upload.
enum TrainingFiles {
    static let directory = URL.applicationSupportDirectory.appending(path: "Training", directoryHint: .isDirectory)
    static let live = directory.appending(path: "live-session.json")
    static let pending = directory.appending(path: "pending-sessions.json")

    static func save<Value: Encodable>(_ value: Value, to url: URL) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? JSONEncoder().encode(value).write(to: url, options: .atomic)
    }

    static func load<Value: Decodable>(_ type: Value.Type, from url: URL) -> Value? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    static func remove(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
    }
}
