import Foundation
import Observation
import UIKit
import UserNotifications

/// One thread (the live-workout chat): its messages and the turn being streamed, if any.
///
/// The turn runs on the Mac to the end whatever the phone does, so the phone only
/// has to keep up: stores are kept per thread (leaving and reopening a chat shows
/// the same live reply), streams run in tasks no view owns, a lost stream
/// re-attaches by itself, and coming back to the app picks up where it left off.
/// The Coach tab's one conversation is `ConversationStore`.
@MainActor
@Observable
final class ChatStore {
    private(set) var threadId: String?
    private(set) var title: String?
    private(set) var messages: [AgentMessage] = []
    private(set) var streaming = false
    private(set) var loading = false
    var error: String?
    /// Bumped on send and on finish; the views hang haptics off them.
    private(set) var sentCount = 0
    private(set) var finishedCount = 0
    @ObservationIgnored private var followTask: Task<Void, Never>?
    /// Local reply id → the Mac's, from `start`: Deshacer has to name the saved message.
    @ObservationIgnored private var serverIds: [String: String] = [:]

    /// The Mac's copy of the thread, keeping local ids on screen (row identity) and
    /// remembering the server's id behind each one (undo needs it).
    private func adoptSaved(_ saved: [AgentMessage]) {
        let kept = AgentMessage.keepingIds(of: messages, in: saved)
        for (local, server) in zip(kept, saved) where local.id != server.id { serverIds[local.id] = server.id }
        messages = kept
    }

    /// Live stores by thread id, so a reply streaming in one keeps streaming
    /// while the person is elsewhere and is there when they come back.
    private static var live: [String: ChatStore] = [:]

    /// The store for `threadId`, the same one each time; a new chat gets a fresh one.
    static func store(for threadId: String?) -> ChatStore {
        if let threadId, let existing = live[threadId] { return existing }
        let store = ChatStore(threadId: threadId)
        if let threadId { live[threadId] = store }
        return store
    }

    static func forget(_ threadId: String) {
        live[threadId]?.followTask?.cancel()
        live[threadId] = nil
    }

    /// Every chat with a reply in flight re-attaches; called when the app returns to the foreground.
    static func resumeAll() {
        for store in live.values { store.resume() }
    }

    private init(threadId: String?) {
        self.threadId = threadId
    }

    /// Re-read the thread unless a stream is already live; attaches to a running turn.
    func resume() {
        guard followTask == nil, threadId != nil else { return }
        Task { await load() }
    }

    func load() async {
        guard let api = PulsoModel.shared.api, let threadId, followTask == nil else { return }
        loading = messages.isEmpty
        defer { loading = false }
        do {
            let detail = try await api.agentThread(threadId)
            title = detail.thread.title
            guard followTask == nil else { return }
            adoptSaved(detail.messages)
            if detail.running, let last = messages.indices.last, messages[last].status == .streaming {
                // The re-attached stream replays the turn from its start.
                messages[last].text = ""
                messages[last].tools = []
                start { api.attachAgentTurn(threadId: threadId) }
            }
        } catch {
            PulsoModel.shared.handle(error)
        }
    }

    func send(_ raw: String, photos: [ChatPhoto] = [], products: [AgentProduct] = []) async {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let api = PulsoModel.shared.api, !text.isEmpty || !photos.isEmpty || !products.isEmpty, !streaming else { return }
        error = nil
        sentCount += 1
        let now = Date().timeIntervalSince1970 * 1000
        let local = "local-\(UUID().uuidString)"
        CoachPhotoCache.shared.remember(photos)
        messages.append(AgentMessage(id: "\(local)-user", threadId: threadId ?? "", role: .user, text: text, tools: [], status: .done, error: nil, createdAt: now,
                                     attachments: photos.map(\.attachment), products: products))
        messages.append(AgentMessage(id: local, threadId: threadId ?? "", role: .assistant, text: "", tools: [], status: .streaming, error: nil, createdAt: now))
        streaming = true
        guard let threadId else {
            streaming = false
            return fail("Esta conversación todavía no está en la Mac.")
        }
        let jpegs = photos.map(\.jpeg)
        let barcodes = products.map(\.barcode)
        start { api.sendAgentMessage(threadId: threadId, text: text, photos: jpegs, barcodes: barcodes) }
    }

    /// Follows a stream in a task no view owns. iOS gets a little background time
    /// to finish it; if it is cut anyway, `resume()` re-attaches on return.
    private func start(_ open: @escaping () -> AsyncThrowingStream<AgentStreamEvent, Error>) {
        followTask?.cancel()
        streaming = true
        followTask = Task { [weak self] in
            let background = BackgroundTime("coach-turn")
            await self?.follow(open())
            background.end()
            self?.followTask = nil
        }
    }

    /// Applies a turn's events to the last assistant message. A lost stream
    /// re-attaches while the Mac is still answering; otherwise the saved thread wins.
    private func follow(_ stream: AsyncThrowingStream<AgentStreamEvent, Error>) async {
        if messages.last?.role != .assistant || messages.last?.status != .streaming {
            messages.append(AgentMessage(id: "local-\(UUID().uuidString)", threadId: threadId ?? "", role: .assistant, text: "", tools: [], status: .streaming, error: nil, createdAt: Date().timeIntervalSince1970 * 1000))
        }
        var finished = false
        var stream = stream
        var attempts = 0
        while !finished, !Task.isCancelled {
            do {
                for try await event in stream {
                    apply(event)
                    if case .done = event { finished = true }
                    if case .error = event { finished = true }
                }
            } catch {
                // Dropped (background, network): not an error the person must act on.
            }
            guard !finished, !Task.isCancelled, let api = PulsoModel.shared.api, let threadId else { break }
            // Lost the stream: what the Mac saved is the truth; if it's still answering, follow again.
            guard let detail = try? await api.agentThread(threadId) else {
                attempts += 1
                if attempts > 5 { break }
                try? await Task.sleep(for: .seconds(2))
                continue
            }
            title = detail.thread.title
            adoptSaved(detail.messages)
            guard detail.running, let last = messages.indices.last, messages[last].status == .streaming else {
                finished = true
                break
            }
            messages[last].text = ""
            messages[last].tools = []
            attempts = 0
            stream = api.attachAgentTurn(threadId: threadId)
        }
        streaming = false
        if !finished, !Task.isCancelled, let index = messages.indices.last, messages[index].status == .streaming {
            // Couldn't reach the Mac: the reply is safe there and loads on return.
            error = "Sin conexión con la Mac. La respuesta sigue guardándose allá y aparecerá al volver."
        }
        if finished, let api = PulsoModel.shared.api, let threadId, let detail = try? await api.agentThread(threadId) {
            title = detail.thread.title
        }
        if finished, UIApplication.shared.applicationState != .active, let reply = messages.last, reply.role == .assistant, reply.status == .done {
            notifyReply(reply.text)
        }
        finishedCount += 1
    }

    /// A local notice when the reply lands while the person is in another app.
    private func notifyReply(_ text: String) {
        let content = UNMutableNotificationContent()
        content.title = title ?? "Coach"
        content.body = String(text.replacingOccurrences(of: #"[*_`#>|]+"#, with: "", options: .regularExpression).prefix(180))
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "coach-\(threadId ?? "")", content: content, trigger: nil))
    }

    private func apply(_ event: AgentStreamEvent) {
        guard let index = messages.indices.last, messages[index].role == .assistant else { return }
        // Ids stay local so rows keep their identity; the server's id is remembered for undo.
        if case let .start(messageId, _) = event { serverIds[messages[index].id] = messageId }
        messages[index].apply(event)
    }

    /// Deshacer on an action card: the Mac puts the change back and the card shows it undone.
    /// Nil when it worked, else what to tell the person.
    func undo(_ message: AgentMessage, index: Int) async -> String? {
        guard let api = PulsoModel.shared.api, let threadId else { return "Empareja la app con tu Mac." }
        do {
            var saved = try await api.undoAgentAction(threadId: threadId, messageId: serverIds[message.id] ?? message.id, index: index)
            saved.id = message.id
            if let i = messages.firstIndex(where: { $0.id == message.id }) { messages[i] = saved }
            return nil
        } catch {
            if let failure = error as? PulsoAPI.Failure, failure.kind == .unpaired { PulsoModel.shared.handle(error) }
            return error.localizedDescription
        }
    }

    private func fail(_ message: String) {
        if let index = messages.indices.last, messages[index].role == .assistant, messages[index].status == .streaming {
            messages[index].status = .error
            messages[index].error = message
        } else {
            error = message
        }
    }
}

extension AgentMessage {
    /// One event of a turn applied to the reply being written.
    mutating func apply(_ event: AgentStreamEvent) {
        switch event {
        case let .text(delta):
            text += delta
        case let .tool(name, status, access, result):
            if let i = tools.lastIndex(where: { $0.name == name && $0.status == .running }), status != .running {
                tools[i].status = status
                tools[i].result = result
                if let access { tools[i].access = access }
            } else if status == .running {
                tools.append(AgentToolUse(name: name, status: status, access: access))
            }
        case .done:
            status = .done
            for i in tools.indices where tools[i].status == .running {
                tools[i].status = .done
            }
        case let .error(message):
            status = .error
            error = message
        case .start, .compacting, .compacted, .unknown:
            break
        }
    }

    /// The saved conversation, keeping the ids of rows already on screen. A local
    /// placeholder and the message the Mac saved for it are the same row, matched by
    /// position and role: re-keyed rows are rebuilt, and a lazy stack rebuilt under a
    /// bottom-pinned scroll view shows nothing until the next drag.
    static func keepingIds(of shown: [AgentMessage], in saved: [AgentMessage]) -> [AgentMessage] {
        saved.enumerated().map { index, message in
            guard shown.indices.contains(index), shown[index].role == message.role, shown[index].id.hasPrefix("local-") else { return message }
            var kept = message
            kept.id = shown[index].id
            return kept
        }
    }
}
