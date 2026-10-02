import PhotosUI
import SwiftUI

/// The Coach tab: one conversation, oldest at the top, a glass composer at the bottom.
/// Assistant text runs full width like a document; the person's messages are accent
/// bubbles; quiet dividers mark new contexts, going back to one, and summaries.
/// Older pages load on scrolling up. The rest of the app opens it through `CoachLauncher`.
struct CoachView: View {
    let model: PulsoModel
    @State private var store = ConversationStore.shared
    @State private var draft = ""
    @State private var photos: [ChatPhoto] = []
    @State private var products: [ChatProduct] = []
    @State private var picking = false
    @State private var shooting = false
    @State private var scanning = false
    @State private var picked: [PhotosPickerItem] = []
    @State private var showBrief = false
    @State private var notice: String?
    @State private var position = ScrollPosition(edge: .bottom)
    /// The person is reading the latest lines: streaming text keeps them in view.
    @State private var atBottom = true
    /// Scrolled past the end of the content, so what's on screen is empty.
    @State private var pastEnd = false
    @State private var scrolling = false
    @FocusState private var composing: Bool
    @Environment(\.scenePhase) private var scenePhase
    private let launcher = CoachLauncher.shared

    /// Comfortable reading width; only matters on wide screens.
    private static let readableWidth: CGFloat = 680
    /// A marker after the last row. Scrolling to it lays it out first, so the offset comes
    /// from real geometry; scrolling to `.bottom` uses the lazy stack's estimated height,
    /// which can land past the content and leave the screen blank until the next drag.
    private static let end = "end"

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                if store.before != nil {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .onAppear { loadOlder() }
                }
                if store.loaded && store.isEmpty {
                    VStack(spacing: 28) {
                        CoachBriefCard(model: model)
                        CoachWelcome(title: "¿En qué te ayudo?", subtitle: "Pregúntame por tu entrenamiento, tu dieta o tu progreso.") { send($0) }
                    }
                    .padding(.top, 12)
                }
                ForEach(store.items) { item in
                    switch item {
                    case let .message(message):
                        MessageRow(message: message).transition(.opacity)
                    case let .marker(marker):
                        FeedDivider(marker: marker, startedAt: store.startedAt(marker.contextId),
                                    canReturn: marker.contextId != store.activeContextId && (marker.kind == .context || marker.kind == .distilled) && !store.streaming) {
                            switchContext(marker.contextId)
                        }
                    }
                }
                if store.compacting {
                    Label("Compactando lo anterior…", systemImage: "sparkles")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .symbolEffect(.pulse, options: .repeating)
                        .transition(.blurReplace)
                }
                if let error = store.error ?? notice {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                        .frame(maxWidth: .infinity)
                }
                Color.clear
                    .frame(height: 1)
                    .id(Self.end)
            }
            .frame(maxWidth: Self.readableWidth)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, Theme.padding + 4)
            .padding(.top, 12)
            .padding(.bottom, 16)
            .animation(.snappy, value: store.items.count)
            .animation(.snappy, value: store.compacting)
            .environment(\.coachUndo, CoachUndo { [store] message, index in await store.undo(message, index: index) })
        }
        .scrollPosition($position)
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.y + geometry.containerSize.height - geometry.contentInsets.bottom >= geometry.contentSize.height - 60
        } action: { _, bottom in
            atBottom = bottom
        }
        // Content that shrank or re-measured under a pinned offset: put the end back
        // in view once the person isn't scrolling (their own overscroll is left alone).
        .onScrollGeometryChange(for: Bool.self) { geometry in
            let last = max(geometry.contentSize.height + geometry.contentInsets.bottom - geometry.containerSize.height, -geometry.contentInsets.top)
            return geometry.contentOffset.y > last + 2
        } action: { _, past in
            pastEnd = past
            if past && !scrolling { pin() }
        }
        .onScrollPhaseChange { _, phase in
            scrolling = phase != .idle
            if phase == .idle && pastEnd { pin() }
        }
        .overlay {
            if store.loading { ProgressView().controlSize(.large) }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Composer(draft: $draft, photos: $photos, products: $products, streaming: store.streaming, focused: $composing,
                     onLibrary: { picking = true }, onCamera: CameraPicker.isAvailable ? { shooting = true } : nil,
                     onScan: { scanning = true }) { send(draft) }
                .overlay(alignment: .top) {
                    if !atBottom && !store.isEmpty {
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
        .sheet(isPresented: $showBrief) {
            NavigationStack {
                ScrollView { CoachBriefCard(model: model).padding(Theme.padding) }
                    .navigationTitle("Resumen del Coach")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Listo", systemImage: "checkmark") { showBrief = false } } }
            }
            .presentationDetents([.medium, .large])
        }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if !store.isEmpty {
                    Button("Resumen del Coach", systemImage: "sun.horizon") { showBrief = true }
                }
                contextMenu
            }
        }
        .navigationTitle("Coach")
        .navigationBarTitleDisplayMode(.inline)
        .navigationSubtitle(store.compacting ? "Compactando…" : store.streaming ? "Respondiendo…" : "")
        .sensoryFeedback(.impact(weight: .medium), trigger: store.sentCount)
        .sensoryFeedback(.success, trigger: store.finishedCount)
        .sensoryFeedback(.selection, trigger: store.activeContextId)
        // Something new at the end, or the keyboard opening, brings the end into view (older pages don't).
        .onChange(of: store.items.last?.id) { scrollToBottom() }
        .onChange(of: composing) { _, focused in if focused { scrollToBottom() } }
        // Streaming text, tool chips and result cards grow the reply; keep its end in view.
        .onChange(of: store.items.last) {
            if atBottom { pin() }
        }
        .onChange(of: scenePhase) { _, phase in if phase == .active { store.resume() } }
        .onChange(of: launcher.pending?.id, initial: true) { _, id in
            if id != nil { launch() }
        }
        .task {
            await store.load()
            scrollToBottom(animated: false)
        }
        .refreshable { await store.load() }
    }

    /// «Contexto nuevo» and the earlier contexts to go back to, behind one quiet button.
    private var contextMenu: some View {
        Menu {
            Button("Contexto nuevo", systemImage: "plus.bubble") { switchContext(nil) }
            if !store.pastContexts.isEmpty {
                Section("Volver a") {
                    ForEach(store.pastContexts.prefix(8)) { context in
                        Button(Self.describe(context), systemImage: "clock.arrow.circlepath") { switchContext(context.id) }
                    }
                }
            }
        } label: {
            Label("Contexto", systemImage: "square.stack.3d.up")
        }
        .disabled(store.streaming)
    }

    private static func describe(_ context: AgentContext) -> String {
        let day = Date(timeIntervalSince1970: context.startedAt / 1000).formatted(.dateTime.day().month(.abbreviated))
        return "Contexto del \(day) · \(context.messageCount == 1 ? "1 mensaje" : "\(context.messageCount) mensajes")"
    }

    /// Shows what another tab asked the Coach for (CoachLauncher).
    private func launch() {
        guard let launch = launcher.take() else { return }
        showBrief = false
        switch launch.request {
        case let .prompt(text, send):
            if send { Task { await store.send(text) } } else {
                draft = text
                composing = true
            }
        case let .photo(prompt):
            draft = prompt
            Task {
                // Let Registrar's sheet close and the tab switch land before presenting over them.
                try? await Task.sleep(for: .milliseconds(450))
                if CameraPicker.isAvailable { shooting = true } else { picking = true }
            }
        case .open:
            Task {
                await store.load()
                scrollToBottom()
                composing = true
            }
        }
    }

    private func switchContext(_ id: String?) {
        notice = nil
        Task {
            if let problem = await store.context(id) {
                notice = problem
            } else {
                scrollToBottom()
                composing = true
            }
        }
    }

    /// The page above; what was at the top stays in view instead of jumping.
    private func loadOlder() {
        let top = store.items.first?.id
        Task {
            await store.loadOlder()
            guard let top else { return }
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { position.scrollTo(id: top, anchor: .top) }
        }
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
        notice = nil
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
            withAnimation(.snappy) { position.scrollTo(id: Self.end, anchor: .bottom) }
        } else {
            pin()
        }
    }

    /// Jumps to the end with no animation, so a frame-by-frame update can't leave
    /// an animation heading for an offset the content no longer reaches.
    private func pin() {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { position.scrollTo(id: Self.end, anchor: .bottom) }
    }
}

/// A quiet line in the feed: a context started or was resumed, the Coach summarized what
/// came before, or the conversation started from the old ones. Text and symbol, never color alone.
private struct FeedDivider: View {
    let marker: AgentFeedMarker
    let startedAt: Date?
    let canReturn: Bool
    let onReturn: () -> Void

    private static func day(_ date: Date) -> String { date.formatted(.dateTime.day().month(.abbreviated)) }
    private var date: Date { Date(timeIntervalSince1970: marker.createdAt / 1000) }

    private var title: String {
        switch marker.kind {
        case .context: "Contexto nuevo · \(Self.day(date))"
        case .switch: "Volviste al contexto del \(Self.day(startedAt ?? date))"
        case .compacted: "Resumí lo anterior para seguir"
        case .distilled: "Partí de un resumen de tus conversaciones anteriores"
        case .unknown: Self.day(date)
        }
    }

    private var symbol: String {
        switch marker.kind {
        case .context: "square.stack.3d.up"
        case .switch: "arrow.uturn.backward"
        case .compacted: "sparkles"
        case .distilled: "books.vertical"
        case .unknown: "minus"
        }
    }

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                line
                Label(title, systemImage: symbol)
                    .labelStyle(DividerLabelStyle())
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .layoutPriority(1)
                line
            }
            if canReturn {
                Button("Volver a este contexto", systemImage: "arrow.uturn.backward", action: onReturn)
                    .font(.footnote.weight(.semibold))
                    .buttonStyle(.glass)
                    .controlSize(.small)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private var line: some View {
        Capsule().fill(.quaternary).frame(height: 1).frame(minWidth: 16)
    }
}

/// Symbol and text close together, the symbol a touch smaller.
private struct DividerLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 5) {
            configuration.icon.imageScale(.small)
            configuration.title
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
    /// Lookups that finished fold into "Revisó N cosas"; what is running or failed is a chip; what changed something is a card.
    private var checked: [AgentToolUse] { message.tools.filter { $0.status == .done && !$0.isAction } }
    private var activity: [AgentToolUse] { message.tools.filter { $0.status != .done || ($0.isAction && $0.result == nil) } }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let source = message.source {
                Label(source.title, systemImage: source.kind == "brief" ? "sun.horizon" : "list.clipboard")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.secondary)
            }
            if !checked.isEmpty {
                CoachCheckedGroup(tools: checked).transition(.blurReplace)
            }
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
            CoachActionCards(message: message)
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
