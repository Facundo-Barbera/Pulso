import SwiftUI

/// One progress ring. Past 100 % it keeps going with a darker second lap.
struct ProgressRing: View {
    let progress: Double
    let color: Color
    var lineWidth: CGFloat = 10

    var body: some View {
        ZStack {
            Circle().stroke(color.opacity(0.18), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: min(progress, 1))
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            if progress > 1 {
                Circle()
                    .trim(from: 0, to: min(progress - 1, 1))
                    .stroke(color.mix(with: .black, by: 0.35), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
        }
        .animation(.spring(duration: 0.6), value: progress)
    }
}

/// Today's kcal ring and the three macro rings.
struct MacroRingsCard: View {
    let summary: NutritionSummary
    let onSetTargets: () -> Void

    private func ratio(_ value: Double, _ target: Double?) -> Double {
        guard let target, target > 0 else { return 0 }
        return value / target
    }

    var body: some View {
        let totals = summary.totals
        let targets = summary.targets
        HStack(spacing: 18) {
            ZStack {
                ProgressRing(progress: ratio(totals.kcal, targets?.kcal), color: Theme.energy, lineWidth: 14)
                VStack(spacing: 0) {
                    Text(totals.kcal, format: .number.precision(.fractionLength(0)))
                        .font(.title2.weight(.bold)).monospacedDigit()
                        .contentTransition(.numericText())
                    if let targets {
                        Text("de \(Int(targets.kcal)) kcal").font(.caption2).foregroundStyle(.secondary)
                    } else {
                        Text("kcal").font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            .frame(width: 118, height: 118)

            VStack(alignment: .leading, spacing: 10) {
                macroRow("Proteína", totals.protein, targets?.protein, Theme.protein)
                macroRow("Carbos", totals.carbs, targets?.carbs, Theme.carbs)
                macroRow("Grasa", totals.fat, targets?.fat, Theme.fat)
                if targets == nil {
                    Button("Fijar objetivos", systemImage: "target", action: onSetTargets)
                        .font(.caption.weight(.semibold))
                        .buttonStyle(.borderless)
                } else if let left = summary.remaining?.kcal {
                    Text(left >= 0 ? "Quedan \(Int(left)) kcal" : "\(Int(-left)) kcal por encima")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(left >= 0 ? Color.secondary : Theme.energy)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func macroRow(_ title: String, _ value: Double, _ target: Double?, _ color: Color) -> some View {
        HStack(spacing: 10) {
            ProgressRing(progress: ratio(value, target), color: color, lineWidth: 5)
                .frame(width: 26, height: 26)
            VStack(alignment: .leading, spacing: 0) {
                Text(title).font(.caption).foregroundStyle(.secondary)
                Group {
                    if let target {
                        Text("\(Int(value.rounded())) / \(Int(target)) g")
                    } else {
                        Text("\(Int(value.rounded())) g")
                    }
                }
                .font(.subheadline.weight(.semibold)).monospacedDigit()
            }
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
    }

    private func part(_ letter: String, _ value: Double, _ color: Color) -> some View {
        HStack(spacing: 2) {
            Text(letter).fontWeight(.bold).foregroundStyle(color)
            Text(value, format: .number.precision(.fractionLength(0))).foregroundStyle(.secondary)
        }
    }
}
