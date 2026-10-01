import SwiftUI

// STUB — the in-workout Coach worker replaces this body. The signature is the
// contract the live session uses; keep it.

/// The compact Coach chat bound to the session in progress. `onSessionChanged` runs
/// after the Coach changed the session through a tool, so the live screen can
/// pull the engine's copy, buzz and offer undo.
struct LiveCoachSheet: View {
    let sessionId: String
    /// Name of the exercise on screen, for the "Cambiar este ejercicio" chip.
    var currentExercise: String?
    let onSessionChanged: @MainActor () async -> Void

    var body: some View {
        Text("Coach")
    }
}
