import Foundation

// The Live Activity's view of the session: iPhone only (the Watch shares LiveSessionState).

extension LiveSessionState {
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
}
