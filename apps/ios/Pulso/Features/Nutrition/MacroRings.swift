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
    /// The whole ring: room past the zone's max (or 125 % of the target) so the zone and any overflow both show.
    var ringFull: Double { Swift.max(target * 1.25, (max ?? target) * 1.1, 1) }

    /// Where `value` sits on the ring, 0…1.
    func fraction(_ value: Double) -> Double { Swift.min(Swift.max(value / ringFull, 0), 1) }

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

    /// The nutrient's own colour below the zone, success inside it, red past it.
    func tone(_ color: Color) -> Color {
        switch status {
        case .below: color
        case .inZone: Theme.body
        case .above: .red
        }
    }
}

/// A ring that knows the target zone: a soft band on the track from the zone's min to its max,
/// a tick at the target, and the progress arc — the nutrient's colour below the zone, glowing
/// green inside it, and red past the max.
struct ZoneRing: View {
    let zone: NutrientZone
    let color: Color
    var lineWidth: CGFloat = 12

    var body: some View {
        let progress = zone.fraction(zone.value)
        let maxAt = zone.fraction(zone.max ?? zone.target)
        let over = zone.status == .above
        let tone = zone.tone(color)
        ZStack {
            Circle().stroke(color.opacity(0.14), lineWidth: lineWidth)
            Circle()
                .trim(from: zone.fraction(zone.min ?? 0), to: maxAt)
                .stroke(Theme.body.opacity(0.38), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: over ? maxAt : progress)
                .stroke(
                    AngularGradient(colors: [tone.mix(with: .white, by: 0.15), tone], center: .center),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .shadow(color: zone.status == .inZone ? Theme.body.opacity(0.7) : .clear, radius: lineWidth / 2)
            if over {
                Circle()
                    .trim(from: maxAt, to: progress)
                    .stroke(Color.red, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
            }
            TargetTick(fraction: zone.fraction(zone.target), lineWidth: lineWidth)
                .stroke(.primary.opacity(0.8), style: StrokeStyle(lineWidth: Swift.max(2, lineWidth / 6), lineCap: .round))
        }
        .rotationEffect(.degrees(-90))
        .animation(.snappy(duration: 0.7), value: zone)
    }
}

/// A short mark across the ring at `fraction` of the way round (0 = the +x axis; the ring is rotated).
private struct TargetTick: Shape {
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
        path.move(to: point(radius - lineWidth / 2 - 2))
        path.addLine(to: point(radius + lineWidth / 2 + 2))
        return path
    }
}

/// The hero: concentric kcal / protein / carbs / fat rings, each with its target zone, the day's
/// kcal and where it stands in the middle, and a legend that says how far each macro is from its zone.
struct MacroHero: View {
    let summary: NutritionSummary
    let onSetTargets: () -> Void

    private static let macros: [(key: String, title: String, color: Color)] = [
        ("protein", "Proteína", Theme.protein), ("carbs", "Carbos", Theme.carbs), ("fat", "Grasa", Theme.fat),
    ]

    private func ratio(_ value: Double, _ target: Double?) -> Double {
        guard let target, target > 0 else { return 0 }
        return value / target
    }

    var body: some View {
        let totals = summary.totals
        let zones = summary.zones
        VStack(spacing: 20) {
            ZStack {
                ring("kcal", totals.kcal, Theme.energy, lineWidth: 20)
                ring("protein", totals.protein, Theme.protein, lineWidth: 12).padding(24)
                ring("carbs", totals.carbs, Theme.carbs, lineWidth: 12).padding(42)
                ring("fat", totals.fat, Theme.fat, lineWidth: 12).padding(60)
                center(totals: totals, zone: zones?["kcal"])
            }
            .frame(width: 236, height: 236)
            .padding(10) // the outer stroke sits half outside its circle
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilitySummary)

            if summary.targets == nil {
                Button("Fijar objetivos", systemImage: "target", action: onSetTargets)
                    .buttonStyle(.glassProminent)
            } else {
                if let kcal = zones?["kcal"] {
                    Text("Tu zona: \(kcal.range("kcal")) · la marca es tu objetivo de \(Int(kcal.target).formatted())")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                HStack(spacing: 10) {
                    ForEach(Self.macros, id: \.key) { m in
                        legend(m.title, totals[m.key] ?? 0, zones?[m.key], summary.targets?[m.key], m.color)
                    }
                }
            }
        }
        .fontDesign(.rounded)
        .sensoryFeedback(.success, trigger: zones?["kcal"]?.status) { old, new in old != nil && new == .inZone }
    }

    @ViewBuilder
    private func ring(_ key: String, _ value: Double, _ color: Color, lineWidth: CGFloat) -> some View {
        if let zone = summary.zones?[key] {
            ZoneRing(zone: zone, color: color, lineWidth: lineWidth)
        } else {
            ProgressRing(progress: ratio(value, summary.targets?[key]), color: color, lineWidth: lineWidth)
        }
    }

    private func center(totals: NutritionMacros, zone: NutrientZone?) -> some View {
        VStack(spacing: 0) {
            Text(totals.kcal, format: .number.precision(.fractionLength(0)))
                .font(.system(size: 30, weight: .bold))
                .monospacedDigit()
                .contentTransition(.numericText(value: totals.kcal))
            if let zone {
                Text(zone.line("kcal"))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(zone.status == .below ? Color.secondary : zone.tone(Theme.energy))
                    .contentTransition(.numericText(value: zone.value))
            } else if let target = summary.targets?.kcal {
                let left = target - totals.kcal
                Text(left >= 0 ? "quedan \(Int(left))" : "+\(Int(-left)) kcal")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(left >= 0 ? Color.secondary : Theme.energy)
                    .contentTransition(.numericText(value: left))
            } else {
                Text("kcal").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
        }
        // The innermost ring leaves ~100 pt; "Te pasaste 1.250 kcal" at large text must shrink to stay inside it.
        .lineLimit(1)
        .minimumScaleFactor(0.55)
        .frame(maxWidth: 92)
        .animation(.snappy, value: totals.kcal)
    }

    private func legend(_ title: String, _ value: Double, _ zone: NutrientZone?, _ target: Double?, _ color: Color) -> some View {
        VStack(spacing: 4) {
            HStack(spacing: 5) {
                Circle().fill(color).frame(width: 7, height: 7)
                Text(title).font(.caption).foregroundStyle(.secondary)
            }
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
                Text(zone.line("g"))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(zone.status == .below ? Color.secondary : zone.tone(color))
                    .contentTransition(.numericText(value: zone.value))
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .padding(.horizontal, 4)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(color.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            if zone?.status == .inZone {
                RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.body.opacity(0.5), lineWidth: 1)
            }
        }
        .animation(.snappy, value: value)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(zone.map { "\(title): \(Int(value)) g. \($0.line("g")). Zona \($0.range("g"))" } ?? "\(title): \(Int(value)) g")
    }

    private var accessibilitySummary: String {
        let kcal = "\(Int(summary.totals.kcal).formatted()) kilocalorías"
        guard let zones = summary.zones else { return kcal }
        let parts = [("kcal", "Calorías", "kcal")] + Self.macros.map { ($0.key, $0.title, "g") }
        return ([kcal] + parts.compactMap { key, title, unit in zones[key].map { "\(title): \($0.line(unit))" } }).joined(separator: ". ")
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

/// "P 30 · C 45 · G 12" in the macro colors.
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

#Preview("Anillos · te pasaste · claro") {
    NarrowPreview { Card { MacroHero(summary: previewZones(kcal: 2_520, protein: 140, carbs: 290, fat: 92)) {} } }
        .preferredColorScheme(.light)
}

#Preview("Anillos · proteína al mínimo · XXL") {
    NarrowPreview(dynamicType: .xxLarge) { Card { MacroHero(summary: previewZones(kcal: 1_900, protein: 162, carbs: 180, fat: 60)) {} } }
}
