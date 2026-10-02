import SwiftUI
import WidgetKit

/// Small pieces every Pulso widget shares, in the app's `Theme` colors.
struct WidgetHeader: View {
    let title: String
    let systemImage: String
    let color: Color

    var body: some View {
        Label(title.uppercased(), systemImage: systemImage)
            .font(.caption2.weight(.bold))
            .tracking(0.5)
            .foregroundStyle(color)
            .lineLimit(1)
            // "SIGUIENTE ENTRENO" is wider than a small widget on a 375 pt phone (~123 pt inside).
            .minimumScaleFactor(0.75)
    }
}

/// Same shape as the app's `Ring`: soft track, rounded gradient stroke.
struct WidgetRing<Content: View>: View {
    let progress: Double
    let color: Color
    var lineWidth: CGFloat = 8
    @ViewBuilder var content: Content

    var body: some View {
        ZStack {
            Circle().stroke(color.opacity(0.18), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: min(max(progress, 0), 1))
                .stroke(
                    AngularGradient(colors: [color.opacity(0.7), color], center: .center, startAngle: .degrees(0), endAngle: .degrees(360 * max(progress, 0.01))),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .widgetAccentable()
            content
        }
        .padding(lineWidth / 2)
    }
}

/// A designed empty state: a symbol and one line.
struct WidgetEmpty: View {
    let systemImage: String
    let text: String
    var color: Color = .secondary

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.title)
                .foregroundStyle(color.gradient)
            Text(text)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

extension View {
    /// The system background with a faint wash of the widget's domain color.
    func pulsoBackground(_ color: Color) -> some View {
        containerBackground(for: .widget) {
            LinearGradient(colors: [color.opacity(0.16), color.opacity(0.02)], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }
}

enum WidgetStyle {
    static let medication = Color.accentColor

    /// Same thresholds, colours and symbols as the Hoy hero: never green against red, never hue alone.
    static func recoveryColor(_ score: Int?) -> Color {
        guard let score else { return .secondary }
        return score >= 75 ? Theme.good : score >= 50 ? Theme.fair : Theme.caution
    }

    static func recoverySymbol(_ score: Int?) -> String {
        guard let score else { return "circle.dashed" }
        return score >= 75 ? "checkmark.circle.fill" : score >= 50 ? "minus.circle.fill" : "exclamationmark.circle.fill"
    }

    static func number(_ value: Double) -> String { Int(value.rounded()).formatted() }

    static let unpaired = "Abrí Pulso para conectarlo con tu Mac"
}
