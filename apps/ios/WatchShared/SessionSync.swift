import Foundation

// The live session kept the same on the phone and the Watch, with or without a
// connection between them. The phone owns it (it talks to the Mac and the
// Coach); the Watch keeps a full copy and runs the same `LiveSessionState`
// logic on it, so it works on its own. What the Watch changes travels as
// `WatchEdit`s — one per set, rest or cardio block, stamped with when it
// happened — queued until they reach the phone. The phone applies each unless
// it changed the same thing later (the latest wins; equal values never clash),
// then sends its copy back as a `WatchSync`, on which the Watch replays what
// the phone hasn't acknowledged yet.

/// Phone → Watch: the phone's copy of everything the Watch needs.
struct WatchSync: Codable, Sendable {
    /// The session in progress; nil when there is none.
    var state: LiveSessionState?
    /// The session that just ended, so the Watch ends its recording too.
    var closed: Closed?
    /// Ids of the Watch's edits the phone has applied (or dropped): the Watch stops replaying them.
    var applied: [String]
    /// Each exercise's unit, by library id.
    var units: [String: WeightUnit]
    /// What "Empezar" on the Watch starts when there's no session.
    var plan: WatchPlan?
    /// The person's heart-rate zones, for the zone the Watch shows.
    var hrZones: [HrZoneRange]? = nil

    struct Closed: Codable, Equatable, Sendable {
        var id: String
        var saved: Bool
    }
}

/// The next day as the phone would start it (the Coach's adjusted copy when one applies).
struct WatchPlan: Codable, Equatable, Sendable {
    var day: ProgramDay
    var programId: String?
    var suggestions: [String: LoadSuggestion]
}

/// Watch → phone: one change, when it happened.
struct WatchEdit: Codable, Identifiable, Sendable {
    var id: String = UUID().uuidString
    /// The session it belongs to.
    var sessionId: String
    var at: Date
    var change: Change

    enum Change: Codable, Equatable, Sendable {
        /// A set as the Watch has it now: done or not, load, reps, drops.
        case set(exerciseId: String, set: LiveSet)
        case rest(startedAt: Date?, endsAt: Date?)
        /// A cardio block's clock (nil: not running on it) and log.
        case cardio(exerciseId: String, clock: CardioClock?, log: CardioLog?)
        case finish(save: Bool)
        /// A session started on the Watch.
        case start(LiveSessionState)
        /// The unit of an exercise's machine (by library id): a setting, kept for every session.
        case unit(exerciseId: String, unit: WeightUnit)

        /// What two edits must share to be about the same thing.
        var key: String {
            switch self {
            case .set(_, let set): "set:\(set.id)"
            case .rest: "rest"
            case .cardio(let id, _, _): "cardio:\(id)"
            case .finish: "finish"
            case .start: "start"
            case .unit(let id, _): "unit:\(id)"
            }
        }
    }
}

extension WatchEdit {
    /// Whether it goes over a local change made at `stamp`: the latest wins
    /// (and equal values never clash, as applying them changes nothing).
    func wins(over stamp: Date?) -> Bool { stamp.map { $0 <= at } ?? true }
}

extension LiveSessionState {
    /// What changed from `self` to `new`, set by set: what the Watch sends, and
    /// what the phone stamps as its own changes. Structure (exercises added,
    /// removed, reordered) is the phone's alone and isn't listed.
    func changes(to new: LiveSessionState) -> [WatchEdit.Change] {
        var out: [WatchEdit.Change] = []
        var old: [String: LiveSet] = [:]
        for ex in exercises { for set in ex.sets { old[set.id] = set } }
        for ex in new.exercises {
            for set in ex.sets where old[set.id] != set { out.append(.set(exerciseId: ex.id, set: set)) }
        }
        if restStartedAt != new.restStartedAt || restEndsAt != new.restEndsAt {
            out.append(.rest(startedAt: new.restStartedAt, endsAt: new.restEndsAt))
        }
        for ex in new.exercises where ex.isCardio {
            let before = exercises.first { $0.id == ex.id }
            let clockBefore = cardioClock?.exerciseId == ex.id ? cardioClock : nil
            let clockNow = new.cardioClock?.exerciseId == ex.id ? new.cardioClock : nil
            if before?.cardioLog != ex.cardioLog || clockBefore != clockNow {
                out.append(.cardio(exerciseId: ex.id, clock: clockNow, log: ex.cardioLog))
            }
        }
        return out
    }

    /// Applies one of the Watch's changes. False when it names something the
    /// session no longer has (the Coach removed it meanwhile).
    @discardableResult
    mutating func apply(_ change: WatchEdit.Change) -> Bool {
        switch change {
        case .set(let exerciseId, let set):
            guard let e = exercises.firstIndex(where: { $0.id == exerciseId }),
                  let s = exercises[e].sets.firstIndex(where: { $0.id == set.id }) else { return false }
            exercises[e].sets[s] = set
            if set.done { exercises[e].skipped = false }
        case .rest(let startedAt, let endsAt):
            restStartedAt = startedAt
            restEndsAt = endsAt
        case .cardio(let exerciseId, let clock, let log):
            guard let e = exercises.firstIndex(where: { $0.id == exerciseId }) else { return false }
            exercises[e].cardioLog = log
            if let clock {
                cardioClock = clock
            } else if cardioClock?.exerciseId == exerciseId {
                cardioClock = nil
            }
        case .finish, .start, .unit:
            return false
        }
        return true
    }

    /// The exercise whose cardio clock is running, if any.
    var runningCardio: LiveExercise? {
        guard let clock = cardioClock, clock.running else { return nil }
        return exercises.first { $0.id == clock.exerciseId }
    }
}
