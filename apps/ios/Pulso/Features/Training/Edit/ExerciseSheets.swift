import SwiftUI

// STUB — the program-editing worker replaces these bodies. The signatures are the
// contract the live session uses; keep them.

/// Search the library by name, muscle or equipment and pick one exercise (strength or cardio).
struct ExercisePickerSheet: View {
    var title: String = "Añadir ejercicio"
    let onPick: (LibraryExercise) -> Void

    var body: some View {
        Text(title)
    }
}

/// "Cambiar ejercicio": alternatives to `exerciseId` ranked by similarity and the
/// person's equipment preference, with equipment filter chips. `scopes` lists the
/// choices offered (one hides the picker); the pick comes back with the chosen scope.
struct SwapExerciseSheet: View {
    let exerciseId: String
    let name: String
    var scopes: [EditScope] = EditScope.allCases
    var initialScope: EditScope = .today
    let onPick: (LibraryExercise, EditScope) -> Void

    var body: some View {
        Text(name)
    }
}
