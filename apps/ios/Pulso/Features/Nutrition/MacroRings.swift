import SwiftUI

/// One progress ring. Past 100 % it keeps going with a darker second lap.
struct ProgressRing: View {
    let progress: Double
    let color: Color
    var lineWidth: CGFloat = 10

    var body: some View {
        ZStack {
            Circle().stroke(color.opacity(0.16), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: min(progress, 1))
                .stroke(
                    AngularGradient(colors: [color.mix(with: .white, by: 0.15), color], center: .center),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            if progress > 1 {
                Circle()
                    .trim(from: 0, to: min(progress - 1, 1))
                    .stroke(color.mix(with: .black, by: 0.35), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
        }
        .animation(.snappy(duration: 0.7), value: progress)
    }
}

extension NutrientZone {
    /// One lap of the ring: room past the zone's max (or 125 % of the target) so the zone and some overflow both show.
    var ringFull: Double { Swift.max(target * 1.25, (max ?? target) * 1.1, 1) }

    /// Where `value` sits on the ring, in laps (past 1 it goes round again).
    func laps(_ value: Double) -> Double { Swift.max(value / ringFull, 0) }

    /// The zone's marks on the ring, in laps.
    var marks: RingMarks { RingMarks(min: min.map(laps), max: max.map(laps), target: laps(target)) }

    /// «Faltan 42 g», «En tu zona» («Mínimo cumplido» for a minimum), «Te pasaste 120 kcal».
    func line(_ unit: String) -> String {
        switch status {
        case .below: "Faltan \(Int(Swift.max(1, ((min ?? 0) - value).rounded())).formatted()) \(unit)"
        case .above: "Te pasaste \(Int(Swift.max(1, (value - (max ?? 0)).rounded())).formatted()) \(unit)"
        case .inZone: kind == .min ? "Mínimo cumplido" : "En tu zona"
        }
    }

    /// «mín. 150 g», «1.800–2.100 kcal», «máx. 70 g».
    func range(_ unit: String) -> String {
        let n = { (v: Double?) in Int((v ?? 0).rounded()).formatted() }
        if kind == .min || max == nil { return "mín. \(n(min)) \(unit)" }
        if kind == .max || min == nil { return "máx. \(n(max)) \(unit)" }
        return "\(n(min))–\(n(max)) \(unit)"
    }

    /// The status as a symbol, so it never rests on colour: ↓ short of the zone, ✓ in it, ↑ past it.
    var statusSymbol: String {
        switch status {
        case .below: "arrow.down.circle"
        case .inZone: "checkmark.circle.fill"
        case .above: "arrow.up.circle.fill"
        }
    }

    /// The symbol's tint: quiet below, blue in the zone, orange past it — never green against red.
    var statusColor: Color {
        switch status {
        case .below: .secondary
        case .inZone: Theme.good
        case .above: Theme.caution
        }
    }
}

/// A target zone on a ring, in laps.
struct RingMarks: Equatable {
    var min: Double?
    var max: Double?
    var target: Double
}

/// One ring in the manner of Apple's Activity rings: a tinted track, the arc from 12 o'clock with the
/// nutrient's symbol at its start, and past a full lap a second lap whose end casts a shadow on the first.
/// With `marks` it also shows the zone without relying on colour: the track between min and max is
/// hatched, both ends are cut like brackets, the target is a notched tick, and whatever lies past the
/// max is hatched on the arc itself. The view's frame holds the whole stroke.
struct ActivityRing: View {
    let progress: Double
    let color: Color
    let symbol: String
    var lineWidth: CGFloat = 22
    var marks: RingMarks?

    @Environment(\.accessibilityDifferentiateWithoutColor) private var differentiate

    var body: some View {
        let lap = Swift.min(progress, 1)
        let second = Swift.min(Swift.max(progress - 1, 0), 1)
        ZStack {
            Circle().stroke(color.opacity(0.22), lineWidth: lineWidth)
            if let marks { zoneBand(marks, filled: lap) }
            if lap > 0 {
                RingCap(fraction: 0, lineWidth: lineWidth).fill(color.mix(with: .black, by: 0.08))
                Circle()
                    .trim(from: 0, to: lap)
                    .stroke(
                        AngularGradient(colors: [color.mix(with: .black, by: 0.08), color], center: .center, startAngle: .zero, endAngle: .degrees(360 * Swift.max(lap, 0.01))),
                        style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                    )
            }
            if second > 0 {
                RingCap(fraction: second, lineWidth: lineWidth)
                    .fill(color)
                    .shadow(color: .black.opacity(0.55), radius: lineWidth / 4)
                Circle()
                    .trim(from: 0, to: second)
                    .stroke(color.mix(with: .white, by: 0.12), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
            }
            if let marks, let max = marks.max, progress > max {
                hatch(from: Swift.min(max, 1), to: lap, ink: .black.opacity(0.32))
                if second > 0 { hatch(from: 0, to: second, ink: .black.opacity(0.32)) }
            }
            if let marks { cuts(marks) }
        }
        .rotationEffect(.degrees(-90))
        .compositingGroup()
        .overlay(alignment: .top) {
            Image(systemName: symbol)
                .font(.system(size: lineWidth * 0.52, weight: .bold))
                .foregroundStyle(lap > 0 ? Color.black.opacity(0.78) : color)
                .frame(width: lineWidth, height: lineWidth)
                .offset(y: -lineWidth / 2)
        }
        .padding(lineWidth / 2)
        .animation(.snappy(duration: 0.7), value: progress)
        .accessibilityHidden(true)
    }

    /// The zone on the unfilled track: a faint band with a comb of light stripes; with
    /// "Diferenciar sin color" the comb also runs over the filled part, darker.
    @ViewBuilder
    private func zoneBand(_ marks: RingMarks, filled lap: Double) -> some View {
        let from = Swift.min(marks.min ?? 0, 1), to = Swift.min(marks.max ?? marks.target, 1)
        Circle().trim(from: from, to: to).stroke(Color.primary.opacity(0.10), lineWidth: lineWidth)
        if lap < to { hatch(from: Swift.max(from, lap), to: to, ink: Color.primary.opacity(0.45)) }
        if differentiate, lap > from { hatch(from: from, to: Swift.min(lap, to), ink: .black.opacity(0.25)) }
    }

    /// Short radial stripes along the ring: a dash pattern on a narrower stroke.
    private func hatch(from: Double, to: Double, ink: some ShapeStyle) -> some View {
        Circle()
            .trim(from: from, to: Swift.max(from, to))
            .stroke(ink, style: StrokeStyle(lineWidth: lineWidth * 0.6, dash: [1.5, 3.5]))
    }

    /// Bracket cuts through the ring at min and max, and the target: a wider cut holding a tick, notched at the rim.
    @ViewBuilder
    private func cuts(_ marks: RingMarks) -> some View {
        ForEach([marks.min, marks.max].compactMap { $0 }.filter { $0 > 0 && $0 < 1 }, id: \.self) { at in
            RingTick(fraction: at, lineWidth: lineWidth).stroke(.black, lineWidth: 2).blendMode(.destinationOut)
        }
        if marks.target < 1 {
            RingTick(fraction: marks.target, lineWidth: lineWidth).stroke(.black, lineWidth: 6).blendMode(.destinationOut)
            RingTick(fraction: marks.target, lineWidth: lineWidth).stroke(.primary, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
            RingNotch(fraction: marks.target, lineWidth: lineWidth).fill(.primary)
        }
    }
}

/// A line across the ring's stroke at `fraction` of a lap (0 = the +x axis; the ring is rotated).
private struct RingTick: Shape {
    var fraction: Double
    let lineWidth: CGFloat

    var animatableData: Double {
        get { fraction }
        set { fraction = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let radius = Swift.min(rect.width, rect.height) / 2
        let angle = fraction * 2 * .pi
        let point = { (r: CGFloat) in CGPoint(x: rect.midX + r * cos(angle), y: rect.midY + r * sin(angle)) }
        var path = Path()
        path.move(to: point(radius - lineWidth / 2))
        path.addLine(to: point(radius + lineWidth / 2))
        return path
    }
}

/// The target's notch: a small triangle at the ring's outer rim pointing in.
private struct RingNotch: Shape {
    var fraction: Double
    let lineWidth: CGFloat

    var animatableData: Double {
        get { fraction }
        set { fraction = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let radius = Swift.min(rect.width, rect.height) / 2
        let rim = radius + lineWidth / 2
        let angle = fraction * 2 * .pi
        let spread = (lineWidth * 0.32) / rim
        let point = { (r: CGFloat, a: Double) in CGPoint(x: rect.midX + r * cos(a), y: rect.midY + r * sin(a)) }
        var path = Path()
        path.move(to: point(rim, angle - spread))
        path.addLine(to: point(rim - lineWidth * 0.38, angle))
        path.addLine(to: point(rim, angle + spread))
        path.closeSubpath()
        return path
    }
}

/// A round end of the ring's stroke at `fraction` of a lap.
private struct RingCap: Shape {
    var fraction: Double
    let lineWidth: CGFloat

    var animatableData: Double {
        get { fraction }
        set { fraction = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let radius = Swift.min(rect.width, rect.height) / 2
        let angle = fraction * 2 * .pi
        let center = CGPoint(x: rect.midX + radius * cos(angle), y: rect.midY + radius * sin(angle))
        return Path(ellipseIn: CGRect(x: center.x - lineWidth / 2, y: center.y - lineWidth / 2, width: lineWidth, height: lineWidth))
    }
}

/// The hero: concentric kcal / protein / carbs / fat rings like Apple's Activity rings, each with its
/// symbol at its start and its target zone marked; under them the day's kcal and where it stands, and
/// a tile per macro that repeats the ring's symbol and says in words (and an icon) how far it is from its zone.
struct MacroHero: View {
    let summary: NutritionSummary
    let onSetTargets: () -> Void

    private struct Nutrient {
        let key: String, title: String, color: Color, symbol: String
    }

    private static let kcal = Nutrient(key: "kcal", title: "Calorías", color: Theme.energy, symbol: Theme.energySymbol)
    private static let macros = [
        Nutrient(key: "protein", title: "Proteína", color: Theme.protein, symbol: Theme.proteinSymbol),
        Nutrient(key: "carbs", title: "Carbos", color: Theme.carbs, symbol: Theme.carbsSymbol),
        Nutrient(key: "fat", title: "Grasa", color: Theme.fat, symbol: Theme.fatSymbol),
    ]

    private static let lineWidth: CGFloat = 22
    private static let gap: CGFloat = 3
    private static let size: CGFloat = 228

    var body: some View {
        let zones = summary.zones
        VStack(spacing: 18) {
            ZStack {
                ForEach(Array(([Self.kcal] + Self.macros).enumerated()), id: \.offset) { index, n in
                    ring(n).padding(CGFloat(index) * (Self.lineWidth + Self.gap))
                }
            }
            .frame(width: Self.size, height: Self.size)
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilitySummary)

            kcalReadout(zone: zones?["kcal"])

            if summary.targets == nil {
                Button("Fijar objetivos", systemImage: "target", action: onSetTargets)
                    .buttonStyle(.glassProminent)
            } else {
                HStack(spacing: 10) {
                    ForEach(Self.macros, id: \.key) { n in
                        tile(n, summary.totals[n.key] ?? 0, zones?[n.key], summary.targets?[n.key])
                    }
                }
            }
        }
        .fontDesign(.rounded)
        .sensoryFeedback(.success, trigger: zones?["kcal"]?.status) { old, new in old != nil && new == .inZone }
    }

    private func ring(_ n: Nutrient) -> some View {
        let value = summary.totals[n.key] ?? 0
        let zone = summary.zones?[n.key]
        let progress = zone.map { $0.laps(value) } ?? summary.targets?[n.key].flatMap { $0 > 0 ? value / $0 : nil } ?? 0
        return ActivityRing(progress: progress, color: n.color, symbol: n.symbol, lineWidth: Self.lineWidth, marks: zone?.marks)
    }

    private func kcalReadout(zone: NutrientZone?) -> some View {
        VStack(spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Image(systemName: Self.kcal.symbol).font(.title3).foregroundStyle(Self.kcal.color)
                Text(summary.totals.kcal, format: .number.precision(.fractionLength(0)))
                    .font(.system(size: 34, weight: .bold))
                    .monospacedDigit()
                    .contentTransition(.numericText(value: summary.totals.kcal))
                Text("kcal").font(.headline).foregroundStyle(.secondary)
            }
            .animation(.snappy, value: summary.totals.kcal)
            if let zone {
                StatusLine(zone: zone, unit: "kcal").font(.subheadline.weight(.semibold))
                Text("Tu zona: \(zone.range("kcal")) · la muesca es tu objetivo de \(Int(zone.target).formatted())")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            } else if let target = summary.targets?.kcal {
                let left = target - summary.totals.kcal
                Text(left >= 0 ? "Quedan \(Int(left).formatted()) de \(Int(target).formatted()) kcal" : "\(Int(-left).formatted()) kcal por encima de \(Int(target).formatted())")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .lineLimit(2)
        .minimumScaleFactor(0.7)
    }

    private func tile(_ n: Nutrient, _ value: Double, _ zone: NutrientZone?, _ target: Double?) -> some View {
        VStack(spacing: 4) {
            Label {
                Text(n.title).foregroundStyle(.secondary)
            } icon: {
                Image(systemName: n.symbol).foregroundStyle(n.color)
            }
            .font(.caption)
            .labelStyle(.titleAndIcon)
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                Text(value, format: .number.precision(.fractionLength(0)))
                    .font(.headline).monospacedDigit()
                    .contentTransition(.numericText(value: value))
                if zone == nil, let target {
                    Text("/\(Int(target)) g").font(.caption2).foregroundStyle(.secondary)
                } else {
                    Text(" g").font(.caption2).foregroundStyle(.secondary)
                }
            }
            if let zone {
                StatusLine(zone: zone, unit: "g").font(.caption2.weight(.semibold))
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .padding(.horizontal, 4)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(n.color.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .animation(.snappy, value: value)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(zone.map { "\(n.title): \(Int(value)) g. \($0.line("g")). Zona \($0.range("g"))" } ?? "\(n.title): \(Int(value)) g")
    }

    private var accessibilitySummary: String {
        let kcal = "\(Int(summary.totals.kcal).formatted()) kilocalorías"
        guard let zones = summary.zones else { return kcal }
        let parts = [("kcal", "Calorías", "kcal")] + Self.macros.map { ($0.key, $0.title, "g") }
        return ([kcal] + parts.compactMap { key, title, unit in zones[key].map { "\(title): \($0.line(unit))" } }).joined(separator: ". ")
    }
}

/// «✓ En tu zona», «↓ Faltan 47 g», «↑ Te pasaste 120 kcal»: the words in ink, the symbol tinted.
private struct StatusLine: View {
    let zone: NutrientZone
    let unit: String

    var body: some View {
        Label {
            Text(zone.line(unit)).foregroundStyle(zone.status == .below ? .secondary : .primary)
        } icon: {
            Image(systemName: zone.statusSymbol).foregroundStyle(zone.statusColor)
        }
        .labelStyle(StatusLabelStyle())
        .contentTransition(.numericText(value: zone.value))
    }
}

private struct StatusLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 3) { configuration.icon; configuration.title }
    }
}

extension NutritionMacros {
    subscript(nutrient: String) -> Double? {
        switch nutrient {
        case "kcal": kcal
        case "protein": protein
        case "carbs": carbs
        case "fat": fat
        case "fiber": fiber
        default: nil
        }
    }
}

/// "P 30 · C 45 · G 12" in the macro colors; the letters, not the colours, say which is which.
struct MacroLine: View {
    let macros: NutritionMacros

    var body: some View {
        HStack(spacing: 8) {
            part("P", macros.protein, Theme.protein)
            part("C", macros.carbs, Theme.carbs)
            part("G", macros.fat, Theme.fat)
        }
        .font(.caption.monospacedDigit())
        .fontDesign(.rounded)
        .lineLimit(1)
    }

    private func part(_ letter: String, _ value: Double, _ color: Color) -> some View {
        HStack(spacing: 2) {
            Text(letter).fontWeight(.bold).foregroundStyle(color)
            Text(value, format: .number.precision(.fractionLength(0))).foregroundStyle(.secondary)
        }
    }
}

// MARK: - Previews

/// A day's zones as the engine would send them, for previews: kcal ±5 %, protein a minimum, carbs and fat −20/+10 %.
func previewZones(kcal: Double, protein: Double, carbs: Double, fat: Double) -> NutritionSummary {
    func zone(_ value: Double, _ target: Double, _ kind: TargetZone.Kind, _ low: Double, _ high: Double) -> NutrientZone {
        let min = (target * low).rounded(), max = (target * high).rounded()
        let status: NutrientZone.Status = value < min ? .below : (kind != .min && value > max ? .above : .inZone)
        return NutrientZone(kind: kind, min: min, max: max, custom: false, value: value, target: target, status: status)
    }
    let zones = [
        "kcal": zone(kcal, 2_200, .range, 0.95, 1.05), "protein": zone(protein, 160, .min, 1, 1.25),
        "carbs": zone(carbs, 230, .range, 0.8, 1.1), "fat": zone(fat, 70, .range, 0.8, 1.1), "fiber": zone(20, 30, .min, 1, 1.25),
    ]
    return NutritionSummary(date: "2026-10-01", totals: NutritionMacros(kcal: kcal, protein: protein, carbs: carbs, fat: fat, fiber: 20),
                            targets: previewNutritionSummary.targets, remaining: nil, bySlot: [:], entries: 3, zones: zones,
                            inZone: zones["kcal"]!.status == .inZone && zones["protein"]!.status != .below)
}

#Preview("Anillos · por debajo") {
    NarrowPreview { Card { MacroHero(summary: previewZones(kcal: 1_510, protein: 118, carbs: 158, fat: 52)) {} } }
}

#Preview("Anillos · en zona") {
    NarrowPreview { Card { MacroHero(summary: previewZones(kcal: 2_180, protein: 171, carbs: 214, fat: 66)) {} } }
}

#Preview("Anillos · te pasaste · segunda vuelta · claro") {
    NarrowPreview { Card { MacroHero(summary: previewZones(kcal: 2_520, protein: 230, carbs: 380, fat: 92)) {} } }
        .preferredColorScheme(.light)
}

#Preview("Anillos · proteína al mínimo · XXL") {
    NarrowPreview(dynamicType: .xxLarge) { Card { MacroHero(summary: previewZones(kcal: 1_900, protein: 162, carbs: 180, fat: 60)) {} } }
}

#Preview("Anillos · deuteranopía simulada") {
    NarrowPreview {
        ColorBlindnessPreview(kind: .deuteranopia, width: 343) {
            Card { MacroHero(summary: previewZones(kcal: 1_536, protein: 113, carbs: 120, fat: 67)) {} }
        }
    }
}
