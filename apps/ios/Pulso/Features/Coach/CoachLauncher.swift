import Observation
import SwiftUI

/// Opens the Coach from anywhere in the app. A feature calls `askCoach("…")`
/// (environment) or `CoachLauncher.shared.ask("…")`; RootView switches to the
/// Coach tab when `pending` changes, and `CoachView` pushes the chat and clears it.
@MainActor
@Observable
final class CoachLauncher {
    static let shared = CoachLauncher()

    enum Request: Equatable {
        /// A new chat. `send`: the prompt goes out at once; otherwise it waits in the composer.
        case prompt(String, send: Bool)
        /// An existing conversation, composer focused.
        case thread(AgentThread)
        /// A new chat that opens the camera, the prompt waiting in the composer for the photo.
        case photo(String)
    }

    struct Launch: Identifiable, Equatable {
        let id = UUID()
        let request: Request
    }

    /// The launch waiting for the Coach tab to show it.
    private(set) var pending: Launch?

    func ask(_ prompt: String, send: Bool = true) {
        pending = Launch(request: .prompt(prompt, send: send))
    }

    /// "Foto de comida": the Coach with the camera open and `prompt` ready to go with the photo.
    func photo(_ prompt: String) {
        pending = Launch(request: .photo(prompt))
    }

    func open(_ thread: AgentThread) {
        pending = Launch(request: .thread(thread))
    }

    /// A conversation by id, as a tapped reply notification names it.
    func open(threadId: String) async {
        guard let api = PulsoModel.shared.api else { return }
        do { open(try await api.agentThread(threadId).thread) } catch { PulsoModel.shared.handle(error) }
    }

    /// Hands the pending launch to the Coach tab, once.
    func take() -> Launch? {
        defer { pending = nil }
        return pending
    }

    // The other direction: a result card in the chat asks RootView to show the tab
    // where the thing lives ("hoy", "entreno", "dieta", "cuerpo").

    struct TabRequest: Identifiable, Equatable {
        let id = UUID()
        let tab: String
    }

    private(set) var tabRequest: TabRequest?

    func show(tab: String) {
        tabRequest = TabRequest(tab: tab)
    }

    /// Hands the requested tab to RootView, once.
    func takeTab() -> String? {
        defer { tabRequest = nil }
        return tabRequest?.tab
    }
}

/// `@Environment(\.askCoach) private var askCoach` → `askCoach("Arma mi plan de comidas")`.
struct AskCoachAction {
    @MainActor
    func callAsFunction(_ prompt: String, send: Bool = true) {
        CoachLauncher.shared.ask(prompt, send: send)
    }
}

extension EnvironmentValues {
    @Entry var askCoach = AskCoachAction()
}
