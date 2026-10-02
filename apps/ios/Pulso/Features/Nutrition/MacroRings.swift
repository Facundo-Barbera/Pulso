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
    /// The top of the zone: its max, or for a minimum (where more is fine) 125 % of the target.
    var top: Double { kind == .min || max == nil ? Swift.max(target * 1.25, max ?? 0) : max! }

    /// The bar's full width: room past the top of the zone, and past today's value when it is further.
    var barFull: Double { Swift.max(top * 1.15, value * 1.04, 1) }

    /// Where `value` sits on the bar, 0…1.
    func fraction(_ value: Double) -> Double { Swift.min(Swift.max(value / barFull, 0), 1) }

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

/// One ring in the manner of Apple's Activity rings: a tinted track, the arc from 12 o'clock with the
/// symbol centred on its start, and past a full lap a darker second lap whose end casts a shadow on the first. The frame holds the whole stroke; `content` sits in the hole.
struct ActivityRing<Content: View>: View {
    let progress: Double
    let color: Color
    let symbol: String
    var lineWidth: CGFloat = 24
    @ViewBuilder var content: Content

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
                    .shadow(color: .black.opacity(0.5), radius: lineWidth / 5)
                Circle()
                    .trim(from: 0, to: second)
                    .stroke(color.mix(with: .black, by: 0.22), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
            }
        }
        .rotationEffect(.degrees(-90))
        .overlay(alignment: .top) {
            Image(systemName: symbol)
                .font(.system(size: lineWidth * 0.55, weight: .bold))
                .foregroundStyle(lap > 0 ? Color.black.opacity(0.78) : color)
                .frame(width: lineWidth, height: lineWidth)
                .offset(y: -lineWidth / 2)
        }
        .overlay { content.padding(lineWidth) }
        .padding(lineWidth / 2)
        .animation(.snappy(duration: 0.7), value: progress)
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

/// A progress bar that knows the zone: filled from 0 to what you've had (where you are), the zone as a
/// lighter, taller band behind it with its numbers underneath, the target as a tick labelled «meta», and
/// anything past the zone striped in the caution colour after a small gap at the max.
struct ZoneBar: View {
    let zone: NutrientZone
    let color: Color
    let unit: String

    private static let bar: CGFloat = 10

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let x = { (v: Double) in CGFloat(zone.fraction(v)) * width }
            let low = x(zone.min ?? 0)
            let high = zone.kind == .min ? width : x(zone.max ?? zone.top)
            let overAt = zone.kind == .min ? nil : zone.max.map(x)
            let value = x(zone.value)
            let target = x(zone.target)
            let barY: CGFloat = 13
            ZStack(alignment: .topLeading) {
                // The zone: taller than the bar, so its edges show above and below the fill.
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(color.opacity(0.35))
                    .frame(width: Swift.max(high - low, 6), height: Self.bar + 8)
                    .offset(x: low, y: barY - 4)
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.primary.opacity(0.12))
                    Capsule().fill(color).frame(width: Swift.max(Swift.min(value, overAt ?? value), value > 0 ? Self.bar : 0))
                    if let overAt, value > overAt {
                        Stripes(color: Theme.caution).frame(width: value - overAt).offset(x: overAt)
                        Rectangle().frame(width: 2.5).offset(x: overAt - 1.25).blendMode(.destinationOut)
                    }
                }
                .frame(width: width, height: Self.bar)
                .clipShape(Capsule())
                .compositingGroup()
                .offset(y: barY)

                Capsule().fill(Color.primary).frame(width: 2.5, height: Self.bar + 8).offset(x: target - 1.25, y: barY - 4)
                label("meta", at: target, y: 0, width: width).font(.system(size: 9, weight: .semibold)).foregroundStyle(.primary)
                label(zoneNumbers, at: (low + high) / 2, y: barY + Self.bar + 4, width: width).font(.system(size: 10)).foregroundStyle(.secondary)
            }
        }
        .frame(height: 40)
        .animation(.snappy(duration: 0.6), value: zone)
        .accessibilityHidden(true)
    }

    /// «144–198», «≥ 160»: the zone without its unit, under the zone.
    private var zoneNumbers: String {
        let n = { (v: Double?) in Int((v ?? 0).rounded()).formatted() }
        if zone.kind == .min || zone.max == nil { return "≥ \(n(zone.min))" }
        if zone.min == nil { return "≤ \(n(zone.max))" }
        return "\(n(zone.min))–\(n(zone.max))"
    }

    /// A small label centred on `at`, kept inside the bar's width.
    private func label(_ text: String, at: CGFloat, y: CGFloat, width: CGFloat) -> some View {
        let half: CGFloat = 32
        return Text(text)
            .lineLimit(1)
            .monospacedDigit()
            .frame(width: half * 2)
            .offset(x: Swift.min(Swift.max(at - half, -half / 2), width - half * 1.5), y: y)
    }
}

/// Diagonal caution stripes: "past your zone", told by pattern as well as colour.
private struct Stripes: View {
    let color: Color

    var body: some View {
        Canvas { context, size in
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(color.opacity(0.3)))
            var x: CGFloat = -size.height
            while x < size.width {
                var line = Path()
                line.move(to: CGPoint(x: x, y: size.height))
                line.addLine(to: CGPoint(x: x + size.height, y: 0))
                context.stroke(line, with: .color(color), lineWidth: 2)
                x += 5
            }
        }
    }
}

/// The hero: one big Activity-style kcal ring — a lap is the top of your zone, so a day in the zone
/// reads "almost full" and a day past it shows a short striped overflow — with the day's kcal in the
/// middle; then a tile per nutrient on a neutral ground with a filled bar against its zone, the numbers
/// in words, and one line of legend for the bars.
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

    var body: some View {
        let n = Self.nutrients
        let kcalZone = summary.zones?["kcal"]
        VStack(spacing: 20) {
            ActivityRing(progress: kcalProgress, color: Theme.energy, symbol: Theme.energySymbol, lineWidth: 26) {
                VStack(spacing: 2) {
                    Text(summary.totals.kcal, format: .number.precision(.fractionLength(0)))
                        .font(.system(size: 44, weight: .bold))
                        .monospacedDigit()
                        .contentTransition(.numericText(value: summary.totals.kcal))
                    Text("kcal").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                    if let kcalZone {
                        StatusLine(zone: kcalZone, unit: "kcal").font(.caption.weight(.semibold)).padding(.top, 4)
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            }
            .frame(width: 224, height: 224)
            .frame(maxWidth: .infinity)
            .animation(.snappy, value: summary.totals.kcal)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilitySummary)

            Grid(horizontalSpacing: 10, verticalSpacing: 10) {
                GridRow { tile(n[0]); tile(n[1]) }
                GridRow { tile(n[2]); tile(n[3]) }
            }

            if summary.zones != nil {
                BarLegend().frame(maxWidth: .infinity)
            } else if summary.targets == nil {
                Button("Fijar objetivos", systemImage: "target", action: onSetTargets)
                    .buttonStyle(.glassProminent)
            }
        }
        .fontDesign(.rounded)
        .sensoryFeedback(.success, trigger: kcalZone?.status) { old, new in old != nil && new == .inZone }
    }

    /// A lap is the top of the zone (or the target without one).
    private var kcalProgress: Double {
        let top = summary.zones?["kcal"]?.top ?? summary.targets?.kcal ?? 0
        return top > 0 ? summary.totals.kcal / top : 0
    }

    private func tile(_ n: Nutrient) -> some View {
        let value = summary.totals[n.key] ?? 0
        let zone = summary.zones?[n.key]
        let target = zone?.target ?? summary.targets?[n.key]
        return VStack(alignment: .leading, spacing: 6) {
            Label {
                Text(n.title).foregroundStyle(.secondary)
            } icon: {
                Image(systemName: n.symbol).foregroundStyle(n.color)
            }
            .font(.subheadline.weight(.medium))
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value, format: .number.precision(.fractionLength(0)))
                    .font(.title2.weight(.bold)).monospacedDigit()
                    .contentTransition(.numericText(value: value))
                Text(target.map { "de \(Int($0).formatted()) \(n.unit)" } ?? n.unit)
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if let zone {
                ZoneBar(zone: zone, color: n.color, unit: n.unit)
                StatusLine(zone: zone, unit: n.unit).font(.caption.weight(.semibold))
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .animation(.snappy, value: value)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(zone.map { "\(n.title): \(Int(value)) de \(Int($0.target)) \(n.unit). \($0.line(n.unit)). Zona \($0.range(n.unit))" } ?? "\(n.title): \(Int(value)) \(n.unit)")
    }

    private var accessibilitySummary: String {
        let kcal = "\(Int(summary.totals.kcal).formatted()) kilocalorías"
        guard let zones = summary.zones else { return kcal }
        return ([kcal] + Self.nutrients.compactMap { n in zones[n.key].map { "\(n.title): \($0.line(n.unit))" } }).joined(separator: ". ")
    }
}

/// «▬ lo que llevas · ░ tu zona · ┃ tu meta · ▨ de más», drawn with the bar's own marks.
private struct BarLegend: View {
    var body: some View {
        HStack(spacing: 12) {
            item("lo que llevas") { Capsule().fill(Color.primary.opacity(0.7)).frame(width: 16, height: 8) }
            item("tu zona") { RoundedRectangle(cornerRadius: 3).fill(Color.primary.opacity(0.25)).frame(width: 16, height: 12) }
            item("tu meta") { Capsule().fill(Color.primary).frame(width: 2.5, height: 14) }
            item("de más") { Stripes(color: Theme.caution).frame(width: 16, height: 8).clipShape(Capsule()) }
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .accessibilityElement(children: .combine)
    }

    private func item(_ text: String, @ViewBuilder mark: () -> some View) -> some View {
        HStack(spacing: 4) { mark(); Text(text) }
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
