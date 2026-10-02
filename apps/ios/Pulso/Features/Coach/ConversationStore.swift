import Foundation
import Observation
import UIKit
import UserNotifications

/// The Coach tab's one conversation: a feed of messages and quiet markers,
/// split into contexts, paged from the newest.
///
/// The turn runs on the Mac to the end whatever the phone does, so the phone only
/// has to keep up: the store is shared (a reply keeps streaming while the person
/// is in another tab), streams run in tasks no view owns, a lost stream
/// re-attaches by itself, and coming back to the app picks up where it left off.
@MainActor
@Observable
final class ConversationStore {
    static let shared = ConversationStore()

    private(set) var items: [AgentFeedItem] = []
    private(set) var contexts: [AgentContext] = []
    private(set) var activeContextId: String?
    private(set) var threadId: String?
    /// Cursor for the page above what is shown; nil at the start of the conversation.
    private(set) var before: String?
    private(set) var loadingOlder = false
    private(set) var loaded = false
    private(set) var loading = false
    private(set) var streaming = false
    /// The Coach is summarizing the context (in a turn, or the hourly summary).
    private(set) var compacting = false
    var error: String?
    /// Bumped on send and on finish; the views hang haptics off them.
    private(set) var sentCount = 0
    private(set) var finishedCount = 0
    @ObservationIgnored private var followTask: Task<Void, Never>?
    /// Rows written on the phone keep a local id (row identity): local → the Mac's (Deshacer names it) and back.
    @ObservationIgnored private var serverIds: [String: String] = [:]
    @ObservationIgnored private var localOf: [String: String] = [:]
    @ObservationIgnored private var compactedInTurn = false

    var isEmpty: Bool { !items.contains { $0.message != nil } }
    /// Earlier contexts with something in them, newest first: where «Volver a» can go.
    var pastContexts: [AgentContext] { contexts.filter { !$0.active && $0.messageCount > 0 } }

    func startedAt(_ contextId: String) -> Date? {
        contexts.first { $0.id == contextId }.map { Date(timeIntervalSince1970: $0.startedAt / 1000) }
    }

    /// Re-reads the latest page unless a stream is live; attaches to a running turn.
    func resume() {
        guard followTask == nil else { return }
        Task { await load() }
    }

    func load() async {
        guard let api = PulsoModel.shared.api, followTask == nil else { return }
        loading = !loaded
        defer { loading = false }
        do {
            let page = try await api.conversation()
            guard followTask == nil else { return }
            if take(page) { start { api.attachConversationTurn() } }
        } catch {
            PulsoModel.shared.handle(error)
        }
    }

    /// The page above what is shown.
    func loadOlder() async {
        guard let api = PulsoModel.shared.api, let before, !loadingOlder else { return }
        loadingOlder = true
        defer { loadingOlder = false }
        do {
            let page = try await api.conversation(before: before)
            items = AgentFeedItem.prependingOlder(page.items, to: items)
            self.before = page.before
        } catch {
            PulsoModel.shared.handle(error)
        }
    }

    /// The Mac's latest page over what is shown. True when a turn is in flight to re-attach to.
    @discardableResult
    private func take(_ page: AgentConversation) -> Bool {
        let (merged, continuous) = AgentFeedItem.mergingLatest(page.items, into: items, localOf: localOf)
        var next = merged
        var attach = false
        if page.running, let index = next.lastIndex(where: { $0.message != nil }), var last = next[index].message, last.role == .assistant, last.status == .streaming {
            // The re-attached stream replays the turn from its start.
            last.text = ""
            last.tools = []
            next[index] = .message(last)
            attach = true
        }
        if !(continuous && next.count > page.items.count) { before = page.before }
        items = next
        contexts = page.contexts
        activeContextId = page.activeContextId
        threadId = page.threadId
        compacting = page.compacting
        loaded = true
        return attach
    }

    func send(_ raw: String, photos: [ChatPhoto] = [], products: [AgentProduct] = []) async {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let api = PulsoModel.shared.api, !text.isEmpty || !photos.isEmpty || !products.isEmpty, !streaming else { return }
        error = nil
        sentCount += 1
        let now = Date().timeIntervalSince1970 * 1000
        let local = "local-\(UUID().uuidString)"
        CoachPhotoCache.shared.remember(photos)
        items.append(.message(AgentMessage(id: "\(local)-user", threadId: threadId ?? "", role: .user, text: text, tools: [], status: .done, error: nil, createdAt: now,
                                           attachments: photos.map(\.attachment), products: products, contextId: activeContextId)))
        items.append(.message(AgentMessage(id: local, threadId: threadId ?? "", role: .assistant, text: "", tools: [], status: .streaming, error: nil, createdAt: now, contextId: activeContextId)))
        let jpegs = photos.map(\.jpeg)
        let barcodes = products.map(\.barcode)
        start { api.sendConversationMessage(text: text, photos: jpegs, barcodes: barcodes) }
    }

    /// «Contexto nuevo», or «Volver a este contexto» with an id. Nil when it worked, else what to tell the person.
    func context(_ id: String? = nil) async -> String? {
        guard let api = PulsoModel.shared.api else { return "Empareja la app con tu Mac." }
        guard !streaming else { return "Espera a que el Coach termine de responder." }
        do {
            let page: AgentConversation
            if let id { page = try await api.switchConversationContext(id) } else { page = try await api.newConversationContext() }
            take(page)
            return nil
        } catch {
            if let failure = error as? PulsoAPI.Failure, failure.kind == .unpaired { PulsoModel.shared.handle(error) }
            return error.localizedDescription
        }
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

    /// Applies a turn's events to the reply being written. A lost stream re-attaches
    /// while the Mac is still answering; otherwise the saved feed wins.
    private func follow(_ stream: AsyncThrowingStream<AgentStreamEvent, Error>) async {
        compactedInTurn = false
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
                // Nothing reached the Mac: the message wasn't sent.
                if waitingForStart {
                    fail(error.localizedDescription)
                    finished = true
                    break
                }
                // Dropped (background, network): not an error the person must act on.
            }
            guard !finished, !Task.isCancelled, let api = PulsoModel.shared.api else { break }
            // Lost the stream: what the Mac saved is the truth; if it's still answering, follow again.
            guard let page = try? await api.conversation() else {
                attempts += 1
                if attempts > 5 { break }
                try? await Task.sleep(for: .seconds(2))
                continue
            }
            guard take(page) else {
                finished = true
                break
            }
            attempts = 0
            stream = api.attachConversationTurn()
        }
        streaming = false
        compacting = false
        if !finished, !Task.isCancelled, let last = items.last(where: { $0.message != nil })?.message, last.status == .streaming {
            // Couldn't reach the Mac: the reply is safe there and loads on return.
            error = "Sin conexión con la Mac. La respuesta sigue guardándose allá y aparecerá al volver."
        }
        // The summary's marker and the contexts' counts.
        if finished, compactedInTurn, let api = PulsoModel.shared.api, let page = try? await api.conversation() { take(page) }
        if finished, UIApplication.shared.applicationState != .active, let reply = items.last?.message, reply.role == .assistant, reply.status == .done {
            notifyReply(reply.text)
        }
        finishedCount += 1
    }

    /// The send's placeholders haven't been named by the Mac's `start` yet.
    private var waitingForStart: Bool {
        guard let last = items.last?.message else { return false }
        return last.id.hasPrefix("local-") && serverIds[last.id] == nil
    }

    private func apply(_ event: AgentStreamEvent) {
        switch event {
        case let .start(messageId, userMessageId):
            // Ids stay local so rows keep their identity; the Mac's are remembered for undo and reloads.
            let messages = items.compactMap(\.message)
            for (local, server) in [(messages.last, messageId), (messages.dropLast().last, userMessageId)] {
                guard let local, local.id.hasPrefix("local-") else { continue }
                serverIds[local.id] = server
                localOf[server] = local.id
            }
            return
        case let .compacting(on):
            compacting = on
            return
        case .compacted:
            compactedInTurn = true
            return
        default:
            break
        }
        guard let index = items.lastIndex(where: { $0.message != nil }), var last = items[index].message, last.role == .assistant else { return }
        last.apply(event)
        items[index] = .message(last)
    }

    /// A local notice when the reply lands while the person is in another app.
    private func notifyReply(_ text: String) {
        let content = UNMutableNotificationContent()
        content.title = "Coach"
        content.body = String(text.replacingOccurrences(of: #"[*_`#>|]+"#, with: "", options: .regularExpression).prefix(180))
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "coach-\(threadId ?? "conversation")", content: content, trigger: nil))
    }

    /// Deshacer on an action card: the Mac puts the change back and the card shows it undone.
    /// Nil when it worked, else what to tell the person.
    func undo(_ message: AgentMessage, index: Int) async -> String? {
        guard let api = PulsoModel.shared.api, let threadId else { return "Empareja la app con tu Mac." }
        let messageId = serverIds[message.id] ?? message.id
        guard !messageId.hasPrefix("local-") else { return "Esta respuesta todavía no está en la Mac." }
        do {
            var saved = try await api.undoAgentAction(threadId: threadId, messageId: messageId, index: index)
            saved.id = message.id
            if let i = items.firstIndex(where: { $0.id == message.id }) { items[i] = .message(saved) }
            return nil
        } catch {
            if let failure = error as? PulsoAPI.Failure, failure.kind == .unpaired { PulsoModel.shared.handle(error) }
            return error.localizedDescription
        }
    }

    /// Nothing reached the Mac: the two placeholders go and the error shows instead.
    private func fail(_ message: String) {
        if items.count >= 2, items.suffix(2).allSatisfy({ $0.message?.id.hasPrefix("local-") == true }) { items.removeLast(2) }
        error = message
    }
}

extension AgentFeedItem {
    /// The latest page from the Mac over what is on screen. Messages sent from the phone keep their
    /// local id (`localOf`: the Mac's id → the local one), so re-reading never re-keys rows (a lazy
    /// stack rebuilt under a bottom-pinned scroll view shows nothing until the next drag); older pages
    /// loaded before stay above it. Not `continuous` when the page doesn't reach back to what was shown.
    static func mergingLatest(_ page: [AgentFeedItem], into shown: [AgentFeedItem], localOf: [String: String]) -> (items: [AgentFeedItem], continuous: Bool) {
        let items = page.map { item -> AgentFeedItem in
            guard var message = item.message, let local = localOf[message.id] else { return item }
            message.id = local
            return .message(message)
        }
        guard let first = items.first(where: { $0.message != nil }) else { return (items, shown.isEmpty) }
        guard let at = shown.firstIndex(where: { $0.id == first.id }) else { return (items, false) }
        let ids = Set(items.map(\.id))
        return (shown[..<at].filter { !ids.contains($0.id) } + items, true)
    }

    /// An older page above what is shown; a marker on both is kept once.
    static func prependingOlder(_ older: [AgentFeedItem], to shown: [AgentFeedItem]) -> [AgentFeedItem] {
        let ids = Set(shown.map(\.id))
        return older.filter { !ids.contains($0.id) } + shown
    }
}
