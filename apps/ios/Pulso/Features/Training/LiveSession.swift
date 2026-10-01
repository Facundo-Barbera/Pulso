import ActivityKit
import Foundation
import Observation
import SwiftUI
import UIKit
import UserNotifications

/// The session on screen: wraps `LiveSessionState` with what the pure value
/// can't do — saving to disk on every change, syncing with the engine (so the
/// Coach can change it), the Live Activity, the rest and cardio notifications
/// for a locked phone and the haptics.
@MainActor
@Observable
final class LiveSession {
    private(set) var state: LiveSessionState {
        didSet {
            TrainingFiles.save(state, to: TrainingFiles.live)
            updateActivity()
        }
    }

    /// The stopwatch of the cardio block being done, if any.
    private(set) var clock: CardioClock? {
        didSet {
            if let clock { TrainingFiles.save(clock, to: TrainingFiles.cardio) } else { TrainingFiles.remove(TrainingFiles.cardio) }
            updateActivity()
        }
    }

    /// The session before the Coach's last change, while "Deshacer" is offered.
    private(set) var coachUndo: LiveSessionState?
    /// Bumped when the Coach changed the session, for the haptic.
    private(set) var coachChanges = 0

    @ObservationIgnored private var activity: Activity<TrainingActivityAttributes>?
    @ObservationIgnored private var restTask: Task<Void, Never>?
    @ObservationIgnored private var cardioTask: Task<Void, Never>?
    @ObservationIgnored private var undoTask: Task<Void, Never>?
    @ObservationIgnored private var pushTask: Task<Void, Never>?
    /// Local changes the engine hasn't confirmed yet.
    @ObservationIgnored private var dirty = false
    @ObservationIgnored private var pushing = false
    @ObservationIgnored private var closed = false
    /// Conflicts in a row; reset by a push that lands.
    @ObservationIgnored private var conflicts = 0

    init(state: LiveSessionState, clock: CardioClock? = nil) {
        self.state = state
        self.clock = clock
        TrainingFiles.save(state, to: TrainingFiles.live)
    }

    /// The session left running when the app was last killed, if any. It may
    /// hold changes the engine never got, so it is pushed again.
    static func restore() -> LiveSession? {
        guard let data = try? Data(contentsOf: TrainingFiles.live), let state = LiveSessionState.decodeStored(data) else { return nil }
        let session = LiveSession(state: state, clock: TrainingFiles.load(CardioClock.self, from: TrainingFiles.cardio))
        session.activity = Activity<TrainingActivityAttributes>.activities.first
        session.dirty = true
        session.armRest()
        session.armCardio()
        session.schedulePush(after: .seconds(2))
        return session
    }

    /// Starts the Live Activity and gives the engine the new session (base version 0).
    func begin() {
        startActivity()
        dirty = true
        schedulePush(after: .zero)
        Task { _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) }
    }

    /// Every local edit: applied, saved, and pushed to the engine shortly after.
    private func mutate(_ change: (inout LiveSessionState) -> Void) {
        var next = state
        change(&next)
        guard next != state else { return }
        next.updatedAt = .now
        state = next
        dirty = true
        schedulePush()
    }

    // MARK: Sets

    func toggle(exercise e: Int, set s: Int) {
        mutate { $0.toggle(exercise: e, set: s) }
        armRest()
        // No rest to wait for (0 s or the session's last set): move on now.
        if !state.resting() { mutate { $0.advanceIfDone() } }
    }

    func completeAll(exercise e: Int) {
        mutate { $0.completeAll(exercise: e) }
        armRest()
        if !state.resting() { mutate { $0.advanceIfDone() } }
    }

    func setEffort(exercise e: Int, to value: Int?) { mutate { $0.setEffort(exercise: e, to: value) } }
    func adjustWeight(exercise e: Int, set s: Int, by steps: Double) { mutate { $0.adjustWeight(exercise: e, set: s, by: steps) } }
    func adjustReps(exercise e: Int, set s: Int, by delta: Int) { mutate { $0.adjustReps(exercise: e, set: s, by: delta) } }
    func setWeight(exercise e: Int, set s: Int, to kg: Double) { mutate { $0.setWeight(exercise: e, set: s, to: kg) } }
    func setReps(exercise e: Int, set s: Int, to reps: Int) { mutate { $0.setReps(exercise: e, set: s, to: reps) } }
    func addSet(exercise e: Int) { mutate { $0.addSet(exercise: e) } }
    func removeSet(exercise e: Int, set s: Int) { mutate { $0.removeSet(exercise: e, set: s) } }

    func extendRest(by seconds: TimeInterval) {
        mutate { $0.extendRest(by: seconds) }
        armRest()
    }

    func skipRest() {
        mutate {
            $0.skipRest()
            $0.advanceIfDone()
        }
        armRest()
    }

    // MARK: Focus and editing (solo hoy)

    func setFocus(_ index: Int) { mutate { $0.setFocus(index) } }

    func move(fromOffsets source: IndexSet, toOffset destination: Int) { mutate { $0.move(fromOffsets: source, toOffset: destination) } }

    func setSkipped(_ index: Int, _ skipped: Bool) {
        mutate { $0.setSkipped(index, skipped) }
        if skipped, state.exercises.indices.contains(index), clock?.exerciseId == state.exercises[index].id {
            clock = nil
            armCardio()
        }
    }

    func remove(at index: Int) {
        let removedId = state.exercises.indices.contains(index) ? state.exercises[index].id : nil
        mutate { $0.remove(at: index) }
        if let removedId, clock?.exerciseId == removedId, !state.exercises.contains(where: { $0.id == removedId }) {
            clock = nil
            armCardio()
        }
    }

    func updateTarget(_ index: Int, sets: Int, repMin: Int, repMax: Int, weightKg: Double?, restSeconds: Int) {
        mutate { $0.updateTarget(index, sets: sets, repMin: repMin, repMax: repMax, weightKg: weightKg, restSeconds: restSeconds) }
    }

    func updateCardioTarget(_ index: Int, _ target: CardioTarget?) {
        mutate { state in
            guard state.exercises.indices.contains(index) else { return }
            state.exercises[index].cardio = target
        }
        armCardio()
    }

    /// Adds a library exercise at the end, its sets at the last load logged for it.
    func add(_ library: LibraryExercise) {
        let weight = LiveHistory.lastWeight(library.id, in: TrainingStore.shared.sessions) ?? 0
        mutate { $0.add(library, weightKg: weight) }
    }

    /// "Cambiar ejercicio". `.always` also rewrites the program day, keeping the
    /// program exercise's id and targets with the new exercise.
    func swap(_ index: Int, to library: LibraryExercise, scope: EditScope) {
        guard state.exercises.indices.contains(index) else { return }
        let original = state.exercises[index]
        let weight = LiveHistory.lastWeight(library.id, in: TrainingStore.shared.sessions) ?? 0
        mutate { $0.swap(index, to: library, weightKg: weight) }
        if clock?.exerciseId == original.id, original.cardioLog == nil {
            clock = nil
            armCardio()
        }
        if scope == .always { persistSwap(programExerciseId: original.id, to: library.id) }
    }

    private func persistSwap(programExerciseId: String, to exerciseId: String) {
        let store = TrainingStore.shared
        guard let dayId = state.dayId, let day = store.program?.days.first(where: { $0.id == dayId }),
              day.exercises.contains(where: { $0.id == programExerciseId }) else { return }
        let exercises = day.exercises.map { ex in
            var input = ex.input
            if ex.id == programExerciseId {
                input.exerciseId = exerciseId
                // A hand-set load belongs to the old exercise.
                input.weightKg = nil
            }
            return input
        }
        Task {
            do { try await store.saveDay(dayId, scope: .always, exercises: exercises) } catch { PulsoModel.shared.handle(error) }
        }
    }

    // MARK: Cardio

    func cardioElapsed(_ exercise: LiveExercise, at now: Date = .now) -> TimeInterval {
        clock?.exerciseId == exercise.id ? clock?.elapsed(at: now) ?? 0 : 0
    }

    func cardioRunning(_ exercise: LiveExercise) -> Bool { clock?.exerciseId == exercise.id && clock?.running == true }

    /// Starts or resumes a block's stopwatch; another block's is dropped.
    func startCardio(_ index: Int) {
        guard state.exercises.indices.contains(index) else { return }
        let id = state.exercises[index].id
        var next = clock?.exerciseId == id ? clock ?? CardioClock(exerciseId: id) : CardioClock(exerciseId: id)
        next.start()
        clock = next
        if state.resting() { mutate { $0.skipRest() }; armRest() }
        armCardio()
    }

    func pauseCardio() {
        clock?.pause()
        armCardio()
    }

    /// Logs the block, stops its stopwatch and moves on.
    func finishCardio(_ index: Int, log: CardioLog) {
        guard state.exercises.indices.contains(index) else { return }
        let id = state.exercises[index].id
        mutate {
            $0.logCardio(index, log)
            $0.advanceIfDone()
        }
        if clock?.exerciseId == id { clock = nil }
        armCardio()
    }

    func reopenCardio(_ index: Int) { mutate { $0.clearCardioLog(index) } }

    // MARK: Rest

    private static let restNotification = "pulso.training.rest"

    /// One timer for the foreground haptic (and moving on once the exercise is
    /// done), one notification for a phone in the pocket.
    private func armRest() {
        restTask?.cancel()
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [Self.restNotification])
        guard let end = state.restEndsAt, end > .now else { return }

        restTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(end.timeIntervalSinceNow))
            guard !Task.isCancelled, let self else { return }
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            withAnimation(.snappy) { self.mutate { $0.advanceIfDone() } }
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

    // MARK: Cardio cues

    private static let cardioNotifications = (0..<48).map { "pulso.training.cardio.\($0)" }

    private var cardioIndex: Int? {
        if let clock, let index = state.exercises.firstIndex(where: { $0.id == clock.exerciseId }) { return index }
        guard let ex = state.focused, ex.isCardio, ex.cardioLog == nil else { return nil }
        return state.focus
    }

    /// While a block runs: a notification per phase change (they reach a locked
    /// phone) and, in the foreground, a haptic and a Live Activity update at each.
    private func armCardio() {
        cardioTask?.cancel()
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: Self.cardioNotifications)
        guard let clock, clock.running, let exercise = state.exercises.first(where: { $0.id == clock.exerciseId }) else { return }
        let cues = CardioCue.cues(exercise, elapsed: clock.elapsed())

        for (i, cue) in cues.enumerated() {
            let content = UNMutableNotificationContent()
            content.title = cue.title
            content.body = cue.body
            content.sound = .default
            content.interruptionLevel = .timeSensitive
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, cue.after), repeats: false)
            center.add(UNNotificationRequest(identifier: Self.cardioNotifications[i], content: content, trigger: trigger))
        }

        let start = Date.now
        cardioTask = Task { [weak self] in
            for cue in cues {
                try? await Task.sleep(for: .seconds(start.addingTimeInterval(cue.after).timeIntervalSinceNow))
                guard !Task.isCancelled, let self else { return }
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
                self.updateActivity()
            }
        }
    }

    // MARK: Sync with the engine

    private func schedulePush(after delay: Duration = .milliseconds(700)) {
        guard !closed else { return }
        pushTask?.cancel()
        pushTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            // Its own task: cancelling the next debounce must not cancel a request in flight.
            Task { await self?.push() }
        }
    }

    /// Sends the local copy on top of the engine's version. The answer's version is
    /// adopted and edits made meanwhile go out next; a conflict (the Coach changed it)
    /// adopts the engine's copy. Offline, the change waits for the next one or the foreground.
    func push() async {
        guard dirty, !pushing, !closed, let api = PulsoModel.shared.api else { return }
        pushing = true
        dirty = false
        let sent = state
        do {
            let saved = try await api.putLiveSession(sent, baseVersion: sent.version)
            pushing = false
            conflicts = 0
            guard !closed, saved.id == state.id else { return }
            var next = state
            next.version = saved.version
            next.updatedAt = saved.updatedAt
            next.threadId = saved.threadId ?? state.threadId
            state = next
        } catch let failure as PulsoAPI.Failure where failure.isConflict {
            pushing = false
            conflicts += 1
            // Keep trying on later changes, not in a tight loop.
            guard conflicts <= 3 else { return dirty = true }
            await fetch()
            return
        } catch {
            pushing = false
            dirty = true
            return
        }
        if dirty { schedulePush() }
    }

    /// Takes the engine's copy when it moved on (the Coach changed it). Unsent
    /// local changes go out first; a session the engine lost is given back.
    func pull() async {
        conflicts = 0
        await fetch()
    }

    private func fetch() async {
        guard !closed, !pushing, let api = PulsoModel.shared.api else { return }
        if dirty { return await push() }
        let remote: LiveSessionState?
        do { remote = try await api.liveSession() } catch { return }
        guard !closed, !pushing else { return }
        guard let remote, remote.version >= state.version else {
            dirty = true
            return await push()
        }
        if remote.id != state.id {
            // A session left over on the engine (say, discarded offline): the one in
            // progress is this phone's. Bounded so a confused engine can't loop us.
            guard conflicts < 3, (try? await api.deleteLiveSession()) != nil, !closed else { return }
            dirty = true
            return await push()
        }
        guard remote.version > state.version || remote.exercises != state.exercises else { return }
        adopt(remote)
    }

    /// Before the app is suspended: what the debounce hasn't sent yet.
    func flush() {
        pushTask?.cancel()
        Task { await push() }
    }

    private func adopt(_ remote: LiveSessionState) {
        let (merged, keptLocal) = LiveSessionState.merge(remote: remote, local: state)
        withAnimation(.snappy) { state = merged }
        if let clock, !state.exercises.contains(where: { $0.id == clock.exerciseId && $0.cardioLog == nil }) { self.clock = nil }
        armRest()
        armCardio()
        if keptLocal {
            dirty = true
            schedulePush()
        }
    }

    // MARK: Coach

    /// After the Coach changed the session: take the engine's copy, buzz, and
    /// offer "Deshacer" for a few seconds.
    func coachChanged() async {
        let before = state
        // A push in flight will meet the Coach's version (409) and adopt it; let it land first.
        for _ in 0..<100 where pushing { try? await Task.sleep(for: .milliseconds(100)) }
        await pull()
        guard state.exercises != before.exercises || state.focus != before.focus else { return }
        coachChanges += 1
        withAnimation(.snappy) { coachUndo = before }
        undoTask?.cancel()
        undoTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(6))
            guard !Task.isCancelled else { return }
            withAnimation(.snappy) { self?.coachUndo = nil }
        }
    }

    /// Puts the exercises back as they were before the Coach's change, on top of
    /// the engine's current version, keeping sets checked since.
    func undoCoach() {
        guard let before = coachUndo else { return }
        undoTask?.cancel()
        let restored = LiveSessionState.merge(remote: before, local: state).state
        withAnimation(.snappy) {
            coachUndo = nil
            mutate {
                $0.exercises = restored.exercises
                $0.setFocus(before.focus)
            }
        }
        armRest()
        armCardio()
    }

    func dismissUndo() {
        undoTask?.cancel()
        withAnimation(.snappy) { coachUndo = nil }
    }

    // MARK: Closing

    /// Stops the timers and the Live Activity, forgets the session on disk and
    /// (best effort) on the engine.
    func close() async {
        closed = true
        pushTask?.cancel()
        restTask?.cancel()
        cardioTask?.cancel()
        undoTask?.cancel()
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [Self.restNotification] + Self.cardioNotifications)
        TrainingFiles.remove(TrainingFiles.live)
        TrainingFiles.remove(TrainingFiles.cardio)
        if let api = PulsoModel.shared.api {
            Task { try? await api.deleteLiveSession() }
        }
        let final = ActivityContent(state: state.activityState(), staleDate: nil)
        for activity in Activity<TrainingActivityAttributes>.activities {
            await activity.end(final, dismissalPolicy: .immediate)
        }
        activity = nil
    }

    // MARK: Live Activity

    private func activityState() -> TrainingActivityAttributes.ContentState {
        let cardio = cardioIndex.map { ($0, CardioCue.status(state.exercises[$0], clock: clock, zones: TrainingStore.shared.hrZones)) }
        return state.activityState(cardio: cardio)
    }

    private func startActivity() {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let attributes = TrainingActivityAttributes(sessionName: state.name, startedAt: state.startedAt)
        activity = try? Activity.request(attributes: attributes, content: ActivityContent(state: activityState(), staleDate: nil))
    }

    private func updateActivity() {
        guard let activity else { return }
        let content = activityState()
        let stale = content.cardio?.phaseEndsAt ?? state.restEndsAt
        Task { await activity.update(ActivityContent(state: content, staleDate: stale)) }
    }
}

/// JSON files under Application Support/Training: the live session, its cardio
/// stopwatch and sessions waiting to upload.
enum TrainingFiles {
    static let directory = URL.applicationSupportDirectory.appending(path: "Training", directoryHint: .isDirectory)
    static let live = directory.appending(path: "live-session.json")
    static let cardio = directory.appending(path: "live-cardio.json")
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
