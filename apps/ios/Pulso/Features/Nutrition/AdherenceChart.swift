import Charts
import SwiftUI

/// Last 7 days of kcal against the target. A day "cumple" within ±10 % of it.
/// Touch a bar to read that day.
struct AdherenceChart: View {
    let days: [NutritionSummary]
    @State private var selected: Date?

    static func onTarget(_ day: NutritionSummary) -> Bool {
        guard let target = day.targets?.kcal, target > 0, day.entries > 0 else { return false }
        return abs(day.totals.kcal - target) / target <= 0.10
    }

    private var target: Double? { days.last?.targets?.kcal }

    private var selectedDay: NutritionSummary? {
        guard let selected else { return nil }
        return days.first { NutritionDate.date($0.date).map { Calendar.current.isDate($0, inSameDayAs: selected) } ?? false }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                CardTitle(text: "Últimos 7 días", systemImage: "chart.bar.fill")
                Spacer(minLength: 8)
                readout
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            Chart {
                ForEach(days) { day in
                    let date = NutritionDate.date(day.date) ?? .now
                    let color = Self.onTarget(day) ? Theme.body : Theme.energy
                    BarMark(x: .value("Día", date, unit: .day), y: .value("kcal", day.totals.kcal), width: .ratio(0.55))
                        .foregroundStyle(LinearGradient(colors: [color, color.opacity(0.45)], startPoint: .top, endPoint: .bottom))
                        .clipShape(Capsule())
                        .opacity(selectedDay == nil || selectedDay?.date == day.date ? 1 : 0.35)
                }
                if let target {
                    RuleMark(y: .value("Objetivo", target))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                        .foregroundStyle(.secondary.opacity(0.6))
                }
            }
            .chartXSelection(value: $selected)
            .chartYAxis(.hidden)
            .chartXAxis {
                AxisMarks(values: .stride(by: .day)) { _ in
                    AxisValueLabel(format: .dateTime.weekday(.narrow))
                }
            }
            .frame(height: 140)
            .animation(.snappy, value: selected)
        }
        .fontDesign(.rounded)
    }

    @ViewBuilder
    private var readout: some View {
        if let day = selectedDay {
            VStack(alignment: .trailing, spacing: 0) {
                Text("\(Int(day.totals.kcal)) kcal").font(.subheadline.weight(.bold)).monospacedDigit()
                Text((NutritionDate.date(day.date) ?? .now).formatted(.dateTime.weekday(.wide).day()))
                    .font(.caption2).foregroundStyle(.secondary)
            }
        } else if target != nil {
            Text("\(days.filter(Self.onTarget).count) de \(days.count) en objetivo")
                .font(.caption.weight(.semibold)).foregroundStyle(Theme.body)
        }
    }
}
