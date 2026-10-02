import Foundation

/// Sets where the load dropped mid-set ("80 × 5 → 60 × 3"). A port of the
/// engine's `src/training/segments.ts`: keep the two in step.
enum SetDrop {
    /// How much lighter a suggested drop is: about 15 %, so it lands between 10 and 20 % on most loads.
    static let factor = 0.85

    /// The segment to add after a set's last one: about 15 % lighter, on the
    /// steps of the exercise's unit (always at least one step down), for the
    /// reps still missing to `repMin` (at least 1).
    static func next(top: SetSegment, drops: [SetSegment], repMin: Int, unit: WeightUnit) -> SetSegment {
        let last = drops.last ?? top
        let done = drops.reduce(top.reps) { $0 + $1.reps }
        let reps = max(1, repMin - done)
        guard last.weightKg > 0 else { return SetSegment(weightKg: 0, reps: reps) }
        let value = unit.snap(last.weightKg)
        let target = unit.toUnit(last.weightKg) * factor
        // Whole steps down from the top (the grid the machine has), to the step nearest the target.
        var above = unit.stepDown(value)
        var below = above
        while below > target && below > 0 {
            above = below
            below = unit.stepDown(below)
        }
        let weight = above - target <= target - below ? above : below
        return SetSegment(weightKg: unit.fromUnit(weight), reps: reps)
    }

    /// "¿Bajaste el peso para terminarla?": a set just checked off short of the
    /// target's bottom, with a load and no drop yet. Nil when it met the target.
    static func offer(for set: LiveSet, repMin: Int, unit: WeightUnit) -> SetSegment? {
        guard set.done, set.drops.isEmpty, set.weightKg > 0, set.reps > 0, set.reps < repMin else { return nil }
        let drop = next(top: SetSegment(weightKg: set.weightKg, reps: set.reps), drops: [], repMin: repMin, unit: unit)
        return drop.weightKg > 0 && drop.weightKg < set.weightKg ? drop : nil
    }

    /// "80 × 5 → 60 × 3": numbers in `unit`, for a row whose header names the unit.
    static func short(_ segments: [SetSegment], unit: WeightUnit) -> String {
        segments.map { $0.weightKg > 0 ? "\(WeightUnit.number(unit.shown($0.weightKg))) × \($0.reps)" : TrainingText.repetitions($0.reps) }
            .joined(separator: " → ")
    }

    /// "80 kg × 5 → 60 kg × 3", the unit on every load.
    static func text(_ segments: [SetSegment], unit: WeightUnit) -> String {
        segments.map { $0.weightKg > 0 ? "\(unit.format($0.weightKg)) × \($0.reps)" : TrainingText.repetitions($0.reps) }
            .joined(separator: " → ")
    }
}
