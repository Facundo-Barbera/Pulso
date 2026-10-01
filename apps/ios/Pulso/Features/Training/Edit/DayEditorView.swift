import SwiftUI

/// "Editar" on a program day: "Personalizar lista" over a copy of the day, saved
/// in one write for the whole plan or for this workout only.
struct DayEditorView: View {
    @State private var draft: ProgramListDraft

    init(day: ProgramDay, suggestions: [String: LoadSuggestion] = [:], hrZones: [HrZoneRange]? = nil) {
        _draft = State(initialValue: ProgramListDraft(day: day, suggestions: suggestions, hrZones: hrZones))
    }

    var body: some View {
        CustomizeListSheet(draft: draft)
    }
}

/// A program day being edited: the exercises as they'll be sent.
@MainActor
@Observable
final class ProgramListDraft: ListDraft {
    let day: ProgramDay
    let suggestions: [String: LoadSuggestion]
    let hrZones: [HrZoneRange]?
    var exercises: [ProgramExercise]
    var scope: EditScope
    /// Stills for exercises added here, by exercise id (the catalog has the rest).
    private var thumbnails: [String: String] = [:]

    init(day: ProgramDay, suggestions: [String: LoadSuggestion] = [:], hrZones: [HrZoneRange]? = nil) {
        self.day = day
        self.suggestions = suggestions
        self.hrZones = hrZones
        exercises = day.exercises
        // A day already changed for today keeps being edited for today.
        scope = day.overridden == true ? .today : .always
    }

    var title: String { day.name }
    var current: Int? { nil }
    var changed: Bool { exercises != day.exercises }

    var items: [ListItem] {
        exercises.map { ex in
            var detail = ex.isCardio ? ex.prescription : TrainingText.short(sets: ex.sets, repMin: ex.repMin, repMax: ex.repMax)
            if !ex.isCardio, let kg = ex.weightKg ?? suggestions[ex.id]?.weightKg, kg > 0 {
                let unit = TrainingStore.shared.unit(for: ex.exerciseId)
                detail += " · \(unit.format(unit.snapKg(kg)))"
            }
            return ListItem(id: ex.id, exerciseId: ex.exerciseId, name: ex.exerciseName, detail: detail, isCardio: ex.isCardio,
                            thumbnail: thumbnails[ex.exerciseId] ?? cachedThumbnail(ex.exerciseId), supersetId: ex.supersetId,
                            status: ex.isDraft ? "Nuevo" : nil)
        }
    }

    private func index(_ id: String) -> Int? { exercises.firstIndex { $0.id == id } }

    private func normalize() {
        setSupersets(exercises.map(\.supersetId))
    }

    func move(fromOffsets source: IndexSet, toOffset destination: Int) {
        exercises.move(fromOffsets: source, toOffset: destination)
        normalize()
    }

    func remove(_ id: String) {
        exercises.removeAll { $0.id == id }
        normalize()
    }

    func add(_ library: LibraryExercise) {
        thumbnails[library.id] = library.thumbnail
        exercises.append(.draft(library))
    }

    func swap(_ id: String, to library: LibraryExercise) -> String? {
        guard let i = index(id) else { return nil }
        thumbnails[library.id] = library.thumbnail
        exercises[i] = exercises[i].swapped(to: library)
        normalize()
        return exercises[i].id
    }

    func setSupersets(_ ids: [String?]) {
        let clean = Superset.normalize(ids, cardio: exercises.map(\.isCardio))
        for i in exercises.indices where exercises[i].supersetId != clean[i] { exercises[i].supersetId = clean[i] }
    }

    func customization(_ id: String) -> ExerciseCustomization? {
        guard let ex = index(id).map({ exercises[$0] }) else { return nil }
        return ExerciseCustomization(
            exerciseId: ex.exerciseId, sets: ex.sets, repMin: ex.repMin, repMax: ex.repMax, weightKg: ex.weightKg, suggestedKg: suggestions[ex.id]?.weightKg,
            suggestible: true, restSeconds: ex.restSeconds, isCardio: ex.isCardio,
            needsLoad: Equipment.needsLoad(ex.equipment), durationMinutes: ex.cardio?.durationMinutes
        )
    }

    func apply(_ new: ExerciseCustomization, was old: ExerciseCustomization, to id: String) {
        guard let i = index(id) else { return }
        var ex = exercises[i]
        if new.sets != old.sets { ex.sets = new.sets }
        if new.repMin != old.repMin || new.repMax != old.repMax { (ex.repMin, ex.repMax) = (new.repMin, new.repMax) }
        if new.weightKg != old.weightKg { ex.weightKg = new.weightKg }
        if new.restSeconds != old.restSeconds { ex.restSeconds = new.restSeconds }
        if new.durationMinutes != old.durationMinutes {
            var cardio = ex.cardio ?? CardioTarget()
            cardio.durationMinutes = new.durationMinutes
            ex.cardio = cardio
        }
        exercises[i] = ex
    }

    func moreSettings(_ id: String) -> AnyView? {
        guard let i = index(id) else { return nil }
        let fallback = exercises[i]
        let binding = Binding(
            get: { [self] in exercises.first { $0.id == id } ?? fallback },
            set: { [self] new in if let j = index(id) { exercises[j] = new } }
        )
        return AnyView(ExerciseTargetEditor(exercise: binding, suggestion: suggestions[id], hrZones: hrZones, thumbnail: thumbnails[fallback.exerciseId] ?? cachedThumbnail(fallback.exerciseId)))
    }

    func save() async throws {
        try await TrainingStore.shared.saveDay(day.id, scope: scope, exercises: exercises.map(\.editInput))
    }
}

#if DEBUG
#Preview("Personalizar lista · 375 pt", traits: .fixedLayout(width: 375, height: 812)) {
    DayEditorView(day: .editorPreview, hrZones: HrZoneRange.previews)
}

#Preview("Personalizar lista · 440 pt, claro", traits: .fixedLayout(width: 440, height: 956)) {
    DayEditorView(day: .editorPreview).preferredColorScheme(.light)
}

#Preview("Personalizar lista · XXL", traits: .fixedLayout(width: 375, height: 812)) {
    DayEditorView(day: .editorPreview).dynamicTypeSize(.xxLarge)
}

#Preview("Personalizar lista · vacío", traits: .fixedLayout(width: 375, height: 812)) {
    DayEditorView(day: ProgramDay(id: "d", name: "Pierna B", focus: nil, weekday: nil, exercises: []))
}

#Preview("Personalizar ejercicio", traits: .fixedLayout(width: 375, height: 812)) {
    @Previewable @State var draft = ProgramListDraft(day: .editorPreview)
    Color.clear.sheet(isPresented: .constant(true)) {
        CustomizeExerciseSheet(draft: draft, id: ProgramDay.editorPreview.exercises[0].id)
    }
}
#endif
