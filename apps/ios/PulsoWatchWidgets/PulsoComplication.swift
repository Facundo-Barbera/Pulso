import SwiftUI
import WidgetKit

/// Pulso on the watch face: its mark, a tap away from the app (to start the
/// next day or get back to the session).
@main
struct PulsoComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PulsoComplication", provider: Provider()) { _ in
            ComplicationView()
                .containerBackground(for: .widget) { Color.clear }
        }
        .configurationDisplayName("Pulso")
        .description("Abre Pulso para empezar o seguir tu entreno.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryInline, .accessoryRectangular])
    }
}

/// The same face all day: nothing in it changes.
private struct Provider: TimelineProvider {
    struct Entry: TimelineEntry { let date: Date }

    func placeholder(in context: Context) -> Entry { Entry(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { completion(Entry(date: .now)) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        completion(Timeline(entries: [Entry(date: .now)], policy: .never))
    }
}

private struct ComplicationView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryCorner:
            mark(lineWidth: 3)
                .padding(4)
                .widgetLabel("Pulso")
        case .accessoryInline:
            Label("Pulso", systemImage: "waveform.path.ecg")
        case .accessoryRectangular:
            HStack(spacing: 8) {
                ZStack {
                    AccessoryWidgetBackground()
                    mark(lineWidth: 2.5).padding(8)
                }
                .frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: 0) {
                    Text("Pulso").font(.headline).widgetAccentable()
                    Text("Entrenar").font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
        default:
            ZStack {
                AccessoryWidgetBackground()
                mark(lineWidth: 3.5).padding(10)
            }
        }
    }

    /// The app icon's heartbeat in its colors; one tone on tinted faces.
    private func mark(lineWidth: CGFloat) -> some View {
        PulsoMark()
            .stroke(LinearGradient(colors: [Color(red: 1, green: 0.48, blue: 0.27), Color(red: 0.96, green: 0.2, blue: 0.37), Color(red: 0.54, green: 0.17, blue: 0.89)],
                                   startPoint: .leading, endPoint: .trailing),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
            .widgetAccentable()
    }
}

/// The app icon's line (Branding/pulso-icon.svg): a heartbeat that ends climbing.
private struct PulsoMark: Shape {
    func path(in rect: CGRect) -> Path {
        // The icon's coordinates, inside its 190…840 × 302…722 box.
        let box = CGRect(x: 190, y: 302, width: 650, height: 420)
        let scale = min(rect.width / box.width, rect.height / box.height)
        let origin = CGPoint(x: rect.midX - box.width * scale / 2, y: rect.midY - box.height * scale / 2)
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: origin.x + (x - box.minX) * scale, y: origin.y + (y - box.minY) * scale)
        }
        var path = Path()
        path.addLines([p(190, 612), p(340, 612), p(405, 482), p(480, 722), p(570, 302), p(650, 592), p(840, 402)])
        path.addLines([p(718, 402), p(840, 402), p(840, 524)])
        return path
    }
}
