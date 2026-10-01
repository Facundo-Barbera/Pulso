import Foundation

/// A Coach conversation (`@pulso/contract` `AgentThread`). Times are epoch milliseconds.
struct AgentThread: Codable, Identifiable, Equatable, Hashable {
    var id: String
    var title: String
    var createdAt: Double
    var updatedAt: Double
    var preview: String?
}

/// What a tool created or changed (`AgentToolResult`), shown as a card that opens its tab.
struct AgentToolResult: Codable, Equatable {
    var title: String
    var detail: String?
    /// "hoy", "entreno", "dieta" or "cuerpo".
    var tab: String
}

struct AgentToolUse: Codable, Equatable {
    enum Status: String, Codable { case running, done, error }
    var name: String
    var status: Status
    var result: AgentToolResult? = nil
}

struct AgentMessage: Codable, Identifiable, Equatable {
    enum Role: String, Codable { case user, assistant }
    enum Status: String, Codable { case streaming, done, error }
    var id: String
    var threadId: String
    var role: Role
    var text: String
    var tools: [AgentToolUse]
    var status: Status
    var error: String?
    var createdAt: Double
}

/// One NDJSON line of a turn (`AgentStreamEvent`).
enum AgentStreamEvent: Decodable, Equatable {
    case start(messageId: String, userMessageId: String)
    case text(String)
    case tool(name: String, status: AgentToolUse.Status, result: AgentToolResult? = nil)
    case done(messageId: String)
    case error(String)
    case unknown

    private enum Keys: String, CodingKey { case type, messageId, userMessageId, delta, name, status, result, message }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "start": self = .start(messageId: try c.decode(String.self, forKey: .messageId), userMessageId: try c.decode(String.self, forKey: .userMessageId))
        case "text": self = .text(try c.decode(String.self, forKey: .delta))
        case "tool":
            // An unreadable result only loses the card, never the event.
            self = .tool(name: try c.decode(String.self, forKey: .name), status: try c.decode(AgentToolUse.Status.self, forKey: .status), result: try? c.decodeIfPresent(AgentToolResult.self, forKey: .result))
        case "done": self = .done(messageId: try c.decode(String.self, forKey: .messageId))
        case "error": self = .error(try c.decode(String.self, forKey: .message))
        default: self = .unknown
        }
    }
}

struct AgentThreadDetail: Decodable {
    var thread: AgentThread
    var messages: [AgentMessage]
    var running: Bool
}

extension PulsoAPI {
    private struct ThreadsResponse: Decodable { var threads: [AgentThread] }
    private struct ThreadResponse: Decodable { var thread: AgentThread }

    /// Turns can sit quiet for a while (tools, web search), so streams get long timeouts.
    private static let streamSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 300
        config.timeoutIntervalForResource = 20 * 60
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    func agentThreads() async throws -> [AgentThread] {
        let response: ThreadsResponse = try await call("api/mobile/agent/threads", method: "GET")
        return response.threads
    }

    func createAgentThread() async throws -> AgentThread {
        let response: ThreadResponse = try await call("api/mobile/agent/threads", method: "POST")
        return response.thread
    }

    func agentThread(_ id: String) async throws -> AgentThreadDetail {
        try await call("api/mobile/agent/threads/\(id)", method: "GET")
    }

    func deleteAgentThread(_ id: String) async throws {
        let request = makeRequest("api/mobile/agent/threads/\(id)", method: "DELETE")
        let (data, response) = try await Self.streamSession.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw Self.failure(status: status, data: data) }
    }

    /// Sends a message and streams the Coach's turn.
    func sendAgentMessage(threadId: String, text: String) -> AsyncThrowingStream<AgentStreamEvent, Error> {
        var request = makeRequest("api/mobile/agent/threads/\(threadId)/messages", method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONEncoder().encode(["text": text])
        return events(request)
    }

    /// Re-attaches to the turn still running in a thread, replayed from its start.
    func attachAgentTurn(threadId: String) -> AsyncThrowingStream<AgentStreamEvent, Error> {
        events(makeRequest("api/mobile/agent/threads/\(threadId)/turn", method: "GET"))
    }

    private func events(_ request: URLRequest) -> AsyncThrowingStream<AgentStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (bytes, response) = try await Self.streamSession.bytes(for: request)
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    guard (200..<300).contains(status) else {
                        var data = Data()
                        for try await byte in bytes { data.append(byte) }
                        throw Self.failure(status: status, data: data)
                    }
                    for try await line in bytes.lines where !line.isEmpty {
                        continuation.yield(try JSONDecoder().decode(AgentStreamEvent.self, from: Data(line.utf8)))
                    }
                    continuation.finish()
                } catch let failure as Failure {
                    continuation.finish(throwing: failure)
                } catch {
                    continuation.finish(throwing: Failure(kind: .transport, message: "Se cortó la conexión con la Mac."))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
