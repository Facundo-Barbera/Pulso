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
    /// The zone bar's full width: room past the zone's max (or 125 % of the target) so the zone and some overflow both show.
    var scaleFull: Double { Swift.max(target * 1.25, (max ?? target) * 1.1, 1) }

    /// Where `value` sits on the zone bar, 0…1.
    func fraction(_ value: Double) -> Double { Swift.min(Swift.max(value / scaleFull, 0), 1) }

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

/// One ring in the manner of Apple's Activity rings, and only that: progress toward the target (a full
/// lap is 100 %), a tinted track, the nutrient's symbol at the start, and past 100 % a second lap whose
/// end casts a shadow on the first. The zone lives in the tile's `ZoneBar`. The frame holds the whole stroke.
struct ActivityRing: View {
    let progress: Double
    let color: Color
    let symbol: String
    var lineWidth: CGFloat = 24

    var body: some View {
        let lap = Swift.min(progress, 1)
        let second = Swift.min(Swift.max(progress - 1, 0), 1)
        ZStack {
            Circle().stroke(color.opacity(0.22), lineWidth: lineWidth)
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
        }
        .rotationEffect(.degrees(-90))
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
}

/// A round end of the ring's stroke at `fraction` of a lap (0 = the +x axis; the ring is rotated).
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

/// A zone as a line, which reads far better than marks on an arc: a thin neutral track, the zone as a
/// thicker, lighter stretch of the nutrient's colour, a tick at the target and a dot at today's value.
struct ZoneBar: View {
    let zone: NutrientZone
    let color: Color

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let x = { (v: Double) in CGFloat(zone.fraction(v)) * width }
            let low = x(zone.min ?? 0), high = x(zone.max ?? zone.target)
            let dot: CGFloat = 14
            ZStack(alignment: .leading) {
                Capsule().fill(Color.primary.opacity(0.14)).frame(height: 4)
                Capsule().fill(color.opacity(0.45)).frame(width: Swift.max(high - low, 8), height: 10).offset(x: low)
                Capsule().fill(Color.primary).frame(width: 2.5, height: 16).offset(x: x(zone.target) - 1.25)
                Circle()
                    .fill(color)
                    .overlay(Circle().strokeBorder(Color(.secondarySystemGroupedBackground), lineWidth: 2.5))
                    .frame(width: dot, height: dot)
                    .offset(x: Swift.min(Swift.max(x(zone.value) - dot / 2, 0), width - dot))
            }
            .frame(width: width, height: geo.size.height)
        }
        .frame(height: 16)
        .animation(.snappy(duration: 0.6), value: zone)
        .accessibilityHidden(true)
    }
}

/// The hero: concentric kcal / protein / carbs / fat rings like Apple's Activity rings — progress toward
/// each target, a symbol at each ring's start — and under them a tile per nutrient on a neutral ground,
/// colour only in its symbol and bar: the value, its zone as a line, and the status in words with an icon.
struct MacroHero: View {
    let summary: NutritionSummary
    let onSetTargets: () -> Void

    private struct Nutrient {
        let key: String, title: String, unit: String, color: Color, symbol: String
    }

    private static let nutrients = [
        Nutrient(key: "kcal", title: "Calorías", unit: "kcal", color: Theme.energy, symbol: Theme.energySymbol),
        Nutrient(key: "protein", title: "Proteína", unit: "g", color: Theme.protein, symbol: Theme.proteinSymbol),
        Nutrient(key: "carbs", title: "Carbos", unit: "g", color: Theme.carbs, symbol: Theme.carbsSymbol),
        Nutrient(key: "fat", title: "Grasa", unit: "g", color: Theme.fat, symbol: Theme.fatSymbol),
    ]

    private static let lineWidth: CGFloat = 25
    private static let gap: CGFloat = 3
    private static let size: CGFloat = 248

    var body: some View {
        let n = Self.nutrients
        VStack(spacing: 20) {
            ZStack {
                ForEach(Array(n.enumerated()), id: \.offset) { index, nutrient in
                    ring(nutrient).padding(CGFloat(index) * (Self.lineWidth + Self.gap))
                }
            }
            .frame(width: Self.size, height: Self.size)
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilitySummary)

            Grid(horizontalSpacing: 10, verticalSpacing: 10) {
                GridRow { tile(n[0]); tile(n[1]) }
                GridRow { tile(n[2]); tile(n[3]) }
            }

            if summary.targets == nil {
                Button("Fijar objetivos", systemImage: "target", action: onSetTargets)
                    .buttonStyle(.glassProminent)
            }
        }
        .fontDesign(.rounded)
        .sensoryFeedback(.success, trigger: summary.zones?["kcal"]?.status) { old, new in old != nil && new == .inZone }
    }

    private func ring(_ n: Nutrient) -> some View {
        let value = summary.totals[n.key] ?? 0
        let target = summary.zones?[n.key]?.target ?? summary.targets?[n.key]
        let progress = target.flatMap { $0 > 0 ? value / $0 : nil } ?? 0
        return ActivityRing(progress: progress, color: n.color, symbol: n.symbol, lineWidth: Self.lineWidth)
    }

    private func tile(_ n: Nutrient) -> some View {
        let value = summary.totals[n.key] ?? 0
        let zone = summary.zones?[n.key]
        let target = summary.targets?[n.key]
        return VStack(alignment: .leading, spacing: 8) {
            Label {
                Text(n.title).foregroundStyle(.secondary)
            } icon: {
                Image(systemName: n.symbol).foregroundStyle(n.color)
            }
            .font(.subheadline.weight(.medium))
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value, format: .number.precision(.fractionLength(0)))
                    .font(.title2.weight(.bold)).monospacedDigit()
                    .contentTransition(.numericText(value: value))
                Text(zone == nil && target != nil ? "/ \(Int(target!).formatted()) \(n.unit)" : n.unit)
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if let zone {
                ZoneBar(zone: zone, color: n.color)
                StatusLine(zone: zone, unit: n.unit).font(.caption.weight(.semibold))
                Text(zone.kind == .min ? zone.range(n.unit) : "\(zone.range(n.unit)) · obj. \(Int(zone.target).formatted())")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .animation(.snappy, value: value)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(zone.map { "\(n.title): \(Int(value)) \(n.unit). \($0.line(n.unit)). Zona \($0.range(n.unit)), objetivo \(Int($0.target))" } ?? "\(n.title): \(Int(value)) \(n.unit)")
    }

    private var accessibilitySummary: String {
        let kcal = "\(Int(summary.totals.kcal).formatted()) kilocalorías"
        guard let zones = summary.zones else { return kcal }
        return ([kcal] + Self.nutrients.compactMap { n in zones[n.key].map { "\(n.title): \($0.line(n.unit))" } }).joined(separator: ". ")
    }
}

/// «✓ En tu zona», «↓ Faltan 47 g», «↑ Te pasaste 120 kcal»: the words in ink, the symbol tinted.
private struct StatusLine: View {
    let zone: NutrientZone
    let unit: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: zone.statusSymbol).foregroundStyle(zone.statusColor)
            Text(zone.line(unit)).foregroundStyle(zone.status == .below ? .secondary : .primary)
        }
        .contentTransition(.numericText(value: zone.value))
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
