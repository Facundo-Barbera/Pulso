import UIKit

/// A little background time from iOS for one job, ended exactly once: by `end()`
/// when the job is done, or when iOS takes the time back (an unended task gets the
/// app killed). Main actor only, as UIKit's background tasks are.
@MainActor
final class BackgroundTime {
    private var id = UIBackgroundTaskIdentifier.invalid

    init(_ name: String) {
        id = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in self?.end() }
    }

    func end() {
        guard id != .invalid else { return }
        UIApplication.shared.endBackgroundTask(id)
        id = .invalid
    }
}
