import Charts
import SwiftUI

/// Dieta · Progreso: the last 7 days — kcal against the target, the week's
/// averages, and water day by day.
struct NutritionProgressSection: View {
    let week: [NutritionSummary]
    /// ml by `YYYY-MM-DD`.
    let water: [String: Double]
    let settings: WaterSettings
    /// Today's goal in ml, for the chart's line.
    var waterGoal: Double?

    var body: some View {
        if week.contains(where: { $0.entries > 0 }) || !water.isEmpty {
            Card { AdherenceChart(days: week) }
            let averages = WeekAverages(week: week, water: water)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                StatTile(title: "Media diaria", value: averages.kcal.map { Int($0).formatted() } ?? "—", unit: "kcal",
                         systemImage: "flame.fill", tint: Theme.energy)
                StatTile(title: "Proteína media", value: averages.protein.map { Int($0).formatted() } ?? "—", unit: "g",
                         systemImage: "bolt.heart.fill", tint: Theme.protein)
                StatTile(title: "Días en zona", value: "\(averages.onTarget)", unit: "de \(averages.logged) días",
                         systemImage: "target", tint: Theme.body)
                StatTile(title: "Agua media", value: averages.waterMl.map { settings.format($0) } ?? "—",
                         systemImage: "drop.fill", tint: Theme.water)
            }
            if !water.isEmpty {
                Card { WaterWeekChart(week: week.map(\.date), water: water, settings: settings, goal: waterGoal) }
            }
        } else {
            Card {
                EmptyStateView(systemImage: "chart.bar.xaxis", title: "Tu semana aparece aquí",
                               message: "Registra comidas y agua y verás cómo vas día a día.", tint: Theme.body)
            }
        }
    }
}

/// The week's means over the days that have something logged.
struct WeekAverages: Equatable {
    var kcal: Double?
    var protein: Double?
    var onTarget: Int
    var logged: Int
    var waterMl: Double?

    init(week: [NutritionSummary], water: [String: Double]) {
        let days = week.filter { $0.entries > 0 }
        logged = days.count
        kcal = days.isEmpty ? nil : days.reduce(0) { $0 + $1.totals.kcal } / Double(days.count)
        protein = days.isEmpty ? nil : days.reduce(0) { $0 + $1.totals.protein } / Double(days.count)
        onTarget = days.filter(AdherenceChart.onTarget).count
        let drank = water.values.filter { $0 > 0 }
        waterMl = drank.isEmpty ? nil : drank.reduce(0, +) / Double(drank.count)
    }
}

/// Water per day against today's goal. Touch a bar to read the day.
private struct WaterWeekChart: View {
    let week: [String]
    let water: [String: Double]
    let settings: WaterSettings
    let goal: Double?
    @State private var selected: Date?

    private var selectedKey: String? { selected.map(NutritionDate.string) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                CardTitle(text: "Agua", systemImage: "drop.fill")
                Spacer(minLength: 8)
                if let key = selectedKey, let date = NutritionDate.date(key) {
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(settings.format(water[key] ?? 0)).font(.subheadline.weight(.bold))
                        Text(date.formatted(.dateTime.weekday(.wide).day())).font(.caption2).foregroundStyle(.secondary)
                    }
                    .lineLimit(1)
                }
            }
            Chart {
                ForEach(week, id: \.self) { key in
                    let date = NutritionDate.date(key) ?? .now
                    BarMark(x: .value("Día", date, unit: .day), y: .value("ml", water[key] ?? 0), width: .ratio(0.55))
                        .foregroundStyle(LinearGradient(colors: [Theme.water, Theme.water.opacity(0.4)], startPoint: .top, endPoint: .bottom))
                        .clipShape(Capsule())
                        .opacity(selectedKey == nil || selectedKey == key ? 1 : 0.35)
                }
                if let goal {
                    RuleMark(y: .value("Objetivo", goal))
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
            .frame(height: 120)
            .animation(.snappy, value: selected)
        }
        .fontDesign(.rounded)
    }
}

#Preview("Progreso · 375 pt · XXL") {
    let dates = ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]
    let kcals: [Double] = [1_950, 2_400, 2_180, 0, 2_050, 1_700, 1_510]
    let week: [NutritionSummary] = zip(dates, kcals).map { date, kcal in
        let totals = NutritionMacros(kcal: kcal, protein: kcal / 15, carbs: 200, fat: 70, fiber: 25)
        return NutritionSummary(date: date, totals: totals, targets: previewNutritionSummary.targets, remaining: nil, bySlot: [:], entries: kcal > 0 ? 3 : 0)
    }
    NarrowPreview(dynamicType: .xxLarge) {
        NutritionProgressSection(week: week, water: ["2026-09-25": 1_500, "2026-09-27": 2_250, "2026-10-01": 1_000], settings: .standard, waterGoal: 2_750)
    }
}
