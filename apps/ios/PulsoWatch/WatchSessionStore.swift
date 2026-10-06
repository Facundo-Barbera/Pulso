import Foundation
import Observation
import WatchKit

/// The Watch's copy of the live session. It is the phone's last copy (`base`)
/// with the Watch's own edits not yet acknowledged replayed on top, so marking
/// a set works the same with the phone in the locker. Edits go to the phone as
/// soon as it's reachable and are kept (on disk, and queued by the system) until
/// it says it applied them. See WatchShared/SessionSync.swift.
@MainActor
@Observable
final class WatchSessionStore {
    static let shared = WatchSessionStore()

    /// What the screen shows: `base` plus the pending edits.
    private(set) var state: LiveSessionState?
    private(set) var plan: WatchPlan?
    private(set) var units: [String: WeightUnit] = [:]
    private(set) var hrZones: [HrZoneRange]?
    /// The phone was heard from lately.
    private(set) var phoneReachable = false

    private var base: LiveSessionState?
    private var pending: [WatchEdit] = []
    /// Sessions ended here or on the phone: a late copy of one isn't brought back.
    private var closed: [String] = []
    private var restAlarm: Task<Void, Never>?

    private struct Stored: Codable {
        var base: LiveSessionState?
        var pending: [WatchEdit]
        var plan: WatchPlan?
        var units: [String: WeightUnit]
        var closed: [String]
    }

    private static let file = URL.applicationSupportDirectory.appending(path: "watch-session.json")

    init() {
        if let data = try? Data(contentsOf: Self.file), let stored = try? JSONDecoder().decode(Stored.self, from: data) {
            base = stored.base
            pending = stored.pending
            plan = stored.plan
            units = stored.units
            closed = stored.closed
            rebuild()
        }
    }

    private func save() {
        let stored = Stored(base: base, pending: pending, plan: plan, units: units, closed: Array(closed.suffix(20)))
        try? FileManager.default.createDirectory(at: Self.file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? JSONEncoder().encode(stored).write(to: Self.file, options: .atomic)
    }

    /// Edits the phone hasn't acknowledged yet.
    var unsent: Int { pending.count }

    func unit(_ e: Int) -> WeightUnit {
        state.flatMap { $0.exercises[safe: e] }.flatMap { units[$0.exerciseId] } ?? .kg
    }

    // MARK: From the phone

    func listen() {
        WatchChannel.shared.receive = { [weak self] message in
            guard case .sync(let sync) = message else { return }
            self?.receive(sync)
        }
        WatchChannel.shared.reachable = { [weak self] in self?.resend() }
        WatchChannel.shared.activate()
    }

    private func receive(_ sync: WatchSync) {
        phoneReachable = true
        units = sync.units
        plan = sync.plan
        hrZones = sync.hrZones
        let applied = Set(sync.applied)
        pending.removeAll { applied.contains($0.id) }
        if let ended = sync.closed, ended.id == state?.id {
            close(ended.id, save: ended.saved)
        }
        if let state = sync.state {
            if !closed.contains(state.id) {
                // The phone's session wins over one started here that it never took.
                pending.removeAll { $0.sessionId != state.id }
                base = state
            }
        } else if !pending.contains(where: { if case .start = $0.change { true } else { false } }) {
            base = nil
        }
        rebuild()
        save()
    }

    /// `base` with what the phone hasn't acknowledged yet on top.
    private func rebuild() {
        var next = base
        for edit in pending {
            switch edit.change {
            case .start(let started): if next == nil || next?.id == started.id { next = started }
            case .finish: next = nil
            case .unit(let id, let unit): units[id] = unit
            default: if next?.id == edit.sessionId { next?.apply(edit.change) }
            }
        }
        state = next
        follow()
    }

    // MARK: To the phone

    private func send(_ edits: [WatchEdit]) {
        guard !edits.isEmpty else { return }
        // Now if the phone is there; queued by the system either way, so nothing is lost.
        WatchChannel.shared.send(.edits(edits))
        WatchChannel.shared.deliver(.edits(edits))
    }

    private func resend() {
        phoneReachable = true
        WatchChannel.shared.send(.edits(pending))
    }

    /// Changes the session here and tells the phone, set by set.
    private func perform(_ change: (inout LiveSessionState) -> Void) {
        guard var next = state else { return }
        let before = next
        change(&next)
        let now = Date()
        let edits = before.changes(to: next).map { WatchEdit(sessionId: next.id, at: now, change: $0) }
        guard !edits.isEmpty else { return }
        pending += edits
        state = next
        send(edits)
        save()
        follow()
    }

    // MARK: Actions

    /// "Hecho" on the set (or superset round) up now.
    func done() {
        guard let state, let current = state.current else { return }
        if let group = state.superset(of: current.exercise), let round = state.currentRound(group) {
            perform { $0.completeRound(group, round: round, unit: self.unit) }
        } else {
            perform { $0.toggle(exercise: current.exercise, set: current.set, unit: self.unit(current.exercise)) }
        }
        WKInterfaceDevice.current().play(.success)
    }

    func skipRest() { perform { $0.skipRest() } }

    /// A load in the exercise's unit, to the quarter.
    func setWeight(exercise e: Int, set s: Int, to value: Double) { perform { $0.setWeight(exercise: e, set: s, to: value, unit: self.unit(e)) } }

    func setReps(exercise e: Int, set s: Int, to reps: Int) { perform { $0.setReps(exercise: e, set: s, to: reps) } }

    /// The machine's unit (kg | lb), for every session: open sets move onto its steps.
    func setUnit(_ unit: WeightUnit, exercise e: Int) {
        guard let state, let id = state.exercises[safe: e]?.exerciseId, units[id] != unit else { return }
        units[id] = unit
        let edit = WatchEdit(sessionId: state.id, at: .now, change: .unit(exerciseId: id, unit: unit))
        pending.append(edit)
        send([edit])
        perform { state in
            for i in state.exercises.indices where state.exercises[i].exerciseId == id { state.snapOpenSets(exercise: i, to: unit) }
        }
        save()
    }

    func startCardio(_ index: Int) {
        perform { state in
            guard state.exercises.indices.contains(index) else { return }
            let id = state.exercises[index].id
            var clock = state.cardioClock?.exerciseId == id ? state.cardioClock ?? CardioClock(exerciseId: id) : CardioClock(exerciseId: id)
            clock.start()
            state.cardioClock = clock
            state.skipRest()
        }
    }

    func pauseCardio() { perform { $0.cardioClock?.pause() } }

    /// Logs the block with the time on its clock; distance and the rest can be added on the phone.
    func finishCardio(_ index: Int) {
        perform { state in
            guard state.exercises.indices.contains(index) else { return }
            let ex = state.exercises[index]
            let elapsed = state.cardioClock?.exerciseId == ex.id ? state.cardioClock?.elapsed() ?? 0 : 0
            state.logCardio(index, CardioLog(exerciseId: ex.exerciseId, durationSeconds: elapsed.rounded(), doneAt: LiveSessionState.ms(.now)))
            _ = state.advanceIfDone()
        }
    }

    /// Ends the session: here at once, on the phone when the edit reaches it.
    func finish(save: Bool) {
        guard let id = state?.id else { return }
        let edit = WatchEdit(sessionId: id, at: .now, change: .finish(save: save))
        pending.append(edit)
        send([edit])
        close(id, save: save)
        rebuild()
        self.save()
    }

    /// Starts the next day here; the phone takes it over when it hears of it.
    func start() {
        guard state == nil, let plan else { return }
        let started = LiveSessionState(day: plan.day, programId: plan.programId, suggestions: plan.suggestions)
        let edit = WatchEdit(sessionId: started.id, at: .now, change: .start(started))
        base = nil
        pending = [edit]
        send([edit])
        rebuild()
        save()
    }

    private func close(_ id: String, save: Bool) {
        closed.append(id)
        if base?.id == id { base = nil }
        restAlarm?.cancel()
        Task { await WorkoutManager.shared.finish(save: save) }
    }

    // MARK: Recording and rest

    /// The Watch records what the session is doing: the running cardio block's
    /// kind, else strength; nothing without a session.
    private func follow() {
        armRestAlarm()
        guard let state else { return }
        let stage = state.runningCardio.map { WorkoutStage.cardio($0.modality, speedKmh: $0.cardio?.speedKmh) } ?? .strength
        Task { await WorkoutManager.shared.follow(stage) }
    }

    /// A tap on the wrist when the rest is over.
    private func armRestAlarm() {
        restAlarm?.cancel()
        guard let end = state?.restEndsAt, end > .now else { return }
        restAlarm = Task {
            try? await Task.sleep(for: .seconds(end.timeIntervalSinceNow))
            guard !Task.isCancelled else { return }
            WKInterfaceDevice.current().play(.notification)
        }
    }
}
