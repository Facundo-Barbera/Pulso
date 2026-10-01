import PhotosUI
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
    private let cameraOnAppear: Bool
    @State private var draft: String
    @State private var photos: [ChatPhoto] = []
    @State private var products: [ChatProduct] = []
    @State private var picking = false
    @State private var shooting = false
    @State private var scanning = false
    @State private var picked: [PhotosPickerItem] = []
    @State private var started = false
    @State private var position = ScrollPosition(edge: .bottom)
    /// The person is reading the latest lines: streaming text keeps them in view.
    @State private var atBottom = true
    @FocusState private var composing: Bool
    @Environment(\.scenePhase) private var scenePhase

    /// Comfortable reading width; only matters on wide screens.
    private static let readableWidth: CGFloat = 680

    /// `starter` is sent at once; `draft` waits in the composer. Either, or `focus`, opens the keyboard;
    /// `camera` opens the camera instead (the photo library where there is none).
    init(threadId: String?, title: String?, starter: String? = nil, draft: String? = nil, focus: Bool = false, camera: Bool = false) {
        _store = State(initialValue: ChatStore.store(for: threadId))
        _draft = State(initialValue: draft ?? "")
        initialTitle = title
        self.starter = starter
        focusOnAppear = (focus || draft != nil) && !camera
        cameraOnAppear = camera
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
            Composer(draft: $draft, photos: $photos, products: $products, streaming: store.streaming, focused: $composing,
                     onLibrary: { picking = true }, onCamera: CameraPicker.isAvailable ? { shooting = true } : nil,
                     onScan: { scanning = true }) { send(draft) }
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
        .photosPicker(isPresented: $picking, selection: $picked, maxSelectionCount: max(1, ChatPhoto.limit - photos.count), matching: .images)
        .onChange(of: picked) { _, items in
            guard !items.isEmpty else { return }
            picked = []
            Task {
                for item in items {
                    if let photo = await ChatPhoto.load(item) { add(photo) }
                }
            }
        }
        .fullScreenCover(isPresented: $shooting) {
            CameraPicker { image in
                if let photo = ChatPhoto(image) { add(photo) }
            }
            .ignoresSafeArea()
        }
        .sheet(isPresented: $scanning) {
            ProductScanSheet { addProduct($0) }
                .presentationDetents([.large])
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
        .onChange(of: scenePhase) { _, phase in if phase == .active { store.resume() } }
        .task {
            guard !started else { return }
            started = true
            await store.load()
            scrollToBottom(animated: false)
            if let starter, store.messages.isEmpty { await store.send(starter) }
            if focusOnAppear { composing = true }
            if cameraOnAppear {
                // Let Registrar's sheet close and the push land before presenting over them.
                try? await Task.sleep(for: .milliseconds(450))
                if CameraPicker.isAvailable { shooting = true } else { picking = true }
            }
        }
        .refreshable { await store.load() }
    }

    private func send(_ text: String) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        // A product still being looked up waits, so the sent card shows what it is.
        guard !text.isEmpty || !photos.isEmpty || !products.isEmpty, !store.streaming, !products.contains(where: \.resolving) else { return }
        let sending = photos
        let scanned = products.map(\.sent)
        draft = ""
        photos = []
        products = []
        Task { await store.send(text, photos: sending, products: scanned) }
    }

    private func add(_ photo: ChatPhoto) {
        guard photos.count < ChatPhoto.limit else { return }
        withAnimation(.snappy) { photos.append(photo) }
    }

    /// Attaches the card at once and fills it in when Open Food Facts answers;
    /// an unknown code still goes, by barcode.
    private func addProduct(_ code: String) {
        guard products.count < AgentProduct.limit, !products.contains(where: { $0.barcode == code }) else { return }
        let item = ChatProduct(barcode: code)
        withAnimation(.snappy) { products.append(item) }
        Task {
            var found: FoodProduct?
            do {
                found = try await PulsoModel.shared.api?.lookupBarcode(code)
            } catch {
                PulsoModel.shared.handle(error)
            }
            guard let index = products.firstIndex(where: { $0.id == item.id }) else { return }
            withAnimation(.snappy) {
                products[index].product = found
                products[index].resolving = false
            }
        }
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
            VStack(alignment: .trailing, spacing: 6) {
                if !message.products.isEmpty {
                    MessageProducts(products: message.products)
                }
                if !message.attachments.isEmpty {
                    MessagePhotos(threadId: message.threadId, photos: message.attachments)
                }
                if !message.text.isEmpty { bubble }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.leading, 48)
        case .assistant:
            AssistantRow(message: message)
        }
    }

    private var bubble: some View {
        Text(message.text)
            .lineSpacing(2)
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .background(Color.accentColor.gradient, in: UnevenRoundedRectangle(topLeadingRadius: 22, bottomLeadingRadius: 22, bottomTrailingRadius: 6, topTrailingRadius: 22, style: .continuous))
            .contentShape(.contextMenuPreview, UnevenRoundedRectangle(topLeadingRadius: 22, bottomLeadingRadius: 22, bottomTrailingRadius: 6, topTrailingRadius: 22, style: .continuous))
            .contextMenu { MessageActions(text: message.text) }
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
    @Binding var photos: [ChatPhoto]
    @Binding var products: [ChatProduct]
    let streaming: Bool
    var focused: FocusState<Bool>.Binding
    let onLibrary: () -> Void
    /// Nil where there is no camera.
    let onCamera: (() -> Void)?
    let onScan: () -> Void
    let onSend: () -> Void

    private var photosFull: Bool { photos.count >= ChatPhoto.limit }
    private var productsFull: Bool { products.count >= AgentProduct.limit }
    private var canSend: Bool {
        !streaming && !products.contains(where: \.resolving)
            && (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !photos.isEmpty || !products.isEmpty)
    }
    private var placeholder: String {
        if streaming { return "El Coach está respondiendo…" }
        if !products.isEmpty { return "¿Cuánto comiste? «una cucharada», «la mitad»…" }
        return photos.isEmpty ? "Pregúntale a tu coach…" : "Añade un comentario…"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !photos.isEmpty || !products.isEmpty { attachments }
            GlassEffectContainer(spacing: 10) {
                HStack(alignment: .bottom, spacing: 10) {
                    Menu {
                        if let onCamera { Button("Cámara", systemImage: "camera", action: onCamera).disabled(photosFull) }
                        Button("Fotos", systemImage: "photo.on.rectangle", action: onLibrary).disabled(photosFull)
                        Button("Escanear producto", systemImage: "barcode.viewfinder", action: onScan).disabled(productsFull)
                    } label: {
                        Image(systemName: "plus")
                            .font(.body.weight(.semibold))
                            .frame(width: 30, height: 30)
                    }
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .disabled(photosFull && productsFull)
                    .accessibilityLabel("Añadir fotos o productos")

                    TextField(placeholder, text: $draft, axis: .vertical)
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
        .animation(.snappy, value: photos)
        .animation(.snappy, value: products)
        .sensoryFeedback(.selection, trigger: photos.count)
        .sensoryFeedback(.selection, trigger: products.count)
    }

    /// What goes with the next message, products first; ✕ takes one out.
    private var attachments: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(products) { item in
                    ProductCard(barcode: item.barcode, product: item.product, resolving: item.resolving)
                        .padding(.trailing, 16) // room for ✕
                        .frame(height: 64)
                        .glassEffect(.regular, in: .rect(cornerRadius: 16, style: .continuous))
                        .overlay(alignment: .topTrailing) {
                            remove("Quitar producto") { products.removeAll { $0.id == item.id } }
                        }
                        .transition(.scale(scale: 0.8).combined(with: .opacity))
                }
                ForEach(photos) { photo in
                    Image(uiImage: photo.preview)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 64, height: 64)
                        .clipShape(.rect(cornerRadius: 14, style: .continuous))
                        .overlay(alignment: .topTrailing) {
                            remove("Quitar foto") { photos.removeAll { $0.id == photo.id } }
                        }
                        .transition(.scale(scale: 0.8).combined(with: .opacity))
                }
            }
            .padding(.vertical, 2)
        }
        .scrollClipDisabled()
    }

    private func remove(_ label: String, action: @escaping () -> Void) -> some View {
        Button(label, systemImage: "xmark", action: action)
            .labelStyle(.iconOnly)
            .font(.caption2.weight(.bold))
            .foregroundStyle(.white)
            .frame(width: 22, height: 22)
            .background(.black.opacity(0.6), in: .circle)
            .padding(4)
    }
}
