import SwiftUI

/// Pulso's shared look. Features use these instead of ad-hoc colors and
/// paddings so the tabs read as one app. Accent comes from the asset catalog.
enum Theme {
    static let corner: CGFloat = 18
    static let padding: CGFloat = 16

    /// Macro and domain colors, consistent across every chart and ring.
    static let protein = Color(red: 0.96, green: 0.36, blue: 0.42)
    static let carbs = Color(red: 0.98, green: 0.72, blue: 0.25)
    static let fat = Color(red: 0.35, green: 0.62, blue: 0.98)
    static let energy = Color(red: 0.98, green: 0.45, blue: 0.20)
    static let training = Color(red: 0.55, green: 0.42, blue: 0.98)
    static let body = Color(red: 0.20, green: 0.78, blue: 0.62)
}

/// A rounded card on the grouped background. `Card { ... }`.
struct Card<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) { content }
            .padding(Theme.padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background.secondary, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
    }
}

/// Small uppercase label above a card's content.
struct CardTitle: View {
    let text: String
    var systemImage: String?

    var body: some View {
        Label {
            Text(text.uppercased()).font(.caption.weight(.semibold)).tracking(0.6)
        } icon: {
            if let systemImage { Image(systemName: systemImage) }
        }
        .foregroundStyle(.secondary)
    }
}

/// Placeholder for a tab whose feature is not built yet.
struct ComingSoon: View {
    let title: String
    let systemImage: String
    let blurb: String

    var body: some View {
        ContentUnavailableView(title, systemImage: systemImage, description: Text(blurb))
            .navigationTitle(title)
    }
}
