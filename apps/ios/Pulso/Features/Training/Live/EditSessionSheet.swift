import SwiftUI

/// The live session's list button: "Personalizar lista" over a copy of the
/// session. "Guardar" applies it on top of anything logged meanwhile, and with
/// "Todo el plan" also rewrites the program day.
struct EditSessionSheet: View {
    @State private var draft: LiveListDraft

    init(session: LiveSession) {
        _draft = State(initialValue: LiveListDraft(session: session))
    }

    var body: some View {
        CustomizeListSheet(draft: draft)
    }
}

/// The session's exercises being edited, through the same pure operations the
/// session uses (so done sets, swaps and supersets behave the same).
@MainActor
@Observable
final class LiveListDraft: ListDraft {
    let session: LiveSession
    private(set) var state: LiveSessionState
    private let original: [LiveExercise]
    var scope: EditScope = .today
    /// Loads typed here, for the program when saving to the whole plan.
    private var weights: [String: Double] = [:]
    private var thumbnails: [String: String] = [:]

    init(session: LiveSession) {
        self.session = session
        state = session.state
        original = session.state.exercises
    }

    var title: String { state.name }
    var current: Int? { state.exercises.isEmpty ? nil : state.focus }
    var changed: Bool { state.exercises != original }

    var items: [ListItem] {
        state.exercises.map { ex in
            ListItem(
                id: ex.id, exerciseId: ex.exerciseId, name: ex.name,
                detail: ex.isCardio ? ex.prescription : TrainingText.short(sets: ex.sets.count, repMin: ex.repMin, repMax: ex.repMax),
                isCardio: ex.isCardio, thumbnail: thumbnails[ex.exerciseId] ?? cachedThumbnail(ex.exerciseId), supersetId: ex.supersetId,
                locked: ex.hasDoneWork, skipped: ex.skipped, status: ex.skipped ? "Saltado" : ex.done ? "Hecho" : nil
            )
        }
    }

    private func index(_ id: String) -> Int? { state.exercises.firstIndex { $0.id == id } }

    func move(fromOffsets source: IndexSet, toOffset destination: Int) { state.move(fromOffsets: source, toOffset: destination) }

    func remove(_ id: String) {
        if let i = index(id) { state.remove(at: i) }
    }

    func add(_ library: LibraryExercise) {
        thumbnails[library.id] = library.thumbnail
        state.add(library, weightKg: LiveHistory.lastWeight(library.id, in: TrainingStore.shared.sessions) ?? 0)
    }

    func swap(_ id: String, to library: LibraryExercise) -> String? {
        guard let i = index(id) else { return nil }
        let focus = state.focus
        thumbnails[library.id] = library.thumbnail
        let new = state.swap(i, to: library, weightKg: LiveHistory.lastWeight(library.id, in: TrainingStore.shared.sessions) ?? 0)
        state.setFocus(focus)
        return state.exercises[new].id
    }

    func resume(_ id: String) {
        if let i = index(id) { state.setSkipped(i, false) }
    }

    func setSupersets(_ ids: [String?]) {
        for e in state.exercises.indices { state.exercises[e].supersetId = ids[e] }
        state.normalizeSupersets()
    }

    func customization(_ id: String) -> ExerciseCustomization? {
        guard let ex = index(id).map({ state.exercises[$0] }) else { return nil }
        return ExerciseCustomization(
            exerciseId: ex.exerciseId, sets: max(1, ex.sets.count), repMin: ex.repMin, repMax: ex.repMax, weightKg: ex.workingWeight > 0 ? ex.workingWeight : nil,
            restSeconds: ex.restSeconds, minSets: ex.sets.count(where: \.done), isCardio: ex.isCardio,
            needsLoad: Equipment.needsLoad(ex.equipment), durationMinutes: ex.cardio?.durationMinutes
        )
    }

    func apply(_ new: ExerciseCustomization, was old: ExerciseCustomization, to id: String) {
        guard let i = index(id) else { return }
        let ex = state.exercises[i]
        if ex.isCardio {
            if new.durationMinutes != old.durationMinutes {
                var cardio = ex.cardio ?? CardioTarget()
                cardio.durationMinutes = new.durationMinutes
                state.exercises[i].cardio = cardio
            }
            return
        }
        let ranged = new.repMin != old.repMin || new.repMax != old.repMax
        let weight = new.weightKg != old.weightKg ? new.weightKg : nil
        state.updateTarget(i, sets: new.sets != old.sets ? new.sets : ex.sets.count, repMin: ranged ? new.repMin : ex.repMin, repMax: ranged ? new.repMax : ex.repMax,
                           weightKg: weight, restSeconds: new.restSeconds != old.restSeconds ? new.restSeconds : ex.restSeconds)
        if let weight { weights[id] = weight }
    }

    func save() async throws {
        session.apply(state)
        if scope == .always { try await session.savePlan(state.exercises, weights: weights) }
    }
}

#if DEBUG
#Preview("Personalizar lista · 375 pt", traits: .fixedLayout(width: 375, height: 812)) {
    EditSessionSheet(session: LiveSession(state: .preview))
}

#Preview("Personalizar lista · 440 pt, claro", traits: .fixedLayout(width: 440, height: 956)) {
    EditSessionSheet(session: LiveSession(state: .preview))
        .preferredColorScheme(.light)
}

#Preview("Personalizar lista · 375 pt, XXL", traits: .fixedLayout(width: 375, height: 812)) {
    EditSessionSheet(session: LiveSession(state: .preview))
        .dynamicTypeSize(.xxLarge)
}
#endif
