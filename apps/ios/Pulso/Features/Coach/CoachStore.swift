import Foundation
import Observation
import UIKit
import UserNotifications

/// The thread list.
@MainActor
@Observable
final class CoachStore {
    private(set) var threads: [AgentThread] = []
    private(set) var loaded = false

    func refresh() async {
        guard let api = PulsoModel.shared.api else { return }
        do {
            threads = try await api.agentThreads()
            loaded = true
        } catch {
            PulsoModel.shared.handle(error)
        }
    }

    func delete(_ thread: AgentThread) async {
        guard let api = PulsoModel.shared.api else { return }
        threads.removeAll { $0.id == thread.id }
        ChatStore.forget(thread.id)
        do {
            try await api.deleteAgentThread(thread.id)
        } catch {
            PulsoModel.shared.handle(error)
            await refresh()
        }
    }
}

/// One conversation: its messages and the turn being streamed, if any.
///
/// The turn runs on the Mac to the end whatever the phone does, so the phone only
/// has to keep up: stores are kept per thread (leaving and reopening a chat shows
/// the same live reply), streams run in tasks no view owns, a lost stream
/// re-attaches by itself, and coming back to the app picks up where it left off.
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
            messages = detail.messages
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

    func send(_ raw: String, photos: [ChatPhoto] = []) async {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let api = PulsoModel.shared.api, !text.isEmpty || !photos.isEmpty, !streaming else { return }
        error = nil
        sentCount += 1
        let now = Date().timeIntervalSince1970 * 1000
        let local = "local-\(UUID().uuidString)"
        CoachPhotoCache.shared.remember(photos)
        messages.append(AgentMessage(id: "\(local)-user", threadId: threadId ?? "", role: .user, text: text, tools: [], status: .done, error: nil, createdAt: now, attachments: photos.map(\.attachment)))
        messages.append(AgentMessage(id: local, threadId: threadId ?? "", role: .assistant, text: "", tools: [], status: .streaming, error: nil, createdAt: now))
        streaming = true
        do {
            if threadId == nil {
                let thread = try await api.createAgentThread()
                threadId = thread.id
                Self.live[thread.id] = self
            }
            let threadId = threadId!
            let jpegs = photos.map(\.jpeg)
            start { api.sendAgentMessage(threadId: threadId, text: text, photos: jpegs) }
        } catch {
            streaming = false
            fail(error.localizedDescription)
        }
    }

    /// Follows a stream in a task no view owns. iOS gets a little background time
    /// to finish it; if it is cut anyway, `resume()` re-attaches on return.
    private func start(_ open: @escaping () -> AsyncThrowingStream<AgentStreamEvent, Error>) {
        followTask?.cancel()
        streaming = true
        followTask = Task { [weak self] in
            let background = await UIApplication.shared.beginBackgroundTask(withName: "coach-turn")
            await self?.follow(open())
            await UIApplication.shared.endBackgroundTask(background)
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
            messages = detail.messages
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
        switch event {
        case .start:
            // Ids stay local so rows keep their identity; a reload brings the server's.
            break
        case let .text(delta):
            messages[index].text += delta
        case let .tool(name, status, result):
            if let i = messages[index].tools.lastIndex(where: { $0.name == name && $0.status == .running }), status != .running {
                messages[index].tools[i].status = status
                messages[index].tools[i].result = result
            } else if status == .running {
                messages[index].tools.append(AgentToolUse(name: name, status: status))
            }
        case .done:
            messages[index].status = .done
            for i in messages[index].tools.indices where messages[index].tools[i].status == .running {
                messages[index].tools[i].status = .done
            }
        case let .error(message):
            messages[index].status = .error
            messages[index].error = message
        case .unknown:
            break
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
