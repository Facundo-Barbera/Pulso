import SwiftUI

/// Pulso's shared look. Features use these instead of ad-hoc colors and
/// paddings so the tabs read as one app. Accent comes from the asset catalog.
enum Theme {
    static let corner: CGFloat = 18
    static let padding: CGFloat = 16

    /// Macro and domain colors, consistent across every chart and ring (web: `--domain-*` in globals.css).
    /// Chosen for red-green colour blindness: the four that share the Dieta rings (kcal, protein, carbs,
    /// fat) stay apart under deuteranopia and protanopia (and tritanopia) by lightness and the blue–yellow
    /// axis; so do the Hoy goals (body, energy, training). Each has its own step for light and dark.
    /// Colour still never works alone: rings carry a symbol, legends a label.
    static let energy = Color(light: 0xE8650F, dark: 0xF5862A)
    static let protein = Color(light: 0x2B5FD9, dark: 0x3F7DF5)
    static let carbs = Color(light: 0x16B0C8, dark: 0x59D8E6)
    static let fat = Color(light: 0xE0A800, dark: 0xF7D44C)
    static let training = Color(light: 0x7A55E8, dark: 0xA07CFF)
    static let body = Color(light: 0x0FA88C, dark: 0x2CCFB0)
    static let water = Color(light: 0x2E9BE0, dark: 0x4FB8FF)

    /// State, never green against red: good is blue, "look at this" is orange, and both ship with
    /// a symbol and words (`checkmark`, `arrow.up`…). `fair` is the middle of a three-step score.
    static let good = Color(light: 0x2563EB, dark: 0x4D9BFF)
    static let fair = Color(light: 0xB88A00, dark: 0xF7D44C)
    static let caution = Color(light: 0xD9600B, dark: 0xFF9F45)

    /// The symbol each ring wears at its start and its legend repeats, so identity never rests on hue.
    static let energySymbol = "flame.fill"
    static let proteinSymbol = "fish.fill"
    static let carbsSymbol = "laurel.leading"
    static let fatSymbol = "drop.fill"

    /// The app icon's gradient (Branding/pulso-icon.svg): onboarding, the brand mark, rare hero moments.
    static let brand = [
        Color(red: 1.00, green: 0.48, blue: 0.27),
        Color(red: 0.96, green: 0.20, blue: 0.37),
        Color(red: 0.54, green: 0.17, blue: 0.89),
    ]
    static let brandGradient = LinearGradient(colors: brand, startPoint: .topLeading, endPoint: .bottomTrailing)
}

extension Color {
    /// A colour with its own step per appearance, from `0xRRGGBB`.
    init(light: UInt32, dark: UInt32) {
        func ui(_ hex: UInt32) -> UIColor {
            let r = CGFloat((hex >> 16) & 0xFF) / 255
            let g = CGFloat((hex >> 8) & 0xFF) / 255
            let b = CGFloat(hex & 0xFF) / 255
            return UIColor(red: r, green: g, blue: b, alpha: 1)
        }
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? ui(dark) : ui(light) })
    }
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
        .lineLimit(1)
        .minimumScaleFactor(0.85)
    }
}

/// A row when its children fit the width, else the same children stacked. For button
/// pairs and readouts that must not overflow a 375 pt phone or large Dynamic Type.
/// Don't put a `Spacer` inside: stacked, it would stretch vertically.
struct AdaptiveStack<Content: View>: View {
    var horizontalAlignment: HorizontalAlignment = .center
    var verticalAlignment: VerticalAlignment = .center
    var spacing: CGFloat = 10
    @ViewBuilder var content: Content

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: verticalAlignment, spacing: spacing) { content }
            VStack(alignment: horizontalAlignment, spacing: spacing) { content }
        }
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

// MARK: - Shared components
// Available to every feature; none is required. Adopt them when a screen would
// otherwise hand-roll the same thing, so the tabs keep converging on one look.

/// The app icon (asset "Mark", vector) in its rounded-square shape. `BrandMark(size: 96)`.
struct BrandMark: View {
    var size: CGFloat = 64

    var body: some View {
        Image("Mark")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.225, style: .continuous))
            .shadow(color: Theme.brand[1].opacity(0.35), radius: size * 0.18, y: size * 0.08)
            .accessibilityHidden(true)
    }
}

/// A screen's one hero: a big rounded number with its unit, a caption, and room for
/// a ring or chart below. The tint washes the background faintly.
///
///     HeroCard(title: "Proteína", value: "128", unit: "g", caption: "de 150 g", tint: Theme.protein) {
///         ProgressView(value: 0.85).tint(Theme.protein)
///     }
struct HeroCard<Accessory: View>: View {
    let title: String
    var systemImage: String?
    let value: String
    var unit: String?
    var caption: String?
    var tint: Color = .accentColor
    @ViewBuilder var accessory: Accessory

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardTitle(text: title, systemImage: systemImage)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value)
                    .font(.system(size: 52, weight: .bold, design: .rounded))
                    .contentTransition(.numericText())
                if let unit {
                    Text(unit).font(.title3.weight(.semibold)).foregroundStyle(.secondary)
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .animation(.snappy, value: value)
            if let caption {
                Text(caption).font(.subheadline).foregroundStyle(.secondary)
            }
            accessory
        }
        .padding(Theme.padding + 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: Theme.corner + 6, style: .continuous)
                .fill(.background.secondary)
                .overlay {
                    RoundedRectangle(cornerRadius: Theme.corner + 6, style: .continuous)
                        .fill(LinearGradient(colors: [tint.opacity(0.18), tint.opacity(0.02)], startPoint: .topLeading, endPoint: .bottomTrailing))
                }
        }
    }
}

extension HeroCard where Accessory == EmptyView {
    init(title: String, systemImage: String? = nil, value: String, unit: String? = nil, caption: String? = nil, tint: Color = .accentColor) {
        self.init(title: title, systemImage: systemImage, value: value, unit: unit, caption: caption, tint: tint) { EmptyView() }
    }
}

/// A small supporting number for a two- or three-column grid under the hero.
/// `StatTile(title: "Pasos", value: "8.412", systemImage: "figure.walk", tint: Theme.energy)`
struct StatTile: View {
    let title: String
    let value: String
    var unit: String?
    var systemImage: String?
    var tint: Color = .secondary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label {
                Text(title)
            } icon: {
                if let systemImage { Image(systemName: systemImage).foregroundStyle(tint) }
            }
            .font(.caption.weight(.medium))
            .foregroundStyle(.secondary)
            .lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value)
                    .font(.title2.weight(.semibold))
                    .fontDesign(.rounded)
                    .contentTransition(.numericText())
                if let unit { Text(unit).font(.footnote).foregroundStyle(.secondary) }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .animation(.snappy, value: value)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// A designed empty state: a large tinted symbol, one line, and at most one action.
/// `EmptyStateView(systemImage: "fork.knife", title: "Sin comidas hoy", message: "…", actionTitle: "Anotar") { … }`
struct EmptyStateView: View {
    let systemImage: String
    let title: String
    var message: String?
    var tint: Color = .accentColor
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.system(size: 44, weight: .medium))
                .foregroundStyle(tint.gradient)
                .symbolEffect(.bounce, options: .nonRepeating)
                .frame(width: 88, height: 88)
                .background(tint.opacity(0.12), in: Circle())
            Text(title).font(.headline)
            if let message {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.glassProminent)
                    .padding(.top, 4)
            }
        }
        .padding(.vertical, 28)
        .padding(.horizontal, Theme.padding)
        .frame(maxWidth: .infinity)
    }
}

/// A compact glass capsule for a status or filter: `GlassChip("Sin conexión", systemImage: "wifi.slash", tint: .orange)`.
struct GlassChip: View {
    let title: String
    var systemImage: String?
    var tint: Color?

    init(_ title: String, systemImage: String? = nil, tint: Color? = nil) {
        self.title = title
        self.systemImage = systemImage
        self.tint = tint
    }

    var body: some View {
        HStack(spacing: 5) {
            if let systemImage { Image(systemName: systemImage) }
            Text(title)
        }
        .font(.caption.weight(.medium))
        .lineLimit(1)
        .foregroundStyle(tint.map(AnyShapeStyle.init) ?? AnyShapeStyle(.secondary))
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .glassEffect(tint.map { .regular.tint($0.opacity(0.15)) } ?? .regular, in: .capsule)
    }
}

/// Frames a #Preview at 375 pt, the narrowest phone Pulso supports (SE, mini), on the
/// grouped background with a screen's padding, so a card wider than the phone shows up
/// in the canvas. Pass `.xxLarge` to check large Dynamic Type too.
struct NarrowPreview<Content: View>: View {
    var dynamicType: DynamicTypeSize = .large
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(spacing: 16) { content }
                .padding(.horizontal)
                .padding(.vertical, 24)
        }
        .frame(width: 375)
        .background(Color(.systemGroupedBackground))
        .dynamicTypeSize(dynamicType)
    }
}

#Preview("Componentes · 375 pt · XXL") {
    NarrowPreview(dynamicType: .xxLarge) {
        HeroCard(title: "Proteína restante", systemImage: "fork.knife", value: "1.248,5", unit: "kcal", caption: "de 2.400 kcal objetivo diario", tint: Theme.energy)
        HStack(spacing: 10) {
            StatTile(title: "Pasos de hoy", value: "12.408", systemImage: "figure.walk", tint: Theme.body)
            StatTile(title: "Energía activa", value: "1.024", unit: "kcal", systemImage: "flame.fill", tint: Theme.energy)
        }
        AdaptiveStack {
            Button("Copiar el día anterior", systemImage: "doc.on.doc") {}.buttonStyle(.glass)
            Button("Plan con el Coach", systemImage: "sparkles") {}.buttonStyle(.glassProminent)
        }
        GlassChip("Actualizado hace 12 minutos", systemImage: "arrow.triangle.2.circlepath")
        EmptyStateView(systemImage: "fork.knife", title: "Sin comidas registradas hoy", message: "Anota lo que comes y el Coach ajusta tu plan.", actionTitle: "Añadir comida") {}
    }
}
