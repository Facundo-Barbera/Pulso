import Foundation
import os
import WatchConnectivity

/// The second road between the phone and the Watch: WatchConnectivity, for when
/// the mirrored workout session can't carry a message (it hasn't reached the
/// phone yet, the link dropped, or on simulators, which pair without the
/// transport mirroring needs). Same messages; both sides apply them whichever
/// road they came by, and each is safe to receive twice.
@MainActor
final class WatchChannel: NSObject {
    static let shared = WatchChannel()

    /// Called on the main actor with every message that arrives.
    var receive: ((WatchMessage) -> Void)?
    /// Called when the other side becomes reachable, to send what waited.
    var reachable: (() -> Void)?

    private nonisolated static let log = Logger(subsystem: "com.facundo.pulso.channel", category: "watch")

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// Sends now if the other side is reachable; false otherwise.
    @discardableResult
    func send(_ message: WatchMessage) -> Bool {
        guard WCSession.isSupported() else { return false }
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable, let data = try? message.encoded() else { return false }
        session.sendMessageData(data, replyHandler: nil) { error in
            Self.log.error("send: \(error)")
        }
        return true
    }

    private nonisolated func deliver(_ data: Data) {
        guard let message = WatchMessage.decode(data) else { return }
        Task { @MainActor in WatchChannel.shared.receive?(message) }
    }
}

extension WatchChannel: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if let error { Self.log.error("activation: \(error)") }
        guard session.isReachable else { return }
        Task { @MainActor in WatchChannel.shared.reachable?() }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        guard session.isReachable else { return }
        Task { @MainActor in WatchChannel.shared.reachable?() }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessageData messageData: Data) {
        deliver(messageData)
    }

    #if os(iOS)
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

    /// Another Watch was chosen: start over with it.
    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
    #endif
}
