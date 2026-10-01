import Foundation

struct LiveSet: Codable, Identifiable, Hashable {
    var id = UUID()
    var weightKg: Double
    var reps: Int
    var doneAt: Date?

    var done: Bool { doneAt != nil }
}

struct LiveExercise: Codable, Identifiable, Hashable {
    var id: String
    var exerciseId: String
    var name: String
    var prescription: String
    var restSeconds: Int
    var weightStep: Double
    var notes: String?
    /// The double-progression reason from the engine, shown under the name.
    var hint: String?
    var sets: [LiveSet]

    var done: Bool { sets.allSatisfy(\.done) }
}

/// A strength session in progress: pure value logic, persisted as JSON so a
/// killed app resumes where it was. `LiveSession` adds timers and side effects.
struct LiveSessionState: Codable, Hashable {
    var id: String
    var programId: String?
    var dayId: String?
    var name: String
    var startedAt: Date
    var exercises: [LiveExercise]
    var restStartedAt: Date?
    var restEndsAt: Date?

    /// Sets prefilled from the suggested load (0 kg when there is no history yet).
    init(day: ProgramDay, programId: String?, suggestions: [String: LoadSuggestion], now: Date = .now) {
        id = UUID().uuidString.lowercased()
        self.programId = programId
        dayId = day.id
        name = day.name
        startedAt = now
        exercises = day.exercises.map { ex in
            let suggestion = suggestions[ex.id]
            let set = LiveSet(weightKg: suggestion?.weightKg ?? 0, reps: suggestion?.reps ?? ex.repMin)
            return LiveExercise(
                id: ex.id,
                exerciseId: ex.exerciseId,
                name: ex.exerciseName,
                prescription: ex.prescription,
                restSeconds: ex.restSeconds,
                weightStep: ex.weightStep,
                notes: ex.notes,
                hint: suggestion?.reason,
                sets: (0..<ex.sets).map { _ in LiveSet(weightKg: set.weightKg, reps: set.reps) }
            )
        }
    }

    var setsTotal: Int { exercises.reduce(0) { $0 + $1.sets.count } }
    var setsDone: Int { exercises.reduce(0) { $0 + $1.sets.filter(\.done).count } }
    var volumeKg: Double { exercises.flatMap(\.sets).filter(\.done).reduce(0) { $0 + $1.weightKg * Double($1.reps) } }

    /// The first set not yet done, in program order.
    var current: (exercise: Int, set: Int)? {
        for (e, ex) in exercises.enumerated() {
            if let s = ex.sets.firstIndex(where: { !$0.done }) { return (e, s) }
        }
        return nil
    }

    func resting(at now: Date = .now) -> Bool { restEndsAt.map { $0 > now } ?? false }

    /// Checks a set off (starting its rest) or un-checks it. Checking carries
    /// the set's weight to the later sets not done yet, so a changed load
    /// sticks for the rest of the exercise.
    mutating func toggle(exercise e: Int, set s: Int, now: Date = .now) {
        guard exercises.indices.contains(e), exercises[e].sets.indices.contains(s) else { return }
        if exercises[e].sets[s].done {
            exercises[e].sets[s].doneAt = nil
            restStartedAt = nil
            restEndsAt = nil
            return
        }
        exercises[e].sets[s].doneAt = now
        let weight = exercises[e].sets[s].weightKg
        for later in exercises[e].sets.indices where later > s && !exercises[e].sets[later].done {
            exercises[e].sets[later].weightKg = weight
        }
        if current == nil {
            restStartedAt = nil
            restEndsAt = nil
        } else {
            restStartedAt = now
            restEndsAt = now.addingTimeInterval(TimeInterval(exercises[e].restSeconds))
        }
    }

    mutating func adjustWeight(exercise e: Int, set s: Int, by steps: Double) {
        let step = exercises[e].weightStep
        exercises[e].sets[s].weightKg = max(0, ((exercises[e].sets[s].weightKg + steps * step) / step).rounded() * step)
    }

    mutating func adjustReps(exercise e: Int, set s: Int, by delta: Int) {
        exercises[e].sets[s].reps = max(0, exercises[e].sets[s].reps + delta)
    }

    /// One more set, copying the last one's load and reps.
    mutating func addSet(exercise e: Int) {
        guard let last = exercises[e].sets.last else { return }
        exercises[e].sets.append(LiveSet(weightKg: last.weightKg, reps: last.reps))
    }

    mutating func extendRest(by seconds: TimeInterval, now: Date = .now) {
        guard let end = restEndsAt, end > now else { return }
        restEndsAt = end.addingTimeInterval(seconds)
    }

    mutating func skipRest() {
        restStartedAt = nil
        restEndsAt = nil
    }

    /// What the engine stores: done sets only, numbered per exercise in the order they were done.
    func session(endedAt: Date) -> TrainingSession {
        let ms = { (date: Date) in (date.timeIntervalSince1970 * 1000).rounded() }
        let sets = exercises
            .flatMap { ex in ex.sets.compactMap { set in set.doneAt.map { (ex.exerciseId, set, $0) } } }
            .sorted { $0.2 < $1.2 }
        var counts: [String: Int] = [:]
        let logs = sets.map { exerciseId, set, doneAt in
            let index = counts[exerciseId, default: 0]
            counts[exerciseId] = index + 1
            return SetLog(exerciseId: exerciseId, setIndex: index, weightKg: set.weightKg, reps: set.reps, rpe: nil, doneAt: ms(doneAt))
        }
        return TrainingSession(id: id, programId: programId, dayId: dayId, name: name, startedAt: ms(startedAt), endedAt: ms(endedAt), notes: nil, sets: logs)
    }

    func activityState(now: Date = .now) -> TrainingActivityAttributes.ContentState {
        let resting = resting(at: now)
        guard let (e, s) = current else {
            return .init(exerciseName: "Sesión completa", setLabel: "Todas las series hechas", target: "", setsDone: setsDone, setsTotal: setsTotal)
        }
        let ex = exercises[e]
        let set = ex.sets[s]
        return .init(
            exerciseName: ex.name,
            setLabel: "Serie \(s + 1) de \(ex.sets.count)",
            target: LiveSessionState.target(set),
            setsDone: setsDone,
            setsTotal: setsTotal,
            restStartedAt: resting ? restStartedAt : nil,
            restEndsAt: resting ? restEndsAt : nil
        )
    }

    static func target(_ set: LiveSet) -> String {
        set.weightKg > 0 ? "\(set.weightKg.formatted()) kg × \(set.reps)" : "\(set.reps) reps"
    }
}
