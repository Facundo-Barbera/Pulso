import Foundation

// The session in progress as pure values. The JSON is exactly the contract's
// `LiveSession` (epoch-ms times, explicit nulls), both on disk and to the engine,
// so the Coach can read and change it. Dates are `Date` in Swift.

/// One set. `doneAt` is nil until checked off. `weightKg`/`reps` are the top
/// segment; `drops` the lighter ones the load dropped to, to finish it.
struct LiveSet: Identifiable, Hashable {
    var id: String = LiveSessionState.newId()
    var weightKg: Double
    var reps: Int
    var rpe: Double? = nil
    var doneAt: Date? = nil
    var drops: [SetSegment] = []

    var done: Bool { doneAt != nil }
    var top: SetSegment { SetSegment(weightKg: weightKg, reps: reps) }
    /// Every segment, top first: the contract's `segments`.
    var segments: [SetSegment] { [top] + drops }
    var volumeKg: Double { segments.reduce(0) { $0 + $1.weightKg * Double($1.reps) } }
}

/// A cardio block the Coach ended early ("terminar antes"): done, not skipped.
struct CutShort: Hashable {
    var at: Date
    var reason: String? = nil
}

/// One exercise of the session: the program's prescription as changed for today.
struct LiveExercise: Identifiable, Hashable {
    /// The `ProgramExercise.id` it came from, or a fresh id for one added today.
    var id: String
    var exerciseId: String
    var name: String
    var equipment: String
    /// "compound", "isolation" or "cardio".
    var kind: String
    var modality: String? = nil
    var repMin: Int
    var repMax: Int
    var targetRpe: Double? = nil
    var targetRir: Int? = nil
    var restSeconds: Int
    var notes: String? = nil
    /// The double-progression reason from the engine, shown under the name.
    var hint: String? = nil
    /// Empty for cardio.
    var sets: [LiveSet]
    var cardio: CardioTarget? = nil
    /// Filled when a cardio block ends.
    var cardioLog: CardioLog? = nil
    /// Set when the Coach ended the block early; its log is the time done until then.
    var cutShort: CutShort? = nil
    /// Passed over today; stays in the list, greyed.
    var skipped = false
    /// Consecutive exercises sharing it are a superset: a set of each, then the rest.
    var supersetId: String? = nil

    var isCardio: Bool { kind == "cardio" }
    var weightStep: Double { Equipment.weightStep(equipment) }
    var done: Bool { isCardio ? cardioLog != nil : sets.allSatisfy(\.done) }
    /// Something was logged, so removing it would lose history.
    var hasDoneWork: Bool { cardioLog != nil || sets.contains(where: \.done) }
    /// Neither done nor skipped: where focus moves next.
    var pending: Bool { !skipped && !done }

    /// "3 series de 6 a 8 repeticiones", or the cardio target.
    var prescription: String {
        isCardio ? cardio?.summary ?? "Cardio" : TrainingText.target(sets: sets.count, repMin: repMin, repMax: repMax)
    }

    /// The load of the next set to do (or the last one).
    var workingWeight: Double { (sets.first { !$0.done } ?? sets.last)?.weightKg ?? 0 }

    /// "4 series de 6 a 8 repeticiones con 80 kg", the load in `unit`.
    func target(_ unit: WeightUnit = .kg) -> String {
        if isCardio || workingWeight <= 0 { return prescription }
        return "\(prescription) con \(unit.format(unit.snapKg(workingWeight)))"
    }

    /// "3 series de 8 a 10 · descanso 2:30", the target on one line.
    var targetLine: String {
        let sets = TrainingText.short(sets: self.sets.count, repMin: repMin, repMax: repMax)
        return restSeconds > 0 ? "\(sets) · descanso \(TrainingFormat.rest(restSeconds))" : sets
    }

    /// "Acaba cada serie pudiendo hacer 2 más"; nil without an effort target.
    var effortAdvice: String? { isCardio ? nil : TrainingText.effort(rir: targetRir, rpe: targetRpe) }

    /// "Acaba cada serie pudiendo hacer 2 más. Descansa 3 min.", the one line of advice.
    var guidance: String? {
        guard !isCardio else { return nil }
        let parts = [effortAdvice, restSeconds > 0 ? "Descansa \(TrainingText.rest(restSeconds))" : nil].compactMap(\.self)
        return parts.isEmpty ? nil : parts.joined(separator: ". ") + "."
    }

    /// "12 de 20 min" for a block ended early: done against planned.
    var cutShortAmount: String? {
        guard cutShort != nil, let log = cardioLog else { return nil }
        let done = Int((log.durationSeconds / 60).rounded())
        guard let planned = cardio?.totalSeconds.map({ Int(($0 / 60).rounded()) }), planned > 0 else { return "\(done) min" }
        return "\(done) de \(planned) min"
    }

    /// "Cinta · 12 de 20 min"
    var cutShortSummary: String? { cutShortAmount.map { "\(name) · \($0)" } }

    /// The effort rated for this exercise (on its sets), 1–10.
    var effort: Int? { sets.last { $0.done && $0.rpe != nil }?.rpe.map { Int($0.rounded()) } }

    /// A new exercise from the library, its sets prefilled with `weightKg`.
    static func fresh(_ library: LibraryExercise, id: String = LiveSessionState.newId(), weightKg: Double, sets: Int = 3, repMin: Int = 8, repMax: Int = 12, restSeconds: Int = 90) -> LiveExercise {
        let cardio = library.isCardio
        return LiveExercise(
            id: id,
            exerciseId: library.id,
            name: library.name,
            equipment: library.equipment,
            kind: library.kind,
            modality: library.modality,
            repMin: cardio ? 1 : repMin,
            repMax: cardio ? 1 : repMax,
            restSeconds: cardio ? 0 : restSeconds,
            sets: cardio ? [] : (0..<max(1, sets)).map { _ in LiveSet(weightKg: weightKg, reps: repMin) }
        )
    }
}

/// A session in progress: pure value logic, persisted as JSON so a killed app
/// resumes where it was. `LiveSession` adds timers, sync and side effects.
struct LiveSessionState: Hashable {
    var id: String
    var programId: String?
    var dayId: String?
    var name: String
    var startedAt: Date
    var exercises: [LiveExercise]
    /// Index of the exercise on screen.
    var focus = 0
    var restStartedAt: Date?
    var restEndsAt: Date?
    /// The stopwatch of the cardio block being done. This phone's: synced so the
    /// engine (and the Coach's "terminar antes") can time the block too.
    var cardioClock: CardioClock?
    /// The engine's version this copy is based on; it bumps it on every write.
    var version = 0
    var updatedAt: Date
    var threadId: String?

    static func newId() -> String { UUID().uuidString.lowercased() }

    init(id: String = LiveSessionState.newId(), programId: String?, dayId: String?, name: String, startedAt: Date, exercises: [LiveExercise], focus: Int = 0,
         restStartedAt: Date? = nil, restEndsAt: Date? = nil, cardioClock: CardioClock? = nil, version: Int = 0, updatedAt: Date? = nil, threadId: String? = nil) {
        self.id = id
        self.programId = programId
        self.dayId = dayId
        self.name = name
        self.startedAt = startedAt
        self.exercises = exercises
        self.focus = focus
        self.restStartedAt = restStartedAt
        self.restEndsAt = restEndsAt
        self.cardioClock = cardioClock
        self.version = version
        self.updatedAt = updatedAt ?? startedAt
        self.threadId = threadId
    }

    /// Sets prefilled from the suggested load (else the hand-set one, else 0 kg).
    init(day: ProgramDay, programId: String?, suggestions: [String: LoadSuggestion], now: Date = .now) {
        let exercises = day.exercises.map { ex in
            let suggestion = suggestions[ex.id]
            let weight = suggestion?.weightKg ?? ex.weightKg ?? 0
            let reps = suggestion?.reps ?? ex.repMin
            return LiveExercise(
                id: ex.id,
                exerciseId: ex.exerciseId,
                name: ex.exerciseName,
                equipment: ex.equipment,
                kind: ex.kind ?? "compound",
                modality: ex.modality,
                repMin: ex.repMin,
                repMax: ex.repMax,
                targetRpe: ex.targetRpe,
                targetRir: ex.targetRir,
                restSeconds: ex.restSeconds,
                notes: ex.notes,
                hint: ex.isCardio ? nil : suggestion?.reason,
                sets: ex.isCardio ? [] : (0..<ex.sets).map { _ in LiveSet(weightKg: weight, reps: reps) },
                cardio: ex.cardio,
                supersetId: ex.supersetId
            )
        }
        self.init(programId: programId, dayId: day.id, name: day.name, startedAt: now, exercises: exercises, updatedAt: now)
    }

    // MARK: Progress

    /// Sets of the exercises still planned, plus any done in a skipped one.
    var setsTotal: Int { exercises.reduce(0) { $0 + ($1.skipped ? $1.sets.filter(\.done).count : $1.sets.count) } }
    var setsDone: Int { exercises.reduce(0) { $0 + $1.sets.filter(\.done).count } }
    var volumeKg: Double { exercises.flatMap(\.sets).filter(\.done).reduce(0) { $0 + $1.volumeKg } }
    var cardioLogs: [CardioLog] { exercises.compactMap(\.cardioLog) }
    /// Anything worth saving: a set or a cardio block.
    var hasWork: Bool { setsDone > 0 || !cardioLogs.isEmpty }
    var allDone: Bool { !exercises.contains(where: \.pending) }
    /// Exercises passed over today with nothing logged, by name.
    var skippedNames: [String] { exercises.filter { $0.skipped && !$0.hasDoneWork }.map(\.name) }

    var focused: LiveExercise? { exercises.indices.contains(focus) ? exercises[focus] : nil }

    /// The first strength set not yet done, in order, skipping passed-over
    /// exercises. In a superset, the member furthest behind goes next.
    var current: (exercise: Int, set: Int)? {
        var e = 0
        while e < exercises.count {
            if let group = superset(of: e) {
                if let next = nextInSuperset(group) { return next }
                e = group.upperBound
                continue
            }
            if !exercises[e].skipped, let s = exercises[e].sets.firstIndex(where: { !$0.done }) { return (e, s) }
            e += 1
        }
        return nil
    }

    // MARK: Supersets

    func superset(of e: Int) -> Range<Int>? { Superset.group(of: e, in: exercises.map(\.supersetId)) }

    /// The member with the fewest sets done among those with sets left; the earliest on a tie.
    func nextInSuperset(_ group: Range<Int>) -> (exercise: Int, set: Int)? {
        let open = group.filter { !exercises[$0].skipped && exercises[$0].sets.contains { !$0.done } }
        guard let e = open.min(by: { exercises[$0].sets.count(where: \.done) < exercises[$1].sets.count(where: \.done) }),
              let s = exercises[e].sets.firstIndex(where: { !$0.done }) else { return nil }
        return (e, s)
    }

    mutating func normalizeSupersets() {
        let ids = Superset.normalize(exercises.map(\.supersetId), cardio: exercises.map(\.isCardio))
        for e in exercises.indices { exercises[e].supersetId = ids[e] }
    }

    /// The next exercise to do after `index`, wrapping to earlier ones left behind.
    func nextPending(after index: Int) -> Int? {
        let order = Array(exercises.indices.dropFirst(index + 1)) + Array(exercises.indices.prefix(max(0, index)))
        return order.first { exercises[$0].pending }
    }

    func resting(at now: Date = .now) -> Bool { restEndsAt.map { $0 > now } ?? false }

    /// The rest ran out with no change saved after it: the app was gone (killed)
    /// when its timer would have moved on, so a resumed session does that now.
    func restEndedWhileAway(at now: Date = .now) -> Bool {
        guard let restEndsAt else { return false }
        return restEndsAt <= now && restEndsAt > updatedAt
    }

    // MARK: Sets

    /// Checks a set off (starting its rest) or un-checks it. Checking carries
    /// the set's weight to the later sets not done yet, so a changed load
    /// sticks for the rest of the exercise.
    /// The load logged is the one shown: on the exercise's `unit` steps (70 lb, not 31.75 kg read as 31,8).
    mutating func toggle(exercise e: Int, set s: Int, now: Date = .now, unit: WeightUnit = .kg) {
        guard exercises.indices.contains(e), exercises[e].sets.indices.contains(s) else { return }
        if exercises[e].sets[s].done {
            exercises[e].sets[s].doneAt = nil
            restStartedAt = nil
            restEndsAt = nil
            return
        }
        exercises[e].sets[s].doneAt = now
        exercises[e].sets[s].weightKg = unit.snapKg(exercises[e].sets[s].weightKg)
        exercises[e].sets[s].drops = exercises[e].sets[s].drops.map { SetSegment(weightKg: unit.snapKg($0.weightKg), reps: $0.reps) }
        exercises[e].skipped = false
        let weight = exercises[e].sets[s].weightKg
        for later in exercises[e].sets.indices where later > s && !exercises[e].sets[later].done {
            exercises[e].sets[later].weightKg = weight
        }
        // A superset goes straight to the partner still behind; the rest comes after the round.
        if let group = superset(of: e), let next = nextInSuperset(group) {
            focus = next.exercise
            if exercises[next.exercise].sets.count(where: \.done) < exercises[e].sets.count(where: \.done) {
                restStartedAt = nil
                restEndsAt = nil
                return
            }
        }
        startRest(after: e, now: now)
    }

    /// "Registrar todas": checks off every set left as it stands, in order, with
    /// one rest after the last.
    mutating func completeAll(exercise e: Int, now: Date = .now, unit: WeightUnit = .kg) {
        guard exercises.indices.contains(e) else { return }
        let open = exercises[e].sets.indices.filter { !exercises[e].sets[$0].done }
        guard !open.isEmpty else { return }
        // A millisecond apart, so the saved order is the list's order.
        for (i, s) in open.enumerated() {
            exercises[e].sets[s].doneAt = now.addingTimeInterval(Double(i) / 1000)
            exercises[e].sets[s].weightKg = unit.snapKg(exercises[e].sets[s].weightKg)
        }
        exercises[e].skipped = false
        startRest(after: e, now: now)
    }

    /// The rest after a set of `e`; none once the whole session is done.
    private mutating func startRest(after e: Int, now: Date) {
        if current == nil && allDone {
            restStartedAt = nil
            restEndsAt = nil
        } else {
            restStartedAt = now
            restEndsAt = now.addingTimeInterval(TimeInterval(exercises[e].restSeconds))
        }
    }

    /// −/+ one step of the equipment in `unit` (5 lb, 2.5 kg; less on light loads), stored as its exact kg.
    mutating func stepWeight(exercise e: Int, set s: Int, up: Bool, unit: WeightUnit = .kg) {
        guard has(e, s) else { return }
        let value = unit.snap(exercises[e].sets[s].weightKg)
        exercises[e].sets[s].weightKg = unit.fromUnit(up ? unit.stepUp(value) : unit.stepDown(value))
    }

    mutating func adjustReps(exercise e: Int, set s: Int, by delta: Int) {
        guard has(e, s) else { return }
        exercises[e].sets[s].reps = max(0, exercises[e].sets[s].reps + delta)
    }

    /// Typed in `unit`: any load to the quarter (plates aren't always on the step),
    /// never negative, kept as its exact kg so 45 lb reads 45 lb again.
    mutating func setWeight(exercise e: Int, set s: Int, to value: Double, unit: WeightUnit = .kg) {
        guard has(e, s) else { return }
        exercises[e].sets[s].weightKg = unit.fromUnit(max(0, (value * 4).rounded() / 4))
    }

    /// The exercise's unit changed: its open sets move onto the new unit's steps; done ones keep what was lifted.
    mutating func snapOpenSets(exercise e: Int, to unit: WeightUnit) {
        guard exercises.indices.contains(e) else { return }
        for s in exercises[e].sets.indices where !exercises[e].sets[s].done {
            exercises[e].sets[s].weightKg = unit.snapKg(exercises[e].sets[s].weightKg)
        }
    }

    mutating func setReps(exercise e: Int, set s: Int, to reps: Int) {
        guard has(e, s) else { return }
        exercises[e].sets[s].reps = max(0, reps)
    }

    /// The effort felt on the whole exercise, 1–10 (nil clears), kept on each done set.
    mutating func setEffort(exercise e: Int, to value: Int?) {
        guard exercises.indices.contains(e) else { return }
        for s in exercises[e].sets.indices where exercises[e].sets[s].done {
            exercises[e].sets[s].rpe = value.map { Double(min(max($0, EffortLevel.range.lowerBound), EffortLevel.range.upperBound)) }
        }
    }

    /// One more set, copying the last one's load and reps (or the target's bottom).
    mutating func addSet(exercise e: Int) {
        guard exercises.indices.contains(e), !exercises[e].isCardio else { return }
        let last = exercises[e].sets.last
        exercises[e].sets.append(LiveSet(weightKg: last?.weightKg ?? 0, reps: last?.reps ?? exercises[e].repMin))
        exercises[e].skipped = false
    }

    /// Only a set not done yet: un-check it first to drop a logged one.
    mutating func removeSet(exercise e: Int, set s: Int) {
        guard has(e, s), !exercises[e].sets[s].done else { return }
        exercises[e].sets.remove(at: s)
    }

    private func has(_ e: Int, _ s: Int) -> Bool {
        exercises.indices.contains(e) && exercises[e].sets.indices.contains(s)
    }

    private func has(_ e: Int, _ s: Int, drop d: Int) -> Bool {
        has(e, s) && exercises[e].sets[s].drops.indices.contains(d)
    }

    // MARK: Drops (the load lowered mid-set)

    /// One more segment on a set, on the unit's steps. The rest starts after the
    /// last segment: one added to the set just done, while resting, restarts it.
    mutating func addDrop(exercise e: Int, set s: Int, _ drop: SetSegment, now: Date = .now, unit: WeightUnit = .kg) {
        guard has(e, s), !exercises[e].isCardio else { return }
        exercises[e].sets[s].drops.append(SetSegment(weightKg: unit.snapKg(max(0, drop.weightKg)), reps: max(0, drop.reps)))
        guard let doneAt = exercises[e].sets[s].doneAt, resting(at: now) else { return }
        let latest = exercises.flatMap(\.sets).compactMap(\.doneAt).max()
        if doneAt == latest { startRest(after: e, now: now) }
    }

    /// The suggested next segment for a set: about 15 % lighter, for the reps still missing.
    func nextDrop(exercise e: Int, set s: Int, unit: WeightUnit = .kg) -> SetSegment? {
        guard has(e, s) else { return nil }
        let set = exercises[e].sets[s]
        return SetDrop.next(top: set.top, drops: set.drops, repMin: exercises[e].repMin, unit: unit)
    }

    mutating func removeDrop(exercise e: Int, set s: Int, drop d: Int) {
        guard has(e, s, drop: d) else { return }
        exercises[e].sets[s].drops.remove(at: d)
    }

    mutating func stepDropWeight(exercise e: Int, set s: Int, drop d: Int, up: Bool, unit: WeightUnit = .kg) {
        guard has(e, s, drop: d) else { return }
        let value = unit.snap(exercises[e].sets[s].drops[d].weightKg)
        exercises[e].sets[s].drops[d].weightKg = unit.fromUnit(up ? unit.stepUp(value) : unit.stepDown(value))
    }

    /// Typed in `unit`, to the quarter, kept as its exact kg.
    mutating func setDropWeight(exercise e: Int, set s: Int, drop d: Int, to value: Double, unit: WeightUnit = .kg) {
        guard has(e, s, drop: d) else { return }
        exercises[e].sets[s].drops[d].weightKg = unit.fromUnit(max(0, (value * 4).rounded() / 4))
    }

    /// A drop keeps at least one rep: to get rid of it, remove it.
    mutating func setDropReps(exercise e: Int, set s: Int, drop d: Int, to reps: Int) {
        guard has(e, s, drop: d) else { return }
        exercises[e].sets[s].drops[d].reps = max(1, reps)
    }

    // MARK: Rest

    /// +15 s or −15 s. Cut to nothing, the rest ends.
    mutating func extendRest(by seconds: TimeInterval, now: Date = .now) {
        guard let end = restEndsAt, end > now else { return }
        let new = end.addingTimeInterval(seconds)
        if new > now { restEndsAt = new } else { skipRest() }
    }

    mutating func skipRest() {
        restStartedAt = nil
        restEndsAt = nil
    }

    // MARK: Focus

    mutating func setFocus(_ index: Int) {
        guard !exercises.isEmpty else { return focus = 0 }
        focus = min(max(index, 0), exercises.count - 1)
    }

    /// After the focused exercise is finished (or skipped), moves on to the next
    /// one still to do. Returns whether focus moved.
    @discardableResult
    mutating func advanceIfDone() -> Bool {
        guard let ex = focused, !ex.pending, let next = nextPending(after: focus) else { return false }
        focus = next
        return true
    }

    // MARK: Editing (solo hoy)

    /// Drag to reorder; the exercise on screen stays on screen.
    mutating func move(fromOffsets source: IndexSet, toOffset destination: Int) {
        let focusedId = focused?.id
        // `List.onMove` semantics: `destination` counts the moved rows still in place.
        let moving = source.filter(exercises.indices.contains).map { exercises[$0] }
        var kept = exercises.enumerated().filter { !source.contains($0.offset) }.map(\.element)
        kept.insert(contentsOf: moving, at: min(kept.count, max(0, destination - source.count { $0 < destination })))
        exercises = kept
        normalizeSupersets()
        if let focusedId, let index = exercises.firstIndex(where: { $0.id == focusedId }) { focus = index }
    }

    /// Appends an exercise and returns its index.
    @discardableResult
    mutating func add(_ library: LibraryExercise, weightKg: Double) -> Int {
        exercises.append(.fresh(library, weightKg: weightKg))
        return exercises.count - 1
    }

    /// Only an exercise with nothing logged; skip the others.
    mutating func remove(at index: Int) {
        guard exercises.indices.contains(index), !exercises[index].hasDoneWork else { return }
        let focusedId = focused?.id
        exercises.remove(at: index)
        normalizeSupersets()
        if let focusedId, let kept = exercises.firstIndex(where: { $0.id == focusedId }) {
            focus = kept
        } else {
            setFocus(min(index, exercises.count - 1))
        }
        stopWhatEnded()
    }

    /// Skipping the exercise on screen moves on to the next one; a skipped block's clock stops.
    mutating func setSkipped(_ index: Int, _ skipped: Bool) {
        guard exercises.indices.contains(index) else { return }
        exercises[index].skipped = skipped
        if skipped && index == focus { advanceIfDone() }
        stopWhatEnded()
    }

    /// After a skip, removal, swap or log (here or by the Coach): a clock only
    /// times a cardio block still to do, and a rest only runs while something is left.
    mutating func stopWhatEnded() {
        if let clock = cardioClock, !exercises.contains(where: { $0.id == clock.exerciseId && $0.isCardio && !$0.skipped && $0.cardioLog == nil }) {
            cardioClock = nil
        }
        if restEndsAt != nil, current == nil, allDone { skipRest() }
    }

    /// New targets for today. Set count can't drop below the sets done; the load
    /// and the rep range apply to the sets not done yet.
    mutating func updateTarget(_ index: Int, sets count: Int, repMin: Int, repMax: Int, weightKg: Double?, restSeconds: Int) {
        guard exercises.indices.contains(index) else { return }
        var ex = exercises[index]
        ex.repMin = max(1, repMin)
        ex.repMax = max(ex.repMin, repMax)
        ex.restSeconds = max(0, restSeconds)
        for s in ex.sets.indices where !ex.sets[s].done {
            if let weightKg { ex.sets[s].weightKg = max(0, weightKg) }
            ex.sets[s].reps = min(max(ex.sets[s].reps, ex.repMin), ex.repMax)
        }
        if !ex.isCardio {
            let target = max(count, ex.sets.filter(\.done).count, 1)
            while ex.sets.count < target {
                let last = ex.sets.last { !$0.done } ?? ex.sets.last
                ex.sets.append(LiveSet(weightKg: weightKg ?? last?.weightKg ?? 0, reps: last.map { min(max($0.reps, ex.repMin), ex.repMax) } ?? ex.repMin))
            }
            while ex.sets.count > target, let last = ex.sets.lastIndex(where: { !$0.done }) {
                ex.sets.remove(at: last)
            }
        }
        exercises[index] = ex
    }

    /// "Cambiar ejercicio". With nothing logged it is replaced in place (keeping its
    /// id and targets). Otherwise the logged sets stay with the exercise actually
    /// performed and the new one goes right after it with the sets left.
    /// Returns the index of the new exercise, which gets focus.
    @discardableResult
    mutating func swap(_ index: Int, to library: LibraryExercise, weightKg: Double) -> Int {
        guard exercises.indices.contains(index) else { return focus }
        // Another machine: the old one's stopwatch doesn't carry over.
        if cardioClock?.exerciseId == exercises[index].id { cardioClock = nil }
        var old = exercises[index]
        let left = old.sets.filter { !$0.done }
        let reps = left.first?.reps ?? old.repMin
        var new = old
        new.exerciseId = library.id
        new.name = library.name
        new.equipment = library.equipment
        new.kind = library.kind
        new.modality = library.modality
        new.hint = nil
        new.notes = nil
        new.cardioLog = nil
        new.skipped = false
        if library.isCardio {
            new.sets = []
            new.cardio = old.isCardio ? old.cardio : nil
            new.restSeconds = 0
        } else {
            let count = old.isCardio ? 3 : max(1, old.hasDoneWork ? left.count : old.sets.count)
            if old.isCardio {
                new.repMin = 8
                new.repMax = 12
                new.restSeconds = 90
                new.cardio = nil
            }
            new.sets = (0..<count).map { _ in LiveSet(weightKg: weightKg, reps: old.isCardio ? new.repMin : reps) }
        }

        if !old.hasDoneWork {
            exercises[index] = new
            focus = index
            return index
        }
        old.sets = old.sets.filter(\.done)
        exercises[index] = old
        new.id = Self.newId()
        exercises.insert(new, at: index + 1)
        focus = index + 1
        return index + 1
    }

    // MARK: Cardio

    /// Logs a block and stops its clock.
    mutating func logCardio(_ index: Int, _ log: CardioLog) {
        guard exercises.indices.contains(index), exercises[index].isCardio else { return }
        exercises[index].cardioLog = log.sanitized
        exercises[index].skipped = false
        stopWhatEnded()
    }

    mutating func clearCardioLog(_ index: Int) {
        guard exercises.indices.contains(index) else { return }
        exercises[index].cardioLog = nil
    }

    // MARK: Merging the engine's copy

    /// The engine's copy, keeping what this phone logged that it doesn't have yet:
    /// checked sets, cardio logs, the rest timer and the exercise on screen.
    /// `keptLocal` says the result differs from `remote`, so it must be pushed back.
    static func merge(remote: LiveSessionState, local: LiveSessionState) -> (state: LiveSessionState, keptLocal: Bool) {
        var merged = remote
        var kept = false
        let localExercises = Dictionary(local.exercises.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let localSets = Dictionary(local.exercises.flatMap(\.sets).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for e in merged.exercises.indices {
            for s in merged.exercises[e].sets.indices {
                let id = merged.exercises[e].sets[s].id
                if merged.exercises[e].sets[s].doneAt == nil, let mine = localSets[id], mine.done {
                    merged.exercises[e].sets[s] = mine
                    kept = true
                } else if merged.exercises[e].sets[s].drops.isEmpty, let mine = localSets[id], !mine.drops.isEmpty {
                    // A drop logged here that the engine's copy doesn't have yet.
                    merged.exercises[e].sets[s].drops = mine.drops
                    kept = true
                }
            }
            if merged.exercises[e].cardioLog == nil, let log = localExercises[merged.exercises[e].id]?.cardioLog {
                merged.exercises[e].cardioLog = log
                kept = true
            }
        }
        // The Coach ended a block early ("terminar antes"): it is done, timed up to then by this
        // phone's clock when it was timing it (more precise than the engine's synced copy),
        // else by the synced clock, keeping what was typed for the block.
        for e in merged.exercises.indices {
            guard let cut = merged.exercises[e].cutShort else { continue }
            let ex = merged.exercises[e]
            let mine = local.cardioClock?.exerciseId == ex.id ? local.cardioClock : nil
            let synced = remote.cardioClock?.exerciseId == ex.id ? remote.cardioClock : nil
            merged.exercises[e].skipped = false
            guard mine != nil || ex.cardioLog == nil else { continue }
            let typed = localExercises[ex.id]?.cardioLog ?? ex.cardioLog
            let seconds = (mine ?? synced)?.elapsed(at: cut.at) ?? 0
            merged.exercises[e].cardioLog = CardioLog(
                exerciseId: ex.exerciseId, durationSeconds: seconds.rounded(), distanceKm: typed?.distanceKm, level: typed?.level,
                inclinePercent: typed?.inclinePercent, avgHr: typed?.avgHr, kcal: typed?.kcal, doneAt: Self.ms(cut.at)
            )
            if merged.exercises[e] != ex { kept = true }
        }
        merged.cardioClock = local.cardioClock
        merged.restStartedAt = local.restStartedAt
        merged.restEndsAt = local.restEndsAt
        if let focusedId = local.focused?.id, let index = merged.exercises.firstIndex(where: { $0.id == focusedId }) {
            merged.focus = index
        } else {
            merged.setFocus(remote.focus)
        }
        // Skipped from elsewhere (the Coach) while on screen: move on to one still to do.
        if merged.focused?.skipped == true, local.focused?.skipped != true { merged.advanceIfDone() }
        merged.stopWhatEnded()
        if merged.cardioClock != remote.cardioClock { kept = true }
        return (merged, kept)
    }

    /// "Deshacer" after the Coach's change: the exercises as they were, keeping what was
    /// logged since. A block it ended early runs on, as if never cut: its clock kept counting.
    static func undoingCoach(before: LiveSessionState, current: LiveSessionState) -> LiveSessionState {
        var restored = merge(remote: before, local: current).state
        if let clock = before.cardioClock, current.exercises.first(where: { $0.id == clock.exerciseId })?.cutShort != nil,
           let e = restored.exercises.firstIndex(where: { $0.id == clock.exerciseId }) {
            restored.exercises[e].cardioLog = nil
            restored.exercises[e].cutShort = nil
            restored.cardioClock = clock
        }
        return restored
    }

    /// The undo toast after the Coach's change: what it skipped by name, else a plain line.
    /// "El Coach saltó Remo en máquina", "… saltó Remo y Curl", "… saltó Remo, Curl y 2 más".
    static func coachSummary(before: LiveSessionState, after: LiveSessionState) -> String {
        let was = Set(before.exercises.filter(\.skipped).map(\.id))
        let names = after.exercises.filter { $0.skipped && !was.contains($0.id) }.map(\.name)
        switch names.count {
        case 0: return "El Coach cambió la sesión"
        case 1...2: return "El Coach saltó \(TrainingText.list(names))"
        default: return "El Coach saltó \(names[0]), \(names[1]) y \(names.count - 2) más"
        }
    }

    // MARK: Output

    /// What the engine stores: done sets only, numbered per exercise in the order
    /// they were done, and the cardio blocks in session order.
    func session(endedAt: Date) -> TrainingSession {
        let sets = exercises
            .flatMap { ex in ex.sets.compactMap { set in set.doneAt.map { (ex.exerciseId, set, $0) } } }
            .sorted { $0.2 < $1.2 }
        var counts: [String: Int] = [:]
        let logs = sets.map { exerciseId, set, doneAt in
            let index = counts[exerciseId, default: 0]
            counts[exerciseId] = index + 1
            return SetLog(exerciseId: exerciseId, setIndex: index, weightKg: set.weightKg, reps: set.reps, rpe: set.rpe, doneAt: Self.ms(doneAt), segments: set.segments)
        }
        let cardio = cardioLogs
        return TrainingSession(
            id: id, programId: programId, dayId: dayId, name: name,
            startedAt: Self.ms(startedAt), endedAt: Self.ms(endedAt), notes: nil, sets: logs,
            // `cardioMinutes` is the engine's to compute (it is not in `SessionInput`).
            cardio: cardio
        ).sanitized
    }

    /// The lock screen: the cardio block `cardio` names when given, else the next set.
    func activityState(now: Date = .now, cardio: (index: Int, status: TrainingActivityAttributes.ContentState.Cardio)? = nil,
                       unit: (String) -> WeightUnit = { _ in .kg }) -> TrainingActivityAttributes.ContentState {
        let resting = resting(at: now)
        if let cardio, exercises.indices.contains(cardio.index) {
            let ex = exercises[cardio.index]
            return .init(exerciseName: ex.name, setLabel: cardio.status.detail, target: ex.cardio?.summary ?? "", setsDone: setsDone, setsTotal: setsTotal, cardio: cardio.status)
        }
        guard let (e, s) = current else {
            return .init(exerciseName: "Sesión completa", setLabel: "Todas las series hechas", target: "", setsDone: setsDone, setsTotal: setsTotal)
        }
        let ex = exercises[e]
        let set = ex.sets[s]
        let weightUnit = unit(ex.exerciseId)
        let kg = weightUnit.snapKg(set.weightKg)
        // A set planned with a drop: the top segment now, the lighter one after it.
        let drops = set.drops.isEmpty ? "" : " → " + SetDrop.text(set.drops, unit: weightUnit)
        return .init(
            exerciseName: ex.name,
            setLabel: "Serie \(s + 1) de \(ex.sets.count)",
            target: TrainingText.load(kg, reps: set.reps, unit: weightUnit) + drops,
            setsDone: setsDone,
            setsTotal: setsTotal,
            restStartedAt: resting ? restStartedAt : nil,
            restEndsAt: resting ? restEndsAt : nil,
            weight: kg > 0 ? weightUnit.format(kg) : nil
        )
    }

    static func ms(_ date: Date) -> Double { (date.timeIntervalSince1970 * 1000).rounded() }
    static func date(_ ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }
}

// MARK: - Contract JSON

extension LiveSet: Codable {
    private enum CodingKeys: String, CodingKey { case id, weightKg, reps, rpe, doneAt, segments }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        weightKg = try c.decode(Double.self, forKey: .weightKg)
        reps = try c.decode(Int.self, forKey: .reps)
        rpe = try c.decodeIfPresent(Double.self, forKey: .rpe)
        doneAt = try c.decodeIfPresent(Double.self, forKey: .doneAt).map(LiveSessionState.date)
        // `segments[0]` is the top, which weightKg/reps already are (and win over).
        drops = Array(((try? c.decodeIfPresent([SetSegment].self, forKey: .segments)) ?? []).dropFirst()).filter { $0.reps > 0 }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        // Finite numbers only, or the whole copy (on disk and to the engine) fails to encode.
        try c.encode(id, forKey: .id)
        try c.encode(weightKg.isFinite ? weightKg : 0, forKey: .weightKg)
        try c.encode(reps, forKey: .reps)
        try c.encode(rpe.flatMap { $0.isFinite ? $0 : nil }, forKey: .rpe)
        try c.encode(doneAt.map(LiveSessionState.ms), forKey: .doneAt)
        try c.encode(segments.map(\.sanitized), forKey: .segments)
    }
}

extension LiveExercise: Codable {
    private enum CodingKeys: String, CodingKey {
        case id, exerciseId, name, equipment, kind, modality, repMin, repMax, targetRpe, targetRir, restSeconds, notes, hint, sets, cardio, cardioLog, cutShort, skipped, supersetId
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        exerciseId = try c.decode(String.self, forKey: .exerciseId)
        name = try c.decode(String.self, forKey: .name)
        equipment = try c.decode(String.self, forKey: .equipment)
        kind = try c.decode(String.self, forKey: .kind)
        modality = try c.decodeIfPresent(String.self, forKey: .modality)
        repMin = try c.decode(Int.self, forKey: .repMin)
        repMax = try c.decode(Int.self, forKey: .repMax)
        targetRpe = try c.decodeIfPresent(Double.self, forKey: .targetRpe)
        targetRir = try c.decodeIfPresent(Int.self, forKey: .targetRir)
        restSeconds = try c.decode(Int.self, forKey: .restSeconds)
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
        hint = try c.decodeIfPresent(String.self, forKey: .hint)
        sets = try c.decodeIfPresent([LiveSet].self, forKey: .sets) ?? []
        cardio = try c.decodeIfPresent(CardioTarget.self, forKey: .cardio)
        cardioLog = try c.decodeIfPresent(CardioLog.self, forKey: .cardioLog)
        cutShort = (try? c.decodeIfPresent(CutShortJSON.self, forKey: .cutShort))?.value
        skipped = try c.decodeIfPresent(Bool.self, forKey: .skipped) ?? false
        supersetId = try c.decodeIfPresent(String.self, forKey: .supersetId)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(exerciseId, forKey: .exerciseId)
        try c.encode(name, forKey: .name)
        try c.encode(equipment, forKey: .equipment)
        try c.encode(kind, forKey: .kind)
        try c.encode(modality, forKey: .modality)
        try c.encode(repMin, forKey: .repMin)
        try c.encode(repMax, forKey: .repMax)
        try c.encode(targetRpe, forKey: .targetRpe)
        try c.encode(targetRir, forKey: .targetRir)
        try c.encode(restSeconds, forKey: .restSeconds)
        try c.encode(notes, forKey: .notes)
        try c.encode(hint, forKey: .hint)
        try c.encode(sets, forKey: .sets)
        try c.encode(cardio, forKey: .cardio)
        try c.encode(cardioLog.map(CardioLogJSON.init), forKey: .cardioLog)
        try c.encode(cutShort.map(CutShortJSON.init), forKey: .cutShort)
        try c.encode(skipped, forKey: .skipped)
        try c.encode(supersetId, forKey: .supersetId)
    }
}

/// `{ at: epoch ms, reason: string | null }`.
private struct CutShortJSON: Codable {
    let value: CutShort

    init(_ value: CutShort) { self.value = value }

    private enum CodingKeys: String, CodingKey { case at, reason }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        value = CutShort(at: LiveSessionState.date(try c.decode(Double.self, forKey: .at)), reason: try c.decodeIfPresent(String.self, forKey: .reason))
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(LiveSessionState.ms(value.at), forKey: .at)
        try c.encode(value.reason, forKey: .reason)
    }
}

/// The contract's `LiveCardioClock`: `{ exerciseId, runningSince: epoch ms | null, accumulatedSeconds }`.
private struct CardioClockJSON: Codable {
    let value: CardioClock

    init(_ value: CardioClock) { self.value = value }

    private enum CodingKeys: String, CodingKey { case exerciseId, runningSince, accumulatedSeconds }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        value = CardioClock(
            exerciseId: try c.decode(String.self, forKey: .exerciseId),
            runningSince: try c.decodeIfPresent(Double.self, forKey: .runningSince).map(LiveSessionState.date),
            accumulated: try c.decodeIfPresent(Double.self, forKey: .accumulatedSeconds) ?? 0
        )
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(value.exerciseId, forKey: .exerciseId)
        try c.encode(value.runningSince.map(LiveSessionState.ms), forKey: .runningSince)
        try c.encode(value.accumulated, forKey: .accumulatedSeconds)
    }
}

/// `CardioLog` with its nullable fields written as null, as the contract types them.
private struct CardioLogJSON: Encodable {
    let log: CardioLog

    private enum CodingKeys: String, CodingKey { case exerciseId, durationSeconds, distanceKm, level, inclinePercent, avgHr, kcal, doneAt }

    func encode(to encoder: Encoder) throws {
        let log = log.sanitized
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(log.exerciseId, forKey: .exerciseId)
        try c.encode(log.durationSeconds, forKey: .durationSeconds)
        try c.encode(log.distanceKm, forKey: .distanceKm)
        try c.encode(log.level, forKey: .level)
        try c.encode(log.inclinePercent, forKey: .inclinePercent)
        try c.encode(log.avgHr, forKey: .avgHr)
        try c.encode(log.kcal, forKey: .kcal)
        try c.encode(log.doneAt, forKey: .doneAt)
    }
}

extension LiveSessionState: Codable {
    private enum CodingKeys: String, CodingKey {
        case id, programId, dayId, name, startedAt, exercises, focus, restStartedAt, restEndsAt, cardioClock, version, updatedAt, threadId
    }

    /// `version` is required: a file without it is the older format (see `decodeStored`).
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decode(Int.self, forKey: .version)
        id = try c.decode(String.self, forKey: .id)
        programId = try c.decodeIfPresent(String.self, forKey: .programId)
        dayId = try c.decodeIfPresent(String.self, forKey: .dayId)
        name = try c.decode(String.self, forKey: .name)
        startedAt = Self.date(try c.decode(Double.self, forKey: .startedAt))
        exercises = try c.decode([LiveExercise].self, forKey: .exercises)
        focus = try c.decodeIfPresent(Int.self, forKey: .focus) ?? 0
        restStartedAt = try c.decodeIfPresent(Double.self, forKey: .restStartedAt).map(Self.date)
        restEndsAt = try c.decodeIfPresent(Double.self, forKey: .restEndsAt).map(Self.date)
        cardioClock = (try? c.decodeIfPresent(CardioClockJSON.self, forKey: .cardioClock))?.value
        updatedAt = try c.decodeIfPresent(Double.self, forKey: .updatedAt).map(Self.date) ?? startedAt
        threadId = try c.decodeIfPresent(String.self, forKey: .threadId)
        setFocus(focus)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(programId, forKey: .programId)
        try c.encode(dayId, forKey: .dayId)
        try c.encode(name, forKey: .name)
        try c.encode(Self.ms(startedAt), forKey: .startedAt)
        try c.encode(exercises, forKey: .exercises)
        try c.encode(focus, forKey: .focus)
        try c.encode(restStartedAt.map(Self.ms), forKey: .restStartedAt)
        try c.encode(restEndsAt.map(Self.ms), forKey: .restEndsAt)
        try c.encode(cardioClock.map(CardioClockJSON.init), forKey: .cardioClock)
        try c.encode(version, forKey: .version)
        try c.encode(Self.ms(updatedAt), forKey: .updatedAt)
        try c.encode(threadId, forKey: .threadId)
    }

    /// The live-session file: the contract format, else one written by an earlier
    /// build (Date fields, UUID ids, a prescription string) converted.
    static func decodeStored(_ data: Data) -> LiveSessionState? {
        if let state = try? JSONDecoder().decode(LiveSessionState.self, from: data) { return state }
        return (try? JSONDecoder().decode(LegacyLiveSession.self, from: data))?.converted
    }
}

// MARK: - The earlier file format

/// The live session as builds before the contract saved it, so a session in
/// progress across the update still resumes.
private struct LegacyLiveSession: Decodable {
    struct Set: Decodable {
        var id: UUID
        var weightKg: Double
        var reps: Int
        var doneAt: Date?
    }

    struct Exercise: Decodable {
        var id: String
        var exerciseId: String
        var name: String
        var prescription: String
        var restSeconds: Int
        var weightStep: Double
        var notes: String?
        var hint: String?
        var sets: [Set]
    }

    var id: String
    var programId: String?
    var dayId: String?
    var name: String
    var startedAt: Date
    var exercises: [Exercise]
    var restStartedAt: Date?
    var restEndsAt: Date?

    var converted: LiveSessionState {
        var state = LiveSessionState(
            id: id, programId: programId, dayId: dayId, name: name, startedAt: startedAt,
            exercises: exercises.map(Self.convert),
            restStartedAt: restStartedAt, restEndsAt: restEndsAt, updatedAt: .now
        )
        state.setFocus(state.current?.exercise ?? 0)
        return state
    }

    /// The rep range and RIR/RPE come back out of "3 × 6–8 · RIR 2"; the step says plates or dumbbells.
    private static func convert(_ ex: Exercise) -> LiveExercise {
        let parts = ex.prescription.components(separatedBy: " · ")
        let reps = parts.first?.components(separatedBy: "× ").last?
            .components(separatedBy: "–").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) } ?? []
        let fallback = ex.sets.first?.reps ?? 8
        let rir = parts.dropFirst().first { $0.hasPrefix("RIR ") }.flatMap { Int($0.dropFirst(4)) }
        let rpe = parts.dropFirst().first { $0.hasPrefix("RPE ") }.flatMap { Double($0.dropFirst(4).replacingOccurrences(of: ",", with: ".")) }
        return LiveExercise(
            id: ex.id,
            exerciseId: ex.exerciseId,
            name: ex.name,
            equipment: ex.weightStep == 1 ? "dumbbell" : "barbell",
            kind: "compound",
            repMin: reps.first ?? fallback,
            repMax: reps.last ?? fallback,
            targetRpe: rpe,
            targetRir: rir,
            restSeconds: ex.restSeconds,
            notes: ex.notes,
            hint: ex.hint,
            sets: ex.sets.map { LiveSet(id: $0.id.uuidString.lowercased(), weightKg: $0.weightKg, reps: $0.reps, doneAt: $0.doneAt) }
        )
    }
}
