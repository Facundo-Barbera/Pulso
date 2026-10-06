import Foundation
import os
import WatchConnectivity

/// WatchConnectivity between the phone and the Watch, three ways:
/// - `send`: now, when the other side is reachable (the live numbers);
/// - `deliver`: queued by the system until it arrives, even across app restarts
///   and long disconnections (the Watch's edits);
/// - `publish`: the latest only, replacing what wasn't read yet (the phone's
///   copy of the session).
/// The mirrored workout session is the other road; both sides apply a message
/// whichever way it came, and every message is safe to receive twice.
@MainActor
final class WatchChannel: NSObject {
    static let shared = WatchChannel()

    /// Called on the main actor with every message that arrives.
    var receive: ((WatchMessage) -> Void)?
    /// Called when the other side becomes reachable.
    var reachable: (() -> Void)?

    private nonisolated static let log = Logger(subsystem: "com.facundo.pulso.channel", category: "watch")
    private static let key = "m"

    var isReachable: Bool { WCSession.isSupported() && WCSession.default.activationState == .activated && WCSession.default.isReachable }

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// Sends now if the other side is reachable; false otherwise.
    @discardableResult
    func send(_ message: WatchMessage) -> Bool {
        guard isReachable, let data = try? message.encoded() else { return false }
        WCSession.default.sendMessageData(data, replyHandler: nil) { error in
            Self.log.error("send: \(error)")
        }
        return true
    }

    /// Queued until it reaches the other side, in order.
    func deliver(_ message: WatchMessage) {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated, let data = try? message.encoded() else { return }
        WCSession.default.transferUserInfo([Self.key: data])
    }

    /// The other side gets this one, or a later one, whenever it can.
    func publish(_ message: WatchMessage) {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated, let data = try? message.encoded() else { return }
        do { try WCSession.default.updateApplicationContext([Self.key: data]) } catch { Self.log.error("publish: \(error)") }
    }

    private nonisolated func deliver(data: Data?) {
        guard let data, let message = WatchMessage.decode(data) else { return }
        Task { @MainActor in WatchChannel.shared.receive?(message) }
    }
}

extension WatchChannel: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if let error { Self.log.error("activation: \(error)") }
        // What the other side published while this app wasn't running.
        deliver(data: session.receivedApplicationContext[Self.key] as? Data)
        guard session.isReachable else { return }
        Task { @MainActor in WatchChannel.shared.reachable?() }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        guard session.isReachable else { return }
        Task { @MainActor in WatchChannel.shared.reachable?() }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessageData messageData: Data) {
        deliver(data: messageData)
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        deliver(data: userInfo[Self.key] as? Data)
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        deliver(data: applicationContext[Self.key] as? Data)
    }

    #if os(iOS)
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

    /// Another Watch was chosen: start over with it.
    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
    #endif
}
