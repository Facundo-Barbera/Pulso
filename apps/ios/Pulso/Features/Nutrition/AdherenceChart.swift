import Charts
import SwiftUI

/// Last 7 days of kcal against the target. A day "cumple" within ±10 % of it.
struct AdherenceChart: View {
    let days: [NutritionSummary]

    static func onTarget(_ day: NutritionSummary) -> Bool {
        guard let target = day.targets?.kcal, target > 0, day.entries > 0 else { return false }
        return abs(day.totals.kcal - target) / target <= 0.10
    }

    private var target: Double? { days.last?.targets?.kcal }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                CardTitle(text: "Últimos 7 días", systemImage: "chart.bar")
                Spacer()
                if target != nil {
                    Text("\(days.filter(Self.onTarget).count)/\(days.count) en objetivo")
                        .font(.caption.weight(.semibold)).foregroundStyle(Theme.body)
                }
            }
            Chart {
                ForEach(days) { day in
                    BarMark(
                        x: .value("Día", NutritionDate.date(day.date) ?? .now, unit: .day),
                        y: .value("kcal", day.totals.kcal)
                    )
                    .foregroundStyle(Self.onTarget(day) ? Theme.body : Theme.energy.opacity(0.75))
                    .cornerRadius(5)
                }
                if let target {
                    RuleMark(y: .value("Objetivo", target))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                        .foregroundStyle(.secondary)
                        .annotation(position: .top, alignment: .leading) {
                            Text("\(Int(target)) kcal").font(.caption2).foregroundStyle(.secondary)
                        }
                }
            }
            .chartXAxis {
                AxisMarks(values: .stride(by: .day)) { _ in
                    AxisValueLabel(format: .dateTime.weekday(.narrow))
                }
            }
            .frame(height: 150)
        }
    }
}
