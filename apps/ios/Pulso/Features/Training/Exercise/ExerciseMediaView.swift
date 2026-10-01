import ImageIO
import SwiftUI
import UIKit

/// Demonstration media, in memory only. ExerciseDB's terms forbid storing what it
/// serves and cap any cache at one hour, so nothing is written to disk and every
/// entry expires after `ttl` (the engine applies the same limit).
actor ExerciseMediaCache {
    static let shared = ExerciseMediaCache()
    static let ttl: TimeInterval = 3600

    private var bytes: [String: (data: Data, at: Date)] = [:]
    /// Decoded frames are large (w × h × 4 bytes each), so this cache is bounded by size.
    private let decoded: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.totalCostLimit = 96 << 20
        return cache
    }()
    private var decodedAt: [String: Date] = [:]
    private var loading: [String: Task<Data, Error>] = [:]

    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 60
        return URLSession(configuration: config)
    }()

    private func fresh(_ at: Date?) -> Bool { at.map { Date.now.timeIntervalSince($0) < Self.ttl } ?? false }

    func data(for path: String, api: PulsoAPI) async throws -> Data {
        if let entry = bytes[path], fresh(entry.at) { return entry.data }
        bytes[path] = nil
        if let task = loading[path] { return try await task.value }
        guard let request = api.mediaRequest(path) else { throw URLError(.badURL) }
        let task = Task {
            let (data, response) = try await Self.session.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            return data
        }
        loading[path] = task
        defer { loading[path] = nil }
        let data = try await task.value
        bytes[path] = (data, .now)
        return data
    }

    /// The image for `path`, animated when it is a GIF.
    func image(for path: String, api: PulsoAPI) async throws -> UIImage? {
        if let image = cached(path) { return image }
        guard let image = AnimatedImage.decode(try await data(for: path, api: api)) else { return nil }
        let frame = image.size.width * image.scale * image.size.height * image.scale * 4
        decoded.setObject(image, forKey: path as NSString, cost: Int(frame) * max(1, image.images?.count ?? 1))
        decodedAt[path] = .now
        return image
    }

    func cached(_ path: String) -> UIImage? {
        guard fresh(decodedAt[path]) else {
            decoded.removeObject(forKey: path as NSString)
            decodedAt[path] = nil
            return nil
        }
        return decoded.object(forKey: path as NSString)
    }
}

/// GIF decoding with ImageIO: SwiftUI's `Image` shows only the first frame.
enum AnimatedImage {
    /// Browsers treat delays under 20 ms as 100 ms; GIFs are authored for that.
    static func delay(_ raw: Double?) -> Double {
        guard let raw, raw >= 0.02 else { return 0.1 }
        return raw
    }

    static func frameDelays(_ source: CGImageSource) -> [Double] {
        (0..<CGImageSourceGetCount(source)).map { i in
            let properties = CGImageSourceCopyPropertiesAtIndex(source, i, nil) as? [CFString: Any]
            let gif = properties?[kCGImagePropertyGIFDictionary] as? [CFString: Any]
            let raw = (gif?[kCGImagePropertyGIFUnclampedDelayTime] as? Double).flatMap { $0 > 0 ? $0 : nil }
                ?? gif?[kCGImagePropertyGIFDelayTime] as? Double
            return delay(raw)
        }
    }

    /// A still image for one frame, an animated `UIImage` (evenly timed over the
    /// GIF's total duration) for more.
    static func decode(_ data: Data) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let count = CGImageSourceGetCount(source)
        guard count > 1 else { return UIImage(data: data) }
        let frames = (0..<count).compactMap { CGImageSourceCreateImageAtIndex(source, $0, nil).map { UIImage(cgImage: $0) } }
        return UIImage.animatedImage(with: frames, duration: frameDelays(source).reduce(0, +))
    }
}

/// Plays an animated `UIImage`; a still one just shows.
private struct AnimatedImageView: UIViewRepresentable {
    let image: UIImage

    func makeUIView(context: Context) -> UIImageView {
        let view = UIImageView()
        view.contentMode = .scaleAspectFit
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        view.setContentHuggingPriority(.defaultLow, for: .vertical)
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        return view
    }

    func updateUIView(_ view: UIImageView, context: Context) {
        if view.image !== image { view.image = image }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UIImageView, context: Context) -> CGSize? {
        proposal.replacingUnspecifiedDimensions(by: image.size)
    }
}

/// An exercise's demonstration on a white plate (the source GIFs have a white
/// background, so the plate reads the same in dark mode). Square; size it outside.
struct ExerciseMediaView: View {
    let path: String?
    var cornerRadius: CGFloat = 20
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        ZStack {
            if let image {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).fill(.white)
                AnimatedImageView(image: image)
                    .padding(cornerRadius * 0.25)
                    .transition(.opacity)
            } else {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(Theme.training.opacity(0.14))
                Image(systemName: failed || path == nil ? "figure.strengthtraining.traditional" : "dumbbell")
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 110, maxHeight: 110)
                    .padding(cornerRadius * 0.9)
                    .foregroundStyle(Theme.training.gradient)
                    .symbolEffect(.pulse, isActive: !failed && path != nil)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .animation(.snappy, value: image != nil)
        .task(id: path) { await load() }
        .accessibilityHidden(true)
    }

    private func load() async {
        guard let path else { return }
        if let cached = await ExerciseMediaCache.shared.cached(path) {
            image = cached
            return
        }
        guard let api = PulsoModel.shared.api else { return failed = true }
        do {
            image = try await ExerciseMediaCache.shared.image(for: path, api: api)
            failed = image == nil
        } catch {
            failed = true
        }
    }
}

#Preview {
    HStack {
        ExerciseMediaView(path: nil).frame(width: 64)
        ExerciseMediaView(path: "/api/mobile/training/media/x.gif").frame(width: 160)
    }
    .padding()
}
