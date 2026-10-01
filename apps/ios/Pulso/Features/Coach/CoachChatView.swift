import SwiftUI

/// One conversation with the Coach: streaming replies, tool activity, a glass composer.
/// Assistant text runs full width like a document; the person's messages are accent
/// bubbles. Nothing sits under the composer: it is a bottom inset, and the tab bar
/// is hidden while a conversation is open.
struct CoachChatView: View {
    @State private var store: ChatStore
    private let initialTitle: String?
    private let starter: String?
    private let focusOnAppear: Bool
    @State private var draft: String
    @State private var started = false
    @State private var position = ScrollPosition(edge: .bottom)
    /// The person is reading the latest lines: streaming text keeps them in view.
    @State private var atBottom = true
    @FocusState private var composing: Bool

    /// Comfortable reading width; only matters on wide screens.
    private static let readableWidth: CGFloat = 680

    /// `starter` is sent at once; `draft` waits in the composer. Either, or `focus`, opens the keyboard.
    init(threadId: String?, title: String?, starter: String? = nil, draft: String? = nil, focus: Bool = false) {
        _store = State(initialValue: ChatStore(threadId: threadId))
        _draft = State(initialValue: draft ?? "")
        initialTitle = title
        self.starter = starter
        focusOnAppear = focus || draft != nil
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                if store.messages.isEmpty && !store.loading {
                    CoachWelcome(title: "¿En qué te ayudo?", subtitle: "Pregúntame por tu entrenamiento, tu dieta o tu progreso.") { send($0) }
                        .padding(.top, 48)
                }
                ForEach(store.messages) { message in
                    MessageRow(message: message)
                        .transition(.asymmetric(insertion: .opacity.combined(with: .move(edge: .bottom)), removal: .opacity))
                }
                if let error = store.error {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: Self.readableWidth)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, Theme.padding + 4)
            .padding(.top, 12)
            .padding(.bottom, 16)
            .animation(.snappy, value: store.messages.count)
        }
        .scrollPosition($position)
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.y + geometry.containerSize.height - geometry.contentInsets.bottom >= geometry.contentSize.height - 60
        } action: { _, bottom in
            atBottom = bottom
        }
        .overlay {
            if store.loading { ProgressView().controlSize(.large) }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Composer(draft: $draft, streaming: store.streaming, focused: $composing) { send(draft) }
                .overlay(alignment: .top) {
                    if !atBottom && !store.messages.isEmpty {
                        Button("Ir al final", systemImage: "arrow.down") { scrollToBottom() }
                            .labelStyle(.iconOnly)
                            .font(.body.weight(.semibold))
                            .buttonStyle(.glass)
                            .buttonBorderShape(.circle)
                            .offset(y: -52)
                            .transition(.scale.combined(with: .opacity))
                    }
                }
                .animation(.snappy, value: atBottom)
        }
        .toolbarVisibility(.hidden, for: .tabBar)
        .navigationTitle(store.title ?? initialTitle ?? "Nueva conversación")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarTitleDisplayMode(.inline)
        .sensoryFeedback(.impact(weight: .medium), trigger: store.sentCount)
        .sensoryFeedback(.success, trigger: store.finishedCount)
        // A new message, or the keyboard opening, brings the end into view.
        .onChange(of: store.messages.count) { scrollToBottom() }
        .onChange(of: composing) { _, focused in if focused { scrollToBottom() } }
        .onChange(of: store.messages.last?.text) {
            if atBottom { position.scrollTo(edge: .bottom) }
        }
        .task {
            guard !started else { return }
            started = true
            await store.load()
            scrollToBottom(animated: false)
            if let starter, store.messages.isEmpty { await store.send(starter) }
            if focusOnAppear { composing = true }
        }
        .refreshable { await store.load() }
    }

    private func send(_ text: String) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !store.streaming else { return }
        draft = ""
        Task { await store.send(text) }
    }

    private func scrollToBottom(animated: Bool = true) {
        atBottom = true
        if animated {
            withAnimation(.snappy) { position.scrollTo(edge: .bottom) }
        } else {
            position.scrollTo(edge: .bottom)
        }
    }
}

private struct MessageRow: View {
    let message: AgentMessage

    var body: some View {
        switch message.role {
        case .user:
            HStack {
                Spacer(minLength: 48)
                Text(message.text)
                    .lineSpacing(2)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .background(Color.accentColor.gradient, in: UnevenRoundedRectangle(topLeadingRadius: 22, bottomLeadingRadius: 22, bottomTrailingRadius: 6, topTrailingRadius: 22, style: .continuous))
                    .contentShape(.contextMenuPreview, UnevenRoundedRectangle(topLeadingRadius: 22, bottomLeadingRadius: 22, bottomTrailingRadius: 6, topTrailingRadius: 22, style: .continuous))
                    .contextMenu { MessageActions(text: message.text) }
            }
        case .assistant:
            AssistantRow(message: message)
        }
    }
}

/// Copy and share, for the context menu.
private struct MessageActions: View {
    let text: String

    var body: some View {
        Button("Copiar", systemImage: "doc.on.doc") { UIPasteboard.general.string = text }
        ShareLink(item: text) { Label("Compartir", systemImage: "square.and.arrow.up") }
    }
}

private struct AssistantRow: View {
    let message: AgentMessage
    @State private var copied = 0

    private var streaming: Bool { message.status == .streaming }
    private var thinking: Bool { streaming && message.text.isEmpty && !message.tools.contains { $0.status == .running } }
    /// Tools that made something get a card; the rest show as activity chips.
    private var activity: [AgentToolUse] { message.tools.filter { $0.result == nil || $0.status != .done } }
    private var results: [AgentToolResult] { message.tools.compactMap { $0.status == .done ? $0.result : nil } }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !activity.isEmpty {
                GlassEffectContainer(spacing: 6) {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(activity.enumerated()), id: \.offset) { _, tool in
                            ToolChip(tool: tool).transition(.blurReplace)
                        }
                    }
                }
            }
            if thinking {
                HStack(spacing: 10) {
                    CoachAvatar(size: 28, active: true)
                    ThinkingDots()
                }
                .transition(.blurReplace)
            }
            if !message.text.isEmpty {
                CoachMarkdown(text: message.text)
                    .textSelection(.enabled)
                    .contextMenu { MessageActions(text: message.text) }
            }
            ForEach(Array(results.enumerated()), id: \.offset) { _, result in
                CoachResultCard(result: result).transition(.scale(scale: 0.95).combined(with: .opacity))
            }
            if message.status == .error {
                Label(message.error ?? "El Coach no pudo responder.", systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
            if message.status == .done && !message.text.isEmpty {
                HStack(spacing: 18) {
                    Button("Copiar", systemImage: copied > 0 ? "checkmark" : "doc.on.doc") {
                        UIPasteboard.general.string = message.text
                        copied += 1
                    }
                    .contentTransition(.symbolEffect(.replace))
                    ShareLink(item: message.text) { Label("Compartir", systemImage: "square.and.arrow.up") }
                }
                .labelStyle(.iconOnly)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .buttonStyle(.plain)
                .sensoryFeedback(.success, trigger: copied)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(.snappy, value: message.tools)
        .animation(.snappy, value: thinking)
    }
}

private struct Composer: View {
    @Binding var draft: String
    let streaming: Bool
    var focused: FocusState<Bool>.Binding
    let onSend: () -> Void

    private var canSend: Bool { !streaming && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(alignment: .bottom, spacing: 10) {
                TextField(streaming ? "El Coach está respondiendo…" : "Pregúntale a tu coach…", text: $draft, axis: .vertical)
                    .lineLimit(1...6)
                    .focused(focused)
                    .submitLabel(.send)
                    .onSubmit { if canSend { onSend() } }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 13)
                    .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 24))
                    .overlay {
                        if streaming { GlowBorder(shape: RoundedRectangle(cornerRadius: 24, style: .continuous)).transition(.opacity) }
                    }

                Button(action: onSend) {
                    Image(systemName: streaming ? "ellipsis" : "arrow.up")
                        .font(.body.weight(.bold))
                        .symbolEffect(.variableColor.iterative, options: .repeating, isActive: streaming)
                        .contentTransition(.symbolEffect(.replace))
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.circle)
                .disabled(!canSend && !streaming)
                .allowsHitTesting(canSend)
                .accessibilityLabel("Enviar")
            }
        }
        .padding(.horizontal, Theme.padding)
        .padding(.top, 10)
        .padding(.bottom, 8)
        // Text scrolling under the composer fades out instead of showing through the glass.
        .background {
            LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: Color(.systemBackground), location: 0.4)], startPoint: .top, endPoint: .bottom)
                .padding(.top, -20)
                .ignoresSafeArea(edges: .bottom)
                .allowsHitTesting(false)
        }
        .animation(.snappy, value: streaming)
        .animation(.snappy, value: canSend)
    }
}
