import SwiftUI
import WidgetKit

/// Macros restantes: kcal and protein left for today.
struct MacrosWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKind.macros, provider: SnapshotProvider()) { entry in
            MacrosWidgetView(entry: entry)
        }
        .configurationDisplayName("Macros restantes")
        .description("Las calorías y la proteína que te quedan hoy.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct MacrosWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    private var macros: WidgetSnapshot.Macros? { entry.snapshot?.macros(on: WidgetClock.date(entry.date)) }
    private var hasTargets: Bool { macros?.kcalTarget != nil }

    var body: some View {
        switch family {
        case .accessoryCircular:
            Gauge(value: macros?.kcalProgress ?? 0) {
                Image(systemName: "flame.fill")
            } currentValueLabel: {
                Text(macros?.kcalLeft.map(WidgetStyle.number) ?? "–").fontDesign(.rounded).minimumScaleFactor(0.5)
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .containerBackground(for: .widget) { AccessoryWidgetBackground() }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Label(hasTargets ? "Te quedan" : "Comido hoy", systemImage: "fork.knife").font(.caption.weight(.semibold))
                Text("\(kcalText) kcal").font(.title3.weight(.bold)).fontDesign(.rounded).widgetAccentable()
                Text("\(proteinText) g de proteína").font(.caption2).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .containerBackground(for: .widget) {}
        case .accessoryInline:
            Label(macros == nil ? "Dieta sin datos" : "\(kcalText) kcal · \(proteinText) g prot.", systemImage: "fork.knife")
                .containerBackground(for: .widget) {}
        case .systemMedium:
            medium.pulsoBackground(Theme.energy)
        default:
            small.pulsoBackground(Theme.energy)
        }
    }

    /// What's left with targets, what was eaten without.
    private var kcalText: String { macros.map { WidgetStyle.number($0.kcalLeft ?? $0.kcal) } ?? "–" }
    private var proteinText: String { macros.map { WidgetStyle.number($0.proteinLeft ?? $0.protein) } ?? "–" }

    @ViewBuilder private var small: some View {
        if let macros {
            VStack(alignment: .leading, spacing: 4) {
                WidgetHeader(title: "Dieta", systemImage: "fork.knife", color: Theme.energy)
                Spacer(minLength: 0)
                Text(kcalText)
                    .font(.system(size: 38, weight: .bold, design: .rounded))
                    .contentTransition(.numericText())
                    .minimumScaleFactor(0.6)
                Text(hasTargets ? "kcal restantes" : "kcal hoy")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                bar("Proteína", "\(proteinText) g", macros.proteinProgress, Theme.protein)
            }
        } else {
            WidgetEmpty(systemImage: "fork.knife.circle", text: entry.paired ? "Registrá tu primera comida en Pulso" : WidgetStyle.unpaired, color: Theme.energy)
        }
    }

    @ViewBuilder private var medium: some View {
        if let macros {
            HStack(spacing: 18) {
                ring("kcal", kcalText, macros.kcalProgress, Theme.energy)
                ring("g proteína", proteinText, macros.proteinProgress, Theme.protein)
                VStack(alignment: .leading, spacing: 6) {
                    WidgetHeader(title: "Dieta", systemImage: "fork.knife", color: Theme.energy)
                    Text(hasTargets ? "Lo que te queda hoy" : "Lo que comiste hoy")
                        .font(.subheadline.weight(.semibold))
                    if let target = macros.kcalTarget {
                        Text("\(WidgetStyle.number(macros.kcal)) de \(WidgetStyle.number(target)) kcal")
                            .font(.caption).foregroundStyle(.secondary)
                    } else {
                        Text("Fijá tus objetivos en Dieta").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            WidgetEmpty(systemImage: "fork.knife.circle", text: entry.paired ? "Registrá tu primera comida en Pulso" : WidgetStyle.unpaired, color: Theme.energy)
        }
    }

    private func ring(_ unit: String, _ value: String, _ progress: Double, _ color: Color) -> some View {
        WidgetRing(progress: progress, color: color, lineWidth: 9) {
            VStack(spacing: 0) {
                Text(value).font(.system(.headline, design: .rounded, weight: .bold)).minimumScaleFactor(0.6)
                Text(unit).font(.system(size: 9, weight: .medium)).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 6)
        }
        .frame(width: 86, height: 86)
    }

    private func bar(_ label: String, _ value: String, _ progress: Double, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label).font(.caption2.weight(.medium)).foregroundStyle(.secondary)
                Spacer()
                Text(value).font(.caption.weight(.semibold)).fontDesign(.rounded)
            }
            Capsule()
                .fill(color.opacity(0.18))
                .frame(height: 6)
                .overlay(alignment: .leading) {
                    GeometryReader { geo in
                        Capsule().fill(color.gradient).frame(width: max(geo.size.width * progress, 6))
                    }
                }
        }
    }
}

#Preview(as: .systemMedium) {
    MacrosWidget()
} timeline: {
    SnapshotEntry(date: .now, snapshot: .preview, paired: true)
}
