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

/// The hero: concentric kcal / protein / carbs / fat rings with the day's kcal in the middle,
/// and a legend of grams eaten against target.
struct MacroHero: View {
    let summary: NutritionSummary
    let onSetTargets: () -> Void

    private func ratio(_ value: Double, _ target: Double?) -> Double {
        guard let target, target > 0 else { return 0 }
        return value / target
    }

    var body: some View {
        let totals = summary.totals
        let targets = summary.targets
        VStack(spacing: 20) {
            ZStack {
                ProgressRing(progress: ratio(totals.kcal, targets?.kcal), color: Theme.energy, lineWidth: 20)
                ProgressRing(progress: ratio(totals.protein, targets?.protein), color: Theme.protein, lineWidth: 12)
                    .padding(24)
                ProgressRing(progress: ratio(totals.carbs, targets?.carbs), color: Theme.carbs, lineWidth: 12)
                    .padding(42)
                ProgressRing(progress: ratio(totals.fat, targets?.fat), color: Theme.fat, lineWidth: 12)
                    .padding(60)
                center(totals: totals, targets: targets)
            }
            .frame(width: 236, height: 236)
            .padding(10) // the outer stroke sits half outside its circle
            .frame(maxWidth: .infinity)

            if targets == nil {
                Button("Fijar objetivos", systemImage: "target", action: onSetTargets)
                    .buttonStyle(.glassProminent)
            } else {
                HStack(spacing: 10) {
                    legend("Proteína", totals.protein, targets?.protein, Theme.protein)
                    legend("Carbos", totals.carbs, targets?.carbs, Theme.carbs)
                    legend("Grasa", totals.fat, targets?.fat, Theme.fat)
                }
            }
        }
        .fontDesign(.rounded)
    }

    private func center(totals: NutritionMacros, targets: NutritionTargets?) -> some View {
        VStack(spacing: 0) {
            Text(totals.kcal, format: .number.precision(.fractionLength(0)))
                .font(.system(size: 30, weight: .bold))
                .monospacedDigit()
                .contentTransition(.numericText(value: totals.kcal))
            if let target = targets?.kcal {
                let left = target - totals.kcal
                Text(left >= 0 ? "quedan \(Int(left))" : "+\(Int(-left)) kcal")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(left >= 0 ? Color.secondary : Theme.energy)
                    .contentTransition(.numericText(value: left))
            } else {
                Text("kcal").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
        }
        .animation(.snappy, value: totals.kcal)
    }

    private func legend(_ title: String, _ value: Double, _ target: Double?, _ color: Color) -> some View {
        VStack(spacing: 4) {
            HStack(spacing: 5) {
                Circle().fill(color).frame(width: 7, height: 7)
                Text(title).font(.caption).foregroundStyle(.secondary)
            }
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                Text(value, format: .number.precision(.fractionLength(0)))
                    .font(.headline).monospacedDigit()
                    .contentTransition(.numericText(value: value))
                if let target {
                    Text("/\(Int(target)) g").font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(color.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .animation(.snappy, value: value)
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
    }

    private func part(_ letter: String, _ value: Double, _ color: Color) -> some View {
        HStack(spacing: 2) {
            Text(letter).fontWeight(.bold).foregroundStyle(color)
            Text(value, format: .number.precision(.fractionLength(0))).foregroundStyle(.secondary)
        }
    }
}
