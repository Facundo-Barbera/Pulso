import SwiftUI
import WebKit

/// YouTube's own embedded player in a web view, untouched (no overlays, its
/// branding intact). The page loads from an `https://<bundle id>` origin so the
/// embed gets the Referer YouTube requires; without it embeds fail with error 152/153.
struct YouTubePlayer: UIViewRepresentable {
    let videoId: String

    static var origin: String { "https://" + (Bundle.main.bundleIdentifier ?? "com.facundo.pulso").lowercased() }

    static func html(videoId: String) -> String {
        let id = videoId.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(["-", "_"])) ?? videoId
        let origin = origin.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? origin
        return """
        <!doctype html><html><head>
        <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
        <style>html,body{margin:0;height:100%;background:#000}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style>
        </head><body>
        <iframe src="https://www.youtube.com/embed/\(id)?playsinline=1&rel=0&origin=\(origin)"
          referrerpolicy="strict-origin-when-cross-origin"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>
        </body></html>
        """
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.allowsPictureInPictureMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let view = WKWebView(frame: .zero, configuration: config)
        view.isOpaque = false
        view.backgroundColor = .black
        view.scrollView.isScrollEnabled = false
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.loadHTMLString(Self.html(videoId: videoId), baseURL: URL(string: Self.origin))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    /// Links out of the player (the YouTube logo, "watch on YouTube") open in the YouTube app or Safari.
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard action.navigationType == .linkActivated, action.targetFrame?.isMainFrame ?? true, let url = action.request.url else { return .allow }
            await UIApplication.shared.open(url)
            return .cancel
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url { UIApplication.shared.open(url) }
            return nil
        }
    }
}

/// A technique video: the player on top, what it is below, a way out to YouTube.
struct VideoSheet: View {
    let video: ExerciseVideo
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            YouTubePlayer(videoId: video.youtubeId)
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(video.title).font(.headline)
                Text("\(video.channel) · \(video.lang == "es" ? "Español" : "Inglés")")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Button("Abrir en YouTube", systemImage: "arrow.up.right.square") {
                if let url = URL(string: "https://www.youtube.com/watch?v=\(video.youtubeId)") { openURL(url) }
            }
            .buttonStyle(.glass)
            Spacer(minLength: 0)
        }
        .padding(Theme.padding)
        .padding(.top, 8)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}
