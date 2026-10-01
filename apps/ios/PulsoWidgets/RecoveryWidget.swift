import SwiftUI
import WidgetKit

/// Recuperación: today's readiness ring.
struct RecoveryWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKind.recovery, provider: SnapshotProvider()) { entry in
            RecoveryWidgetView(entry: entry)
        }
        .configurationDisplayName("Recuperación")
        .description("Tu recuperación de hoy, de sueño, VFC y pulso en reposo.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct RecoveryWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    private var recovery: WidgetSnapshot.Recovery? { entry.snapshot?.recovery }
    private var score: Int? { recovery?.score }
    private var scoreText: String { score.map(String.init) ?? "–" }
    private var color: Color { WidgetStyle.recoveryColor(score) }

    var body: some View {
        switch family {
        case .accessoryCircular:
            Gauge(value: Double(score ?? 0), in: 0...100) {
                Image(systemName: "heart.fill")
            } currentValueLabel: {
                Text(scoreText).fontDesign(.rounded)
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .containerBackground(for: .widget) { AccessoryWidgetBackground() }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Label("Recuperación", systemImage: "heart.fill").font(.caption.weight(.semibold))
                Text(score.map { "\($0) · \(recovery?.levelLabel ?? "")" } ?? "Sin datos")
                    .font(.title3.weight(.bold))
                    .fontDesign(.rounded)
                    .widgetAccentable()
                if let explanation = recovery?.explanation, !explanation.isEmpty {
                    Text(explanation).font(.caption2).lineLimit(1).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .containerBackground(for: .widget) {}
        case .accessoryInline:
            Label(score.map { "Recuperación \($0) · \(recovery?.levelLabel ?? "")" } ?? "Recuperación sin datos", systemImage: "heart.fill")
                .containerBackground(for: .widget) {}
        default:
            small.pulsoBackground(color)
        }
    }

    @ViewBuilder private var small: some View {
        if let recovery {
            VStack(alignment: .leading, spacing: 6) {
                WidgetHeader(title: "Recuperación", systemImage: "heart.fill", color: color)
                WidgetRing(progress: Double(score ?? 0) / 100, color: color, lineWidth: 10) {
                    Text(scoreText)
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                        .contentTransition(.numericText())
                        .minimumScaleFactor(0.6)
                }
                .frame(maxWidth: .infinity)
                Text(recovery.levelLabel)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(color)
                    .frame(maxWidth: .infinity)
            }
        } else {
            WidgetEmpty(systemImage: "heart.text.square", text: entry.paired ? "Sincronizá Salud en Pulso para ver tu recuperación" : WidgetStyle.unpaired, color: Theme.body)
        }
    }
}

#Preview(as: .systemSmall) {
    RecoveryWidget()
} timeline: {
    SnapshotEntry(date: .now, snapshot: .preview, paired: true)
    SnapshotEntry(date: .now, snapshot: nil, paired: false)
}
