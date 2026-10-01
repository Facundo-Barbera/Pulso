import Foundation

/// The app's side of the widgets: after a sync it mirrors the pairing for the
/// extension, rewrites the snapshot and reloads every timeline. One call,
/// `await WidgetSync.refresh()`, from the stores that just talked to the engine.
@MainActor
enum WidgetSync {
    private static var running = false

    static func refresh() async {
        guard !running else { return }
        running = true
        defer { running = false }
        guard let credentials = PulsoModel.shared.credentials else {
            SharedCredentials.mirror(nil)
            SnapshotStore.clear()
            return WidgetEngine.reloadWidgets()
        }
        let shared = SharedCredentials(baseURL: credentials.baseURL, token: credentials.token)
        SharedCredentials.mirror(shared)
        _ = try? await WidgetEngine(credentials: shared).refreshSnapshot()
        WidgetEngine.reloadWidgets()
    }
}
