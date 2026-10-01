import Foundation
import Observation

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
        do {
            try await api.deleteAgentThread(thread.id)
        } catch {
            PulsoModel.shared.handle(error)
            await refresh()
        }
    }
}

/// One conversation: its messages and the turn being streamed, if any.
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

    init(threadId: String?) {
        self.threadId = threadId
    }

    func load() async {
        guard let api = PulsoModel.shared.api, let threadId, !streaming else { return }
        loading = messages.isEmpty
        defer { loading = false }
        do {
            let detail = try await api.agentThread(threadId)
            title = detail.thread.title
            messages = detail.messages
            if detail.running, let last = messages.indices.last, messages[last].status == .streaming {
                // The re-attached stream replays the turn from its start.
                messages[last].text = ""
                messages[last].tools = []
                await follow(api.attachAgentTurn(threadId: threadId))
            }
        } catch {
            PulsoModel.shared.handle(error)
        }
    }

    func send(_ raw: String) async {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let api = PulsoModel.shared.api, !text.isEmpty, !streaming else { return }
        error = nil
        sentCount += 1
        let now = Date().timeIntervalSince1970 * 1000
        let local = "local-\(UUID().uuidString)"
        messages.append(AgentMessage(id: "\(local)-user", threadId: threadId ?? "", role: .user, text: text, tools: [], status: .done, error: nil, createdAt: now))
        messages.append(AgentMessage(id: local, threadId: threadId ?? "", role: .assistant, text: "", tools: [], status: .streaming, error: nil, createdAt: now))
        streaming = true
        do {
            if threadId == nil {
                let thread = try await api.createAgentThread()
                threadId = thread.id
            }
            await follow(api.sendAgentMessage(threadId: threadId!, text: text))
        } catch {
            streaming = false
            fail(error.localizedDescription)
        }
    }

    /// Applies a turn's events to the last assistant message. If the connection
    /// drops mid-turn the turn keeps running on the Mac, so re-read the thread.
    private func follow(_ stream: AsyncThrowingStream<AgentStreamEvent, Error>) async {
        streaming = true
        if messages.last?.role != .assistant || messages.last?.status != .streaming {
            messages.append(AgentMessage(id: "local-\(UUID().uuidString)", threadId: threadId ?? "", role: .assistant, text: "", tools: [], status: .streaming, error: nil, createdAt: Date().timeIntervalSince1970 * 1000))
        }
        var finished = false
        do {
            for try await event in stream {
                apply(event)
                if case .done = event { finished = true }
                if case .error = event { finished = true }
            }
        } catch {
            PulsoModel.shared.handle(error)
        }
        streaming = false
        if !finished {
            // Lost the stream: what the Mac saved is the truth.
            if let api = PulsoModel.shared.api, let threadId, let detail = try? await api.agentThread(threadId) {
                messages = detail.messages
                title = detail.thread.title
                if detail.running { error = "La respuesta sigue en curso en tu Mac. Desliza hacia abajo para actualizar." }
            } else {
                fail("Se cortó la conexión. La respuesta se guardará en tu Mac.")
            }
        } else if let api = PulsoModel.shared.api, let threadId, let detail = try? await api.agentThread(threadId) {
            title = detail.thread.title
        }
        finishedCount += 1
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
