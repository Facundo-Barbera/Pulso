import Foundation

/// A Coach thread (`@pulso/contract` `AgentThread`): the live-workout chat; the Coach tab reads the one conversation. Times are epoch milliseconds.
struct AgentThread: Codable, Identifiable, Equatable, Hashable {
    var id: String
    var title: String
    var createdAt: Double
    var updatedAt: Double
    var preview: String?
}

/// One line of an action card (`AgentActionLine`): "Objetivo: Bajar de peso → Bajar 10 kg de grasa".
struct AgentActionLine: Codable, Equatable {
    var label: String?
    /// What it was, when the change replaced a value.
    var before: String?
    var value: String
}

/// What a tool created or changed (`AgentToolResult`), shown as an action card.
struct AgentToolResult: Codable, Equatable {
    var title: String
    var detail: String?
    /// "hoy", "entreno", "dieta" or "cuerpo".
    var tab: String
    /// "medicacion" or "perfil": a screen inside `tab`, when there is one.
    var place: String? = nil
    /// What changed, before → after where it applies. Missing on older messages.
    var lines: [AgentActionLine]? = nil
    /// "available" while Deshacer works, "done" once undone; nil when it can't be undone.
    var undo: String? = nil

    var undoable: Bool { undo == "available" }
    var undone: Bool { undo == "done" }
    /// The lines, or the old one-line detail.
    var shownLines: [AgentActionLine] { lines ?? detail.map { [AgentActionLine(value: $0)] } ?? [] }
}

struct AgentToolUse: Codable, Equatable {
    enum Status: String, Codable { case running, done, error }
    var name: String
    var status: Status
    /// "write" for tools that change the person's data, "read" for lookups. Missing on older messages.
    var access: String? = nil
    var result: AgentToolResult? = nil

    /// It changed something: a card, not a quiet chip.
    var isAction: Bool { access == "write" || result != nil }
}

/// A photo the person sent (`AgentAttachment`): a JPEG on the Mac, at most 1600 px on its long edge.
struct AgentAttachment: Codable, Identifiable, Equatable, Hashable {
    var id: String
    var mime: String = "image/jpeg"
    var width: Double
    var height: Double
}

/// A packaged product scanned into a message (`AgentProduct`): its code and what
/// Open Food Facts said about it when it was sent (nil when unknown or unreachable).
struct AgentProduct: Codable, Equatable {
    static let limit = 4
    var barcode: String
    var product: FoodProduct?
}

/// A brief or review the app quoted into the conversation (`AgentMessageSource`): the person is answering it.
struct AgentMessageSource: Codable, Equatable {
    var kind: String
    var title: String
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
    /// Photos on a user message, in the order they were sent.
    var attachments: [AgentAttachment] = []
    /// Scanned products on a user message, in the order they were added.
    var products: [AgentProduct] = []
    /// In the conversation, the context (SDK session) it belongs to.
    var contextId: String? = nil
    var source: AgentMessageSource? = nil
}

extension AgentMessage {
    private enum Keys: String, CodingKey { case id, threadId, role, text, tools, status, error, createdAt, attachments, products, contextId, source }

    /// `attachments` and `products` may be missing (an engine from before them).
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        id = try c.decode(String.self, forKey: .id)
        threadId = try c.decode(String.self, forKey: .threadId)
        role = try c.decode(Role.self, forKey: .role)
        text = try c.decode(String.self, forKey: .text)
        tools = try c.decode([AgentToolUse].self, forKey: .tools)
        status = try c.decode(Status.self, forKey: .status)
        error = try c.decodeIfPresent(String.self, forKey: .error)
        createdAt = try c.decode(Double.self, forKey: .createdAt)
        attachments = try c.decodeIfPresent([AgentAttachment].self, forKey: .attachments) ?? []
        products = try c.decodeIfPresent([AgentProduct].self, forKey: .products) ?? []
        contextId = try c.decodeIfPresent(String.self, forKey: .contextId)
        source = try? c.decodeIfPresent(AgentMessageSource.self, forKey: .source)
    }
}

/// One NDJSON line of a turn (`AgentStreamEvent`).
enum AgentStreamEvent: Decodable, Equatable {
    case start(messageId: String, userMessageId: String)
    case text(String)
    case tool(name: String, status: AgentToolUse.Status, access: String? = nil, result: AgentToolResult? = nil)
    case done(messageId: String)
    case error(String)
    /// The SDK is summarizing the context to make room (true), or stopped (false).
    case compacting(Bool)
    /// The context was summarized: its marker is in the feed once the turn ends.
    case compacted
    case unknown

    private enum Keys: String, CodingKey { case type, messageId, userMessageId, delta, name, status, access, result, message }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "start": self = .start(messageId: try c.decode(String.self, forKey: .messageId), userMessageId: try c.decode(String.self, forKey: .userMessageId))
        case "text": self = .text(try c.decode(String.self, forKey: .delta))
        case "tool":
            // An unreadable result only loses the card, never the event.
            self = .tool(
                name: try c.decode(String.self, forKey: .name),
                status: try c.decode(AgentToolUse.Status.self, forKey: .status),
                access: try? c.decodeIfPresent(String.self, forKey: .access),
                result: try? c.decodeIfPresent(AgentToolResult.self, forKey: .result)
            )
        case "done": self = .done(messageId: try c.decode(String.self, forKey: .messageId))
        case "error": self = .error(try c.decode(String.self, forKey: .message))
        case "status": self = .compacting((try? c.decodeIfPresent(String.self, forKey: .status)) == "compacting")
        case "compacted": self = .compacted
        default: self = .unknown
        }
    }
}

struct AgentThreadDetail: Decodable {
    var thread: AgentThread
    var messages: [AgentMessage]
    var running: Bool
}

/// One context of the conversation (`AgentContext`): one SDK session.
struct AgentContext: Codable, Identifiable, Equatable {
    var id: String
    var startedAt: Double
    var lastMessageAt: Double?
    var messageCount: Int
    var active: Bool
}

/// A quiet line in the feed (`AgentFeedMarker`).
struct AgentFeedMarker: Codable, Identifiable, Equatable {
    enum Kind: String, Codable { case context, `switch`, compacted, distilled, unknown }
    var id: String
    var kind: Kind
    var contextId: String
    var createdAt: Double

    private enum Keys: String, CodingKey { case id, kind, contextId, createdAt }

    init(id: String, kind: Kind, contextId: String, createdAt: Double) {
        self.id = id
        self.kind = kind
        self.contextId = contextId
        self.createdAt = createdAt
    }

    /// A kind this build doesn't know still decodes, as a plain line.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = Kind(rawValue: try c.decode(String.self, forKey: .kind)) ?? .unknown
        contextId = try c.decode(String.self, forKey: .contextId)
        createdAt = try c.decode(Double.self, forKey: .createdAt)
    }
}

/// A row of the feed (`AgentFeedItem`): a message or a marker.
enum AgentFeedItem: Decodable, Identifiable, Equatable {
    case message(AgentMessage)
    case marker(AgentFeedMarker)

    private enum Keys: String, CodingKey { case type, message, marker }

    var id: String {
        switch self {
        case let .message(message): message.id
        case let .marker(marker): "marker:\(marker.id)"
        }
    }

    var message: AgentMessage? {
        if case let .message(message) = self { return message }
        return nil
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        if try c.decode(String.self, forKey: .type) == "marker" {
            self = .marker(try c.decode(AgentFeedMarker.self, forKey: .marker))
        } else {
            self = .message(try c.decode(AgentMessage.self, forKey: .message))
        }
    }
}

/// A page of the Coach's one conversation (`AgentConversation`), oldest first.
struct AgentConversation: Decodable {
    var threadId: String
    var activeContextId: String
    /// Newest first.
    var contexts: [AgentContext]
    var items: [AgentFeedItem]
    /// Cursor for the page before this one; nil at the start.
    var before: String?
    var running: Bool
    var compacting: Bool
}

extension PulsoAPI {
    /// Turns can sit quiet for a while (tools, web search), so streams get long timeouts.
    private static let streamSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 300
        config.timeoutIntervalForResource = 20 * 60
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    /// The latest page of the conversation, or the one before `before`.
    func conversation(before: String? = nil) async throws -> AgentConversation {
        var request = makeRequest("api/mobile/agent/conversation", method: "GET")
        if let before { request.url = request.url?.appending(queryItems: [URLQueryItem(name: "before", value: before)]) }
        return try await perform(request)
    }

    /// «Contexto nuevo»; answers with the latest page.
    func newConversationContext() async throws -> AgentConversation {
        try await call("api/mobile/agent/conversation/contexts", method: "POST")
    }

    /// «Volver a este contexto»; answers with the latest page.
    func switchConversationContext(_ id: String) async throws -> AgentConversation {
        try await call("api/mobile/agent/conversation/contexts/\(id)", method: "POST")
    }

    /// Sends a message into the conversation's active context and streams the Coach's turn.
    func sendConversationMessage(text: String, photos: [Data] = [], barcodes: [String] = []) -> AsyncThrowingStream<AgentStreamEvent, Error> {
        events(messageRequest("api/mobile/agent/conversation/messages", text: text, photos: photos, barcodes: barcodes))
    }

    /// Re-attaches to the conversation's turn in flight, replayed from its start.
    func attachConversationTurn() -> AsyncThrowingStream<AgentStreamEvent, Error> {
        events(makeRequest("api/mobile/agent/conversation/turn", method: "GET"))
    }

    func agentThread(_ id: String) async throws -> AgentThreadDetail {
        try await call("api/mobile/agent/threads/\(id)", method: "GET")
    }

    /// Deshacer on an action card: tool `index` of the message. Returns the message with that card undone.
    func undoAgentAction(threadId: String, messageId: String, index: Int) async throws -> AgentMessage {
        struct Response: Decodable { var message: AgentMessage }
        let response: Response = try await call("api/mobile/agent/threads/\(threadId)/messages/\(messageId)/tools/\(index)/undo", method: "POST")
        return response.message
    }

    /// Sends a message to a thread (the live-workout chat), with up to four JPEG photos and four
    /// scanned barcodes, and streams the Coach's turn. The engine looks each barcode up itself.
    func sendAgentMessage(threadId: String, text: String, photos: [Data] = [], barcodes: [String] = []) -> AsyncThrowingStream<AgentStreamEvent, Error> {
        events(messageRequest("api/mobile/agent/threads/\(threadId)/messages", text: text, photos: photos, barcodes: barcodes))
    }

    private func messageRequest(_ path: String, text: String, photos: [Data], barcodes: [String]) -> URLRequest {
        struct Body: Encodable { var text: String; var barcodes: [String]? }
        var request = makeRequest(path, method: "POST")
        if photos.isEmpty {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try? JSONEncoder().encode(Body(text: text, barcodes: barcodes.isEmpty ? nil : barcodes))
        } else {
            let boundary = "pulso-\(UUID().uuidString)"
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "content-type")
            request.httpBody = Self.multipart(text: text, photos: photos, barcodes: barcodes, boundary: boundary)
        }
        return request
    }

    /// The form the engine reads: a `text` field, one `barcode` field per product and one `image` file per photo.
    static func multipart(text: String, photos: [Data], barcodes: [String] = [], boundary: String) -> Data {
        var body = Data()
        func line(_ string: String) { body.append(Data("\(string)\r\n".utf8)) }
        func field(_ name: String, _ value: String) {
            line("--\(boundary)")
            line(#"Content-Disposition: form-data; name="\#(name)""#)
            line("")
            line(value)
        }
        field("text", text)
        for barcode in barcodes { field("barcode", barcode) }
        for (index, photo) in photos.enumerated() {
            line("--\(boundary)")
            line(#"Content-Disposition: form-data; name="image"; filename="foto-\#(index + 1).jpg""#)
            line("Content-Type: image/jpeg")
            line("")
            body.append(photo)
            line("")
        }
        line("--\(boundary)--")
        return body
    }

    /// A photo sent in a thread, as a JPEG.
    func agentAttachment(threadId: String, id: String) async throws -> Data {
        let (data, response) = try await Self.streamSession.data(for: makeRequest("api/mobile/agent/threads/\(threadId)/attachments/\(id)", method: "GET"))
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw Self.failure(status: status, data: data) }
        return data
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
