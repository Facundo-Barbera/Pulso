import Charts
import SwiftUI

extension Double {
    /// "82,3" in the app's locale.
    func decimal(_ digits: Int = 1) -> String { formatted(.number.precision(.fractionLength(0...digits))) }
}

/// The latest scan, big: weight front and center, with fat %, muscle and score around it.
struct BodyHero: View {
    let scan: BodyScan
    let previous: BodyScan?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Label(scan.date.formatted(date: .abbreviated, time: .omitted), systemImage: "calendar")
                Spacer()
                Text(source)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .glassEffect(.regular, in: .capsule)
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .lineLimit(1)

            VStack(alignment: .leading, spacing: 2) {
                Text("Peso").font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Group {
                        Text(scan.weight?.decimal() ?? "—")
                            .font(.system(size: 64, weight: .bold, design: .rounded))
                            .contentTransition(.numericText())
                        Text("kg").font(.title3.weight(.semibold)).foregroundStyle(.secondary)
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    Spacer(minLength: 8)
                    if let delta = delta(.weight) { DeltaBadge(delta: delta, unit: "kg", lowerIsBetter: true).layoutPriority(1) }
                }
            }

            HStack(spacing: 10) {
                HeroStat(title: "Grasa", value: scan.percentBodyFat, unit: "%", delta: delta(.percentBodyFat), lowerIsBetter: true, color: Theme.fat)
                HeroStat(title: "Músculo", value: scan.skeletalMuscleMass, unit: "kg", delta: delta(.skeletalMuscleMass), lowerIsBetter: false, color: Theme.protein)
                HeroStat(title: "InBody", value: scan.inbodyScore, unit: "pts", delta: nil, lowerIsBetter: false, color: Theme.body)
            }
        }
        .padding(20)
        .background {
            RoundedRectangle(cornerRadius: Theme.corner + 8, style: .continuous)
                .fill(.background.secondary)
                .overlay {
                    RoundedRectangle(cornerRadius: Theme.corner + 8, style: .continuous)
                        .fill(LinearGradient(colors: [Theme.body.opacity(0.28), Theme.body.opacity(0.04)], startPoint: .topLeading, endPoint: .bottomTrailing))
                }
        }
        .fontDesign(.rounded)
    }

    private var source: String {
        if scan.source == "inbody" { return scan.device.map { "InBody \($0)" } ?? "InBody" }
        return "Manual"
    }

    private func delta(_ metric: BodyMetric) -> Double? {
        guard let previous, let now = metric.value(in: scan), let before = metric.value(in: previous) else { return nil }
        return now - before
    }
}

private struct HeroStat: View {
    let title: String
    let value: Double?
    let unit: String
    let delta: Double?
    let lowerIsBetter: Bool
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                Circle().fill(color).frame(width: 7, height: 7)
                Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            // A third of a 375 pt hero leaves ~70 pt inside: "38,4 kg" at large text shrinks rather than wraps.
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value?.decimal() ?? "—").font(.title2.bold()).contentTransition(.numericText())
                Text(unit).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            if let delta { DeltaBadge(delta: delta, unit: unit, lowerIsBetter: lowerIsBetter, compact: true) }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .glassEffect(.regular, in: .rect(cornerRadius: 14))
    }
}

/// "↓ 1,2 kg ✓": the arrow says which way it moved, the trailing checkmark or
/// exclamation whether that was the good way (blue) or not (orange), never hue alone.
struct DeltaBadge: View {
    let delta: Double
    let unit: String
    let lowerIsBetter: Bool
    var compact = false

    var body: some View {
        let good = abs(delta) < 0.05 ? nil : (delta < 0) == lowerIsBetter
        HStack(spacing: 3) {
            Label {
                Text("\(abs(delta).decimal()) \(unit)")
            } icon: {
                Image(systemName: abs(delta) < 0.05 ? "equal" : delta < 0 ? "arrow.down" : "arrow.up")
            }
            .labelStyle(.titleAndIcon)
            if let good {
                Image(systemName: good ? "checkmark" : "exclamationmark")
                    .imageScale(.small)
                    .accessibilityLabel(good ? "bien" : "a vigilar")
            }
        }
        .font(compact ? .caption2.weight(.bold) : .caption.weight(.bold))
        .foregroundStyle(good == nil ? Color.secondary : good! ? Theme.good : Theme.caution)
        .lineLimit(1)
    }
}

/// What the weight is made of (muscle, fat, the rest), water, and the other numbers on the sheet.
struct CompositionCard: View {
    let scan: BodyScan

    private struct Slice: Identifiable {
        let name: String
        let kg: Double
        let color: Color
        var id: String { name }
    }

    private var slices: [Slice] {
        guard let weight = scan.weight, let fat = scan.bodyFatMass else { return [] }
        let muscle = scan.skeletalMuscleMass ?? 0
        return [
            Slice(name: "Músculo", kg: muscle, color: Theme.protein),
            Slice(name: "Grasa", kg: fat, color: Theme.fat),
            Slice(name: "Resto magro", kg: max(weight - fat - muscle, 0), color: Theme.carbs.opacity(0.85)),
        ].filter { $0.kg > 0 }
    }

    var body: some View {
        Card {
            CardTitle(text: "Composición", systemImage: "chart.pie")
            if !slices.isEmpty {
                // Donut beside the legend needs ~320 pt ("Resto magro … 12,3 kg"); a 375 pt card has ~310.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 18) {
                        donut
                        legend
                    }
                    VStack(spacing: 16) {
                        donut
                        legend
                    }
                }
            }
            // Two columns on a 375 pt phone so "1.650 kcal" fits a tile; three from ~390 pt.
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 10)], spacing: 10) {
                ForEach(tiles, id: \.0) { title, value in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).font(.caption).foregroundStyle(.secondary).minimumScaleFactor(0.8)
                        Text(value).font(.headline).monospacedDigit().minimumScaleFactor(0.7)
                    }
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(.background.tertiary, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
        }
        .fontDesign(.rounded)
    }

    private var donut: some View {
        Chart(slices) { slice in
            SectorMark(angle: .value("kg", slice.kg), innerRadius: .ratio(0.62), angularInset: 2)
                .cornerRadius(5)
                .foregroundStyle(slice.color)
        }
        .chartBackground { _ in
            if let lean = scan.leanMass {
                VStack(spacing: 0) {
                    Text(lean.decimal()).font(.title3.bold())
                    Text("kg magro").font(.caption2).foregroundStyle(.secondary)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: 70)
            }
        }
        .frame(width: 128, height: 128)
    }

    private var legend: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(slices) { slice in
                HStack {
                    RoundedRectangle(cornerRadius: 3).fill(slice.color).frame(width: 10, height: 10)
                    Text(slice.name).font(.subheadline)
                    Spacer(minLength: 8)
                    Text("\(slice.kg.decimal()) kg").font(.subheadline.weight(.semibold)).monospacedDigit()
                }
            }
            if let water = scan.totalBodyWater {
                Divider()
                HStack {
                    Image(systemName: "drop.fill").foregroundStyle(Theme.water).frame(width: 10)
                    Text("Agua").font(.subheadline)
                    Spacer(minLength: 8)
                    Text("\(water.decimal()) L").font(.subheadline.weight(.semibold)).monospacedDigit()
                }
            }
        }
        .lineLimit(1)
    }

    private var tiles: [(String, String)] {
        let all: [(String, Double?, String, Int)] = [
            ("IMC", scan.bmi, "", 1),
            ("Grasa visceral", scan.visceralFatLevel, "", 0),
            ("Metab. basal", scan.bmr, " kcal", 0),
            ("Proteína", scan.protein, " kg", 1),
            ("Minerales", scan.mineral, " kg", 2),
            ("Cintura/cadera", scan.waistHipRatio, "", 2),
            ("ECW/TBW", scan.ecwRatio, "", 3),
            ("SMI", scan.smi, " kg/m²", 1),
            ("Ángulo de fase", scan.phaseAngle, "°", 1),
        ]
        return all.compactMap { title, value, unit, digits in value.map { (title, $0.decimal(digits) + unit) } }
    }
}

/// Every scan, newest first. Long-press to delete.
struct BodyHistoryCard: View {
    let scans: [BodyScan]
    let delete: (BodyScan) -> Void
    @State private var showAll = false

    /// InBody scans wear the scanner and the model ("570"); manual entries a pencil.
    private func sourceBadge(_ scan: BodyScan) -> some View {
        let inbody = scan.source == "inbody"
        return Image(systemName: inbody ? "qrcode.viewfinder" : "square.and.pencil")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(inbody ? Theme.body : .secondary)
            .frame(width: 36, height: 36)
            .background((inbody ? Theme.body : Color.secondary).opacity(0.14), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(alignment: .bottomTrailing) {
                if let device = scan.device {
                    Text(device)
                        .font(.system(size: 9, weight: .bold, design: .rounded))
                        .padding(.horizontal, 3)
                        .background(.background, in: RoundedRectangle(cornerRadius: 4))
                        .offset(x: 6, y: 5)
                }
            }
            .accessibilityLabel(inbody ? "InBody \(scan.device ?? "")" : "Manual")
    }

    private func summary(_ scan: BodyScan) -> String {
        let source = scan.source == "inbody" ? "InBody \(scan.device ?? "")".trimmingCharacters(in: .whitespaces) : "Manual"
        let values = [
            scan.percentBodyFat.map { "\($0.decimal()) % grasa" },
            scan.skeletalMuscleMass.map { "\($0.decimal()) kg músculo" },
        ].compactMap { $0 }
        return ([source] + values).joined(separator: " · ")
    }

    /// Weight, muscle and fat mass against the next older scan that measured each.
    private func deltas(_ scan: BodyScan) -> [(symbol: String, value: Double, lowerIsBetter: Bool)] {
        let older = scans.drop { $0.id != scan.id }.dropFirst()
        let metrics: [(String, BodyMetric)] = [("scalemass.fill", .weight), ("figure.strengthtraining.traditional", .skeletalMuscleMass), ("drop.fill", .bodyFatMass)]
        return metrics.compactMap { symbol, metric in
            guard let now = metric.value(in: scan), let before = older.lazy.compactMap({ metric.value(in: $0) }).first else { return nil }
            return (symbol, now - before, metric.lowerIsBetter)
        }
    }

    var body: some View {
        Card {
            CardTitle(text: "Historial", systemImage: "clock.arrow.circlepath")
            ForEach(showAll ? scans : Array(scans.prefix(5))) { scan in
                HStack(alignment: .top, spacing: 12) {
                    sourceBadge(scan)
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(scan.date.formatted(date: .abbreviated, time: .omitted)).font(.subheadline.weight(.semibold))
                            Spacer(minLength: 8)
                            Text(scan.weight.map { "\($0.decimal()) kg" } ?? "—").font(.subheadline.weight(.semibold)).monospacedDigit()
                        }
                        Text(summary(scan)).font(.caption).foregroundStyle(.secondary)
                        let deltas = deltas(scan)
                        if !deltas.isEmpty {
                            // Three chips fit a 375 pt row at default text; stacked at large Dynamic Type.
                            AdaptiveStack(horizontalAlignment: .leading, spacing: 6) {
                                ForEach(deltas, id: \.symbol) { delta in
                                    HStack(spacing: 3) {
                                        Image(systemName: delta.symbol).imageScale(.small).foregroundStyle(.secondary)
                                        DeltaBadge(delta: delta.value, unit: "kg", lowerIsBetter: delta.lowerIsBetter, compact: true)
                                    }
                                    .font(.caption2)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 3)
                                    .background(.background.tertiary, in: .capsule)
                                }
                            }
                        }
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                }
                .padding(.vertical, 4)
                .contentShape(Rectangle())
                .contextMenu {
                    Button("Borrar medición", systemImage: "trash", role: .destructive) { delete(scan) }
                }
            }
            if scans.count > 5 {
                Button(showAll ? "Ver menos" : "Ver las \(scans.count)") { withAnimation(.snappy) { showAll.toggle() } }
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.top, 4)
            }
        }
        .fontDesign(.rounded)
    }
}

// MARK: - Previews

private let previewScan = BodyScan(
    id: "1", measuredAt: 1_790_838_000_000, source: "inbody", device: "770",
    weight: 103.4, skeletalMuscleMass: 38.45, bodyFatMass: 27.85, percentBodyFat: 26.9,
    bmi: 31.2, visceralFatLevel: 12, bmr: 1_948, totalBodyWater: 55.35, ecwRatio: 0.385, inbodyScore: 78,
    protein: 14.85, mineral: 5.12, smi: 10.4, waistHipRatio: 0.96, phaseAngle: 6.1,
    segmentalLean: Segmental(rightArm: 4.12, leftArm: 4.05, trunk: 31.84, rightLeg: 11.42, leftLeg: 11.38),
    segmentalFat: Segmental(rightArm: 2.24, leftArm: 2.31, trunk: 14.65, rightLeg: 4.12, leftLeg: 4.18)
)

#Preview("Cuerpo · 375 pt · XXL") {
    var previous = previewScan
    previous.weight = 104.6
    previous.percentBodyFat = 27.8
    previous.skeletalMuscleMass = 38.1
    return NarrowPreview(dynamicType: .xxLarge) {
        BodyHero(scan: previewScan, previous: previous)
        CompositionCard(scan: previewScan)
        BodyHistoryCard(scans: [previewScan, previous]) { _ in }
    }
}
