import SwiftUI

/// One conversation with the Coach: streaming replies, tool activity, a glass composer.
struct CoachChatView: View {
    @State private var store: ChatStore
    private let initialTitle: String?
    private let starter: String?
    @State private var draft = ""
    @State private var started = false
    @FocusState private var composing: Bool

    init(threadId: String?, title: String?, starter: String? = nil) {
        _store = State(initialValue: ChatStore(threadId: threadId))
        initialTitle = title
        self.starter = starter
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                if store.messages.isEmpty && !store.loading {
                    CoachWelcome(title: "¿En qué te ayudo?", subtitle: "Pregúntame por tu entrenamiento, tu dieta o tu progreso.") { send($0) }
                        .padding(.top, 48)
                }
                ForEach(store.messages) { message in
                    MessageRow(message: message, isLast: message.id == store.messages.last?.id)
                        .transition(.asymmetric(insertion: .opacity.combined(with: .move(edge: .bottom)), removal: .opacity))
                }
                if let error = store.error {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, Theme.padding)
            .padding(.vertical, 12)
            .animation(.snappy, value: store.messages.count)
        }
        .defaultScrollAnchor(.bottom)
        .defaultScrollAnchor(.bottom, for: .sizeChanges)
        .scrollDismissesKeyboard(.interactively)
        .overlay {
            if store.loading { ProgressView().controlSize(.large) }
        }
        .safeAreaBar(edge: .bottom) {
            Composer(draft: $draft, streaming: store.streaming, focused: $composing) { send(draft) }
        }
        .navigationTitle(store.title ?? initialTitle ?? "Nueva conversación")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarTitleDisplayMode(.inline)
        .sensoryFeedback(.impact(weight: .medium), trigger: store.sentCount)
        .sensoryFeedback(.success, trigger: store.finishedCount)
        .task {
            guard !started else { return }
            started = true
            await store.load()
            if let starter, store.messages.isEmpty { await store.send(starter) }
        }
        .refreshable { await store.load() }
    }

    private func send(_ text: String) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !store.streaming else { return }
        draft = ""
        Task { await store.send(text) }
    }
}

private struct MessageRow: View {
    let message: AgentMessage
    let isLast: Bool

    var body: some View {
        switch message.role {
        case .user:
            HStack {
                Spacer(minLength: 56)
                Text(message.text)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .background(Color.accentColor.gradient, in: UnevenRoundedRectangle(topLeadingRadius: 22, bottomLeadingRadius: 22, bottomTrailingRadius: 6, topTrailingRadius: 22, style: .continuous))
                    .textSelection(.enabled)
            }
        case .assistant:
            AssistantRow(message: message)
        }
    }
}

private struct AssistantRow: View {
    let message: AgentMessage

    private var streaming: Bool { message.status == .streaming }
    private var thinking: Bool { streaming && message.text.isEmpty && !message.tools.contains { $0.status == .running } }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            CoachAvatar(size: 28, active: streaming)
            VStack(alignment: .leading, spacing: 10) {
                if !message.tools.isEmpty {
                    GlassEffectContainer(spacing: 6) {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(Array(message.tools.enumerated()), id: \.offset) { _, tool in
                                ToolChip(tool: tool).transition(.blurReplace)
                            }
                        }
                    }
                }
                if thinking {
                    ThinkingDots().transition(.blurReplace)
                }
                if !message.text.isEmpty {
                    CoachMarkdown(text: message.text)
                        .textSelection(.enabled)
                        .contextMenu {
                            Button("Copiar", systemImage: "doc.on.doc") { UIPasteboard.general.string = message.text }
                        }
                }
                if message.status == .error {
                    Label(message.error ?? "El Coach no pudo responder.", systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 3)
            .animation(.snappy, value: message.tools)
            .animation(.snappy, value: thinking)
        }
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
        .padding(.top, 6)
        .padding(.bottom, 8)
        .animation(.snappy, value: streaming)
        .animation(.snappy, value: canSend)
    }
}
