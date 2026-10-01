import SwiftUI

/// A fresh conversation, optionally opened by a starter prompt.
struct NewChat: Identifiable, Hashable {
    let id = UUID()
    var starter: String?
}

/// The Coach tab: conversations, newest first.
struct CoachView: View {
    let model: PulsoModel
    @State private var store = CoachStore()
    @State private var newChat: NewChat?
    @State private var pendingDelete: AgentThread?

    var body: some View {
        ScrollView {
            if store.loaded && store.threads.isEmpty {
                CoachWelcome { newChat = NewChat(starter: $0) }
                    .padding(.horizontal, Theme.padding)
                    .padding(.top, 40)
            } else {
                LazyVStack(alignment: .leading, spacing: 12) {
                    StarterRow { newChat = NewChat(starter: $0) }
                        .padding(.bottom, 8)
                    ForEach(store.threads) { thread in
                        NavigationLink(value: thread) {
                            ThreadCard(thread: thread)
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button("Eliminar conversación", systemImage: "trash", role: .destructive) { pendingDelete = thread }
                        }
                        .transition(.opacity.combined(with: .scale(scale: 0.96)))
                    }
                }
                .padding(Theme.padding)
                .animation(.snappy, value: store.threads)
            }
        }
        .navigationTitle("Coach")
        .navigationDestination(for: AgentThread.self) { thread in
            CoachChatView(threadId: thread.id, title: thread.title)
        }
        .navigationDestination(item: $newChat) { chat in
            CoachChatView(threadId: nil, title: nil, starter: chat.starter)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Nueva conversación", systemImage: "square.and.pencil") { newChat = NewChat() }
            }
        }
        .confirmationDialog(
            "¿Eliminar esta conversación?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { thread in
            Button("Eliminar", role: .destructive) { Task { await store.delete(thread) } }
        } message: { _ in
            Text("El Coach seguirá recordando lo que guardó en tu perfil.")
        }
        .sensoryFeedback(.selection, trigger: newChat) { _, new in new != nil }
        // Also runs when coming back from a chat, so titles and previews are fresh.
        .onAppear { Task { await store.refresh() } }
        .refreshable { await store.refresh() }
    }
}

private struct StarterRow: View {
    let onPick: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    ForEach(StarterPrompt.all) { prompt in
                        Button {
                            onPick(prompt.text)
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: prompt.symbol).foregroundStyle(prompt.color)
                                Text(prompt.text)
                            }
                            .font(.subheadline.weight(.medium))
                        }
                        .buttonStyle(.glass)
                    }
                }
                .padding(.vertical, 2)
            }
        }
        .scrollClipDisabled()
    }
}

private struct ThreadCard: View {
    let thread: AgentThread

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            CoachAvatar(size: 36)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(thread.title)
                        .font(.headline)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text(Date(timeIntervalSince1970: thread.updatedAt / 1000).formatted(.relative(presentation: .named)))
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                if let preview = thread.preview {
                    Text(Self.plain(preview))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
        }
        .padding(Theme.padding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
        .contentShape(.rect(cornerRadius: Theme.corner))
    }

    /// Markdown markers read as noise in a two-line preview.
    static func plain(_ text: String) -> String {
        text.replacingOccurrences(of: #"[*_`#>|]+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }
}
