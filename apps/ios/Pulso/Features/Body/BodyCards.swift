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

            VStack(alignment: .leading, spacing: 2) {
                Text("Peso").font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(scan.weight?.decimal() ?? "—")
                        .font(.system(size: 64, weight: .bold, design: .rounded))
                        .contentTransition(.numericText())
                    Text("kg").font(.title3.weight(.semibold)).foregroundStyle(.secondary)
                    Spacer()
                    if let delta = delta(.weight) { DeltaBadge(delta: delta, unit: "kg", lowerIsBetter: true) }
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
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value?.decimal() ?? "—").font(.title2.bold()).contentTransition(.numericText())
                Text(unit).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            if let delta { DeltaBadge(delta: delta, unit: unit, lowerIsBetter: lowerIsBetter, compact: true) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .glassEffect(.regular, in: .rect(cornerRadius: 14))
    }
}

/// "▼ 1,2 kg" in green when it moved the good way.
struct DeltaBadge: View {
    let delta: Double
    let unit: String
    let lowerIsBetter: Bool
    var compact = false

    var body: some View {
        let good = abs(delta) < 0.05 ? nil : (delta < 0) == lowerIsBetter
        Label {
            Text("\(abs(delta).decimal()) \(unit)")
        } icon: {
            Image(systemName: abs(delta) < 0.05 ? "equal" : delta < 0 ? "arrow.down" : "arrow.up")
        }
        .font(compact ? .caption2.weight(.bold) : .caption.weight(.bold))
        .foregroundStyle(good == nil ? Color.secondary : good! ? Color.green : Color.orange)
        .labelStyle(.titleAndIcon)
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
                HStack(spacing: 18) {
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
                        }
                    }
                    .frame(width: 128, height: 128)

                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(slices) { slice in
                            HStack {
                                RoundedRectangle(cornerRadius: 3).fill(slice.color).frame(width: 10, height: 10)
                                Text(slice.name).font(.subheadline)
                                Spacer()
                                Text("\(slice.kg.decimal()) kg").font(.subheadline.weight(.semibold)).monospacedDigit()
                            }
                        }
                        if let water = scan.totalBodyWater {
                            Divider()
                            HStack {
                                Image(systemName: "drop.fill").foregroundStyle(Theme.fat).frame(width: 10)
                                Text("Agua").font(.subheadline)
                                Spacer()
                                Text("\(water.decimal()) L").font(.subheadline.weight(.semibold)).monospacedDigit()
                            }
                        }
                    }
                }
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 10)], spacing: 10) {
                ForEach(tiles, id: \.0) { title, value in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).font(.caption).foregroundStyle(.secondary)
                        Text(value).font(.headline).monospacedDigit()
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(.background.tertiary, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
        }
        .fontDesign(.rounded)
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

/// Lean and fat per segment, as paired bars.
struct SegmentalCard: View {
    let scan: BodyScan

    private let rows: [(String, KeyPath<Segmental, Double>)] = [
        ("Brazo der.", \.rightArm), ("Brazo izq.", \.leftArm), ("Tronco", \.trunk), ("Pierna der.", \.rightLeg), ("Pierna izq.", \.leftLeg),
    ]

    var body: some View {
        Card {
            CardTitle(text: "Por segmento", systemImage: "figure.stand")
            HStack {
                Spacer()
                Label("Magro", systemImage: "circle.fill").foregroundStyle(Theme.protein)
                Label("Grasa", systemImage: "circle.fill").foregroundStyle(Theme.fat)
            }
            .font(.caption2.weight(.semibold))
            .labelStyle(.titleAndIcon)
            .imageScale(.small)
            ForEach(rows, id: \.0) { name, key in
                let lean = scan.segmentalLean?[keyPath: key]
                let fat = scan.segmentalFat?[keyPath: key]
                let scale = key == \Segmental.trunk ? trunkMax : limbMax
                HStack(spacing: 10) {
                    Text(name).font(.subheadline).frame(width: 88, alignment: .leading)
                    VStack(alignment: .leading, spacing: 4) {
                        bar(lean, of: scale, color: Theme.protein)
                        bar(fat, of: scale, color: Theme.fat)
                    }
                }
            }
        }
        .fontDesign(.rounded)
    }

    private var limbMax: Double { max(values([\.rightArm, \.leftArm, \.rightLeg, \.leftLeg]).max() ?? 1, 1) }
    private var trunkMax: Double { max(values([\.trunk]).max() ?? 1, 1) }
    private func values(_ keys: [KeyPath<Segmental, Double>]) -> [Double] {
        keys.flatMap { key in [scan.segmentalLean?[keyPath: key], scan.segmentalFat?[keyPath: key]].compactMap { $0 } }
    }

    @ViewBuilder private func bar(_ value: Double?, of max: Double, color: Color) -> some View {
        if let value {
            HStack(spacing: 6) {
                GeometryReader { geo in
                    Capsule().fill(color.gradient).frame(width: Swift.max(geo.size.width * value / max, 4))
                }
                .frame(height: 8)
                Text(value.decimal(2)).font(.caption.weight(.semibold)).monospacedDigit().frame(width: 40, alignment: .trailing)
            }
        }
    }
}

/// Every scan, newest first. Long-press to delete.
struct BodyHistoryCard: View {
    let scans: [BodyScan]
    let delete: (BodyScan) -> Void
    @State private var showAll = false

    var body: some View {
        Card {
            CardTitle(text: "Historial", systemImage: "clock.arrow.circlepath")
            ForEach(showAll ? scans : Array(scans.prefix(5))) { scan in
                HStack {
                    Image(systemName: scan.source == "inbody" ? "qrcode" : "square.and.pencil")
                        .foregroundStyle(Theme.body)
                        .frame(width: 24)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(scan.date.formatted(date: .abbreviated, time: .shortened)).font(.subheadline.weight(.medium))
                        Text(scan.source == "inbody" ? "InBody \(scan.device ?? "")" : "Manual").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(scan.weight.map { "\($0.decimal()) kg" } ?? "—").font(.subheadline.weight(.semibold))
                        Text(scan.percentBodyFat.map { "\($0.decimal())% grasa" } ?? "").font(.caption).foregroundStyle(.secondary)
                    }
                    .monospacedDigit()
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
