import SwiftUI

/// The compact Coach chat bound to the session in progress. `onSessionChanged` runs
/// after the Coach changed the session through a tool, so the live screen can
/// pull the engine's copy, buzz and offer undo.
///
/// The thread is the engine's (one per live session); turns go through the regular
/// Coach chat store, so a reply keeps streaming if the sheet closes and is there
/// when it opens again.
struct LiveCoachSheet: View {
    let sessionId: String
    /// Name of the exercise on screen, for the "Cambiar este ejercicio" chip.
    var currentExercise: String?
    let onSessionChanged: @MainActor () async -> Void

    @State private var phase: LoadPhase<ChatStore> = .loading
    @State private var attempt = 0
    /// Session edits in the thread already passed to `onSessionChanged`.
    @State private var reported = 0

    var body: some View {
        Group {
            switch phase {
            case .loading:
                ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            case let .failed(message):
                ScrollView {
                    EmptyStateView(systemImage: "bubble.left.and.exclamationmark.bubble.right", title: "No pude abrir el Coach", message: message, tint: Theme.training, actionTitle: "Reintentar") {
                        phase = .loading
                        attempt += 1
                    }
                    .padding(.top, 24)
                }
            case let .loaded(store):
                LiveCoachThread(store: store, currentExercise: currentExercise, reported: $reported, onSessionChanged: onSessionChanged)
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task(id: attempt) { await open() }
    }

    private func open() async {
        if case .loaded = phase { return }
        guard let api = PulsoModel.shared.api else {
            phase = .failed("Empareja la app con tu Mac para hablar con el Coach.")
            return
        }
        do {
            let threadId = try await LiveCoachThreads.thread(for: sessionId, api: api)
            let store = ChatStore.store(for: threadId)
            await store.load()
            // What the Coach changed before this sheet opened is already on the live screen.
            reported = store.sessionEdits
            phase = .loaded(store)
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }
}

/// Follows a thread's store and tells the live screen when the Coach edited the session.
private struct LiveCoachThread: View {
    let store: ChatStore
    let currentExercise: String?
    @Binding var reported: Int
    let onSessionChanged: @MainActor () async -> Void

    var body: some View {
        LiveCoachChat(messages: store.messages, streaming: store.streaming, error: store.error, currentExercise: currentExercise) { text in
            Task { await store.send(text) }
        }
        // As each edit lands, and once more at the turn's end for any the stream didn't close.
        .onChange(of: store.sessionEdits) { report() }
        .onChange(of: store.finishedCount) { report() }
        .onChange(of: store.streaming) { _, streaming in if !streaming { report() } }
    }

    private func report() {
        let count = store.sessionEdits
        guard count > reported else { return }
        reported = count
        Task { await onSessionChanged() }
    }
}

// MARK: - Chat

/// The chat itself, data in and text out, so it previews without a Mac.
struct LiveCoachChat: View {
    let messages: [AgentMessage]
    let streaming: Bool
    var error: String?
    var currentExercise: String?
    let send: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var draft = ""
    @State private var sent = 0
    @State private var position = ScrollPosition(edge: .bottom)
    @FocusState private var composing: Bool

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                if messages.isEmpty {
                    Text("Pídeme cambios sin salir del entreno: otro ejercicio, menos carga o acabar antes.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(.top, 4)
                }
                ForEach(messages) { message in
                    LiveMessageRow(message: message)
                        .transition(.asymmetric(insertion: .opacity.combined(with: .move(edge: .bottom)), removal: .opacity))
                }
                if let error {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                }
            }
            .padding(.horizontal, Theme.padding)
            .padding(.vertical, 8)
            .animation(.snappy, value: messages.count)
        }
        .scrollPosition($position)
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .top, spacing: 0) { header }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 10) {
                quickPrompts
                composer
            }
            .padding(.top, 8)
            .padding(.bottom, 8)
            .background(.background)
        }
        .onChange(of: messages.count) { withAnimation(.snappy) { position.scrollTo(edge: .bottom) } }
        .onChange(of: messages.last?.text) { position.scrollTo(edge: .bottom) }
        .sensoryFeedback(.impact(weight: .light), trigger: sent)
    }

    private var header: some View {
        HStack(spacing: 10) {
            CoachAvatar(size: 32, active: streaming)
            VStack(alignment: .leading, spacing: 1) {
                Text("Coach").font(.headline)
                Text(currentExercise.map { "Ahora: \($0)" } ?? "Sesión en curso")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button("Cerrar", systemImage: "xmark") { dismiss() }
                .labelStyle(.iconOnly)
                .font(.body.weight(.semibold))
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
        }
        .padding(.horizontal, Theme.padding)
        .padding(.top, 18)
        .padding(.bottom, 8)
        .background(.background)
    }

    private var quickPrompts: some View {
        ChipRow {
            ForEach(QuickPrompt.all(for: currentExercise)) { prompt in
                Button { submit(prompt.message) } label: {
                    Label(prompt.title, systemImage: prompt.symbol)
                        .font(.subheadline.weight(.medium))
                        .lineLimit(1)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.interactive(), in: .capsule)
                .disabled(streaming)
                .opacity(streaming ? 0.5 : 1)
            }
        }
        .animation(.snappy, value: streaming)
    }

    private var canSend: Bool { !streaming && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField(streaming ? "El Coach está respondiendo…" : "Escribe o dicta…", text: $draft, axis: .vertical)
                .lineLimit(1...4)
                .focused($composing)
                .submitLabel(.send)
                .onSubmit { if canSend { submit(draft) } }
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 22))
                .overlay {
                    if streaming { GlowBorder(shape: RoundedRectangle(cornerRadius: 22, style: .continuous)).transition(.opacity) }
                }
            Button { submit(draft) } label: {
                Image(systemName: streaming ? "ellipsis" : "arrow.up")
                    .font(.body.weight(.bold))
                    .symbolEffect(.variableColor.iterative, options: .repeating, isActive: streaming)
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 26, height: 26)
            }
            .buttonStyle(.glassProminent)
            .buttonBorderShape(.circle)
            .tint(Theme.training)
            .disabled(!canSend)
            .accessibilityLabel("Enviar")
        }
        .padding(.horizontal, Theme.padding)
        .animation(.snappy, value: streaming)
    }

    private func submit(_ text: String) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !streaming else { return }
        draft = ""
        sent += 1
        send(text)
    }
}

/// One message, compact: the person's as a small bubble, the Coach's as a line or two
/// beside its mark, with a chip when it changed the session.
private struct LiveMessageRow: View {
    let message: AgentMessage

    private var thinking: Bool {
        message.status == .streaming && message.text.isEmpty && !message.tools.contains { $0.status == .running }
    }

    var body: some View {
        switch message.role {
        case .user:
            HStack {
                Spacer(minLength: 40)
                Text(message.text)
                    .font(.subheadline)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 8)
                    .background(Theme.training.gradient, in: UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 18, bottomTrailingRadius: 5, topTrailingRadius: 18, style: .continuous))
            }
        case .assistant:
            HStack(alignment: .top, spacing: 10) {
                CoachAvatar(size: 24, active: message.status == .streaming)
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(message.tools.enumerated()), id: \.offset) { _, tool in
                        if tool.name == LiveCoachTools.editSession {
                            SessionEditChip(status: tool.status)
                        } else if tool.status == .running {
                            ToolChip(tool: tool)
                        }
                    }
                    if thinking { ThinkingDots().scaleEffect(0.8, anchor: .leading) }
                    if !message.text.isEmpty {
                        CoachMarkdown(text: message.text)
                            .font(.callout)
                            .textSelection(.enabled)
                    }
                    if message.status == .error {
                        Label(message.error ?? "El Coach no pudo responder.", systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .animation(.snappy, value: message.tools)
            }
        }
    }
}

/// "Ajustando tu sesión…" → "Sesión actualizada".
private struct SessionEditChip: View {
    let status: AgentToolUse.Status

    var body: some View {
        HStack(spacing: 6) {
            Group {
                switch status {
                case .running: Image(systemName: "dumbbell.fill").symbolEffect(.pulse, options: .repeating)
                case .done: Image(systemName: "checkmark.circle.fill")
                case .error: Image(systemName: "exclamationmark.circle.fill")
                }
            }
            .foregroundStyle(status == .error ? AnyShapeStyle(.orange) : AnyShapeStyle(Theme.training))
            .contentTransition(.symbolEffect(.replace))
            Text(label)
        }
        .font(.footnote.weight(.medium))
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .glassEffect(.regular.tint(Theme.training.opacity(status == .done ? 0.2 : 0.08)), in: .capsule)
        .animation(.snappy, value: status)
    }

    private var label: String {
        switch status {
        case .running: "Ajustando tu sesión…"
        case .done: "Sesión actualizada"
        case .error: "No pude cambiar la sesión"
        }
    }
}

// MARK: - Quick prompts

struct QuickPrompt: Identifiable {
    let title: String
    let symbol: String
    let message: String
    var id: String { title }

    /// The chips over the composer, worded for `exercise` when there is one on screen.
    static func all(for exercise: String?) -> [QuickPrompt] {
        let starting = exercise.map { ", empezando por \($0)" } ?? ""
        return [
            QuickPrompt(
                title: "Cambiar este ejercicio", symbol: "arrow.triangle.2.circlepath",
                message: exercise.map { "Cámbiame \($0) por otro parecido." } ?? "Cámbiame el ejercicio actual por otro parecido."
            ),
            QuickPrompt(
                title: "Está ocupada la máquina", symbol: "hourglass",
                message: exercise.map { "Está ocupada la máquina de \($0): cámbiamelo por otro parecido." } ?? "Está ocupada la máquina: cámbiame el ejercicio actual por otro parecido."
            ),
            QuickPrompt(
                title: "Me molesta algo", symbol: "bandage",
                message: "Me molesta algo\(exercise.map { " haciendo \($0)" } ?? ""). Adapta lo que queda para no cargar esa zona y pregúntame si necesitas saber más."
            ),
            QuickPrompt(title: "Más fácil", symbol: "tortoise", message: "Hoy me está costando: hazme más fácil lo que queda\(starting)."),
            QuickPrompt(title: "Más difícil", symbol: "hare", message: "Hoy me siento fuerte: hazme más exigente lo que queda\(starting)."),
            QuickPrompt(title: "Terminar antes", symbol: "flag.checkered", message: "Tengo que terminar antes: recorta lo que queda de la sesión a lo esencial."),
        ]
    }
}

// MARK: - Engine

enum LiveCoachTools {
    /// The Coach's tool that changes the live session (names arrive without `mcp__pulso__`).
    static let editSession = "edit_live_session"
}

extension ChatStore {
    /// Finished session edits in the thread; when it grows, the live session changed.
    var sessionEdits: Int {
        messages.reduce(0) { total, message in
            total + message.tools.count { $0.name == LiveCoachTools.editSession && $0.status == .done }
        }
    }
}

/// The Coach thread of each live session, asked for once per session.
@MainActor
enum LiveCoachThreads {
    private static var bySession: [String: String] = [:]

    static func thread(for sessionId: String, api: PulsoAPI) async throws -> String {
        if let known = bySession[sessionId] { return known }
        let threadId = try await api.liveCoachThread()
        bySession[sessionId] = threadId
        return threadId
    }
}

extension PulsoAPI {
    private struct LiveCoachThreadResponse: Decodable { var threadId: String }

    /// The Coach thread bound to the live session, created on first use.
    func liveCoachThread() async throws -> String {
        let response: LiveCoachThreadResponse = try await call("api/mobile/training/live/coach", method: "POST", body: [String: String]())
        return response.threadId
    }
}

// MARK: - Previews

#if DEBUG
private extension AgentMessage {
    static func preview(_ role: Role, _ text: String, tools: [AgentToolUse] = [], status: Status = .done) -> AgentMessage {
        AgentMessage(id: UUID().uuidString, threadId: "t", role: role, text: text, tools: tools, status: status, error: nil, createdAt: 0)
    }

    static let previews: [AgentMessage] = [
        .preview(.user, "Está ocupada la máquina de Press de pecho en máquina: cámbiamelo por otro parecido."),
        .preview(.assistant, "Hecho: **Press inclinado en máquina**, 3 × 8–10 con 40 kg. Mismo músculo y sin esperar.", tools: [AgentToolUse(name: LiveCoachTools.editSession, status: .done)]),
        .preview(.user, "Me molesta un poco el hombro derecho."),
        .preview(.assistant, "", tools: [AgentToolUse(name: LiveCoachTools.editSession, status: .running)], status: .streaming),
    ]
}

private struct LiveCoachPreview: View {
    var messages = AgentMessage.previews
    var streaming = true

    var body: some View {
        LiveCoachChat(messages: messages, streaming: streaming, currentExercise: "Press de pecho en máquina") { _ in }
    }
}

#Preview("Coach en vivo · 375 pt", traits: .fixedLayout(width: 375, height: 460)) {
    LiveCoachPreview()
}

#Preview("Coach en vivo · 440 pt, claro", traits: .fixedLayout(width: 440, height: 520)) {
    LiveCoachPreview(streaming: false).preferredColorScheme(.light)
}

#Preview("Coach en vivo · XXL", traits: .fixedLayout(width: 375, height: 700)) {
    LiveCoachPreview().dynamicTypeSize(.xxLarge)
}

#Preview("Coach en vivo · vacío", traits: .fixedLayout(width: 375, height: 460)) {
    LiveCoachPreview(messages: [], streaming: false)
}
#endif
