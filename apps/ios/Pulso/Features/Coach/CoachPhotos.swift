import PhotosUI
import SwiftUI
import UIKit

/// A photo picked in the composer, ready to send: upright, at most 1600 px on its
/// long edge and JPEG, so the upload is small and the Mac has nothing to convert.
struct ChatPhoto: Identifiable, Equatable {
    static let limit = 4
    static let longEdge: CGFloat = 1600

    let id = "local-\(UUID().uuidString)"
    let jpeg: Data
    let preview: UIImage

    var attachment: AgentAttachment {
        AgentAttachment(id: id, width: preview.size.width, height: preview.size.height)
    }

    /// Redrawn at scale 1, which also bakes in the orientation the camera recorded.
    init?(_ image: UIImage) {
        let scale = min(1, Self.longEdge / max(image.size.width, image.size.height, 1))
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        guard let jpeg = resized.jpegData(compressionQuality: 0.8) else { return nil }
        self.jpeg = jpeg
        preview = resized
    }

    /// From the photo library (HEIC included), off the main thread.
    static func load(_ item: PhotosPickerItem) async -> ChatPhoto? {
        guard let data = try? await item.loadTransferable(type: Data.self) else { return nil }
        return await Task.detached(priority: .userInitiated) { UIImage(data: data).flatMap(ChatPhoto.init) }.value
    }

    static func == (a: ChatPhoto, b: ChatPhoto) -> Bool { a.id == b.id }
}

/// Photos of the chat, in memory: the ones just sent (by their local id) and the
/// Mac's (fetched with the phone's token, by thread and id).
@MainActor
final class CoachPhotoCache {
    static let shared = CoachPhotoCache()
    private let images: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.totalCostLimit = 64 << 20
        return cache
    }()

    func remember(_ photos: [ChatPhoto]) {
        for photo in photos { store(photo.preview, for: photo.id) }
    }

    func image(threadId: String, attachment: AgentAttachment) async -> UIImage? {
        if let image = images.object(forKey: attachment.id as NSString) { return image }
        guard !attachment.id.hasPrefix("local-"), let api = PulsoModel.shared.api,
              let data = try? await api.agentAttachment(threadId: threadId, id: attachment.id),
              let image = await Task.detached(operation: { UIImage(data: data)?.preparingForDisplay() }).value
        else { return nil }
        store(image, for: attachment.id)
        return image
    }

    private func store(_ image: UIImage, for id: String) {
        images.setObject(image, forKey: id as NSString, cost: Int(image.size.width * image.size.height * 4))
    }
}

/// One photo of a message, filling its frame; a soft placeholder while it loads.
struct AttachmentImage: View {
    let threadId: String
    let attachment: AgentAttachment
    var contentMode: ContentMode = .fill
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
                    .transition(.opacity)
            } else {
                Rectangle().fill(.fill.tertiary)
                Image(systemName: failed ? "photo.badge.exclamationmark" : "photo")
                    .font(.title2)
                    .foregroundStyle(.tertiary)
                    .symbolEffect(.pulse, isActive: !failed)
            }
        }
        .animation(.snappy, value: image != nil)
        .task(id: attachment.id) {
            image = await CoachPhotoCache.shared.image(threadId: threadId, attachment: attachment)
            failed = image == nil
        }
        .accessibilityLabel("Foto")
    }
}

/// The person's photos, right-aligned like their bubble: one is big, several make a grid.
struct MessagePhotos: View {
    let threadId: String
    let photos: [AgentAttachment]
    @State private var viewing: AgentAttachment?
    @Namespace private var zoom

    var body: some View {
        Group {
            if photos.count == 1, let photo = photos.first {
                tile(photo)
                    .aspectRatio(max(0.6, min(photo.width / max(photo.height, 1), 1.8)), contentMode: .fit)
                    .frame(maxWidth: 250)
            } else {
                LazyVGrid(columns: [GridItem(.fixed(122), spacing: 6), GridItem(.fixed(122), spacing: 6)], spacing: 6) {
                    ForEach(photos) { photo in
                        tile(photo).frame(width: 122, height: 122)
                    }
                }
            }
        }
        .fullScreenCover(item: $viewing) { photo in
            PhotoViewer(threadId: threadId, photos: photos, selection: photo.id)
                .navigationTransition(.zoom(sourceID: photo.id, in: zoom))
        }
    }

    private func tile(_ photo: AgentAttachment) -> some View {
        Button { viewing = photo } label: {
            AttachmentImage(threadId: threadId, attachment: photo)
                .clipShape(.rect(cornerRadius: 18, style: .continuous))
                .contentShape(.rect(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .matchedTransitionSource(id: photo.id, in: zoom)
        .accessibilityLabel("Ver foto")
    }
}

/// Full screen, swipe between a message's photos, pinch or double-tap to zoom, swipe down or ✕ to close.
struct PhotoViewer: View {
    let threadId: String
    let photos: [AgentAttachment]
    @State var selection: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        TabView(selection: $selection) {
            ForEach(photos) { photo in
                ZoomablePhoto(threadId: threadId, attachment: photo, onDismiss: { dismiss() }).tag(photo.id)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: photos.count > 1 ? .automatic : .never))
        .background(.black)
        .overlay(alignment: .topTrailing) {
            Button("Cerrar", systemImage: "xmark") { dismiss() }
                .labelStyle(.iconOnly)
                .font(.body.weight(.semibold))
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .padding()
        }
        .preferredColorScheme(.dark)
        .statusBarHidden()
    }
}

private struct ZoomablePhoto: View {
    let threadId: String
    let attachment: AgentAttachment
    let onDismiss: () -> Void
    @State private var scale: CGFloat = 1
    @State private var settledScale: CGFloat = 1
    @State private var drag: CGSize = .zero

    var body: some View {
        AttachmentImage(threadId: threadId, attachment: attachment, contentMode: .fit)
            .scaleEffect(scale)
            .offset(y: scale == 1 ? drag.height : 0)
            .opacity(scale == 1 ? 1 - min(abs(drag.height) / 600, 0.5) : 1)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(.rect)
            .gesture(
                MagnifyGesture()
                    .onChanged { scale = max(1, min(settledScale * $0.magnification, 5)) }
                    .onEnded { _ in settledScale = scale }
            )
            .simultaneousGesture(
                DragGesture(minimumDistance: 20)
                    .onChanged { if scale == 1, abs($0.translation.height) > abs($0.translation.width) { drag = $0.translation } }
                    .onEnded { value in
                        if scale == 1, value.translation.height > 140 { onDismiss() }
                        withAnimation(.snappy) { drag = .zero }
                    }
            )
            .onTapGesture(count: 2) {
                withAnimation(.snappy) {
                    scale = scale > 1 ? 1 : 2.5
                    settledScale = scale
                }
            }
    }
}

/// The system camera, for one photo.
struct CameraPicker: UIViewControllerRepresentable {
    let onPick: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    static var isAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onPick(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}
