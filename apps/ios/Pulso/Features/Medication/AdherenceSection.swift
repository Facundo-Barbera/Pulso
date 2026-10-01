import Charts
import SwiftUI

/// Adherence: 7/30-day rates, a 30-day calendar heatmap and per-med streaks.
struct AdherenceSection: View {
    let report: AdherenceReport

    var body: some View {
        Card {
            CardTitle(text: "Adherencia", systemImage: "chart.bar.xaxis")
            HStack(spacing: 0) {
                RateStat(label: "7 días", window: report.overall.last7)
                RateStat(label: "30 días", window: report.overall.last30)
                StreakStat(current: report.overall.currentStreak, best: report.overall.bestStreak)
            }
            AdherenceHeatmap(days: report.days)
                .padding(.top, 4)
        }
        Card {
            CardTitle(text: "Por medicamento", systemImage: "flame")
            PerMedicationChart(medications: report.medications)
        }
    }
}

private struct RateStat: View {
    let label: String
    let window: AdherenceWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(window.rate.map { $0.formatted(.percent.precision(.fractionLength(0))) } ?? "—")
                .font(.title2.weight(.bold))
                .fontDesign(.rounded)
                .contentTransition(.numericText())
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct StreakStat: View {
    let current: Int
    let best: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label("\(current)", systemImage: "flame.fill")
                .font(.title2.weight(.bold))
                .fontDesign(.rounded)
                .foregroundStyle(current > 0 ? Theme.energy : .secondary)
                .contentTransition(.numericText())
                .symbolEffect(.bounce, value: current)
            Text("racha · mejor \(best)").font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Last 30 days as a weeks × weekdays grid, colored by share of doses taken.
private struct AdherenceHeatmap: View {
    let days: [AdherenceDay]
    @State private var selected: AdherenceDay?

    private struct Cell: Identifiable {
        var day: AdherenceDay
        var week: Int
        var weekday: String
        var id: String { day.id }
    }

    private var cells: [Cell] {
        guard let first = days.first.flatMap({ LocalClock.day($0.date) }) else { return [] }
        let lead = LocalClock.isoWeekday(first) - 1
        return days.enumerated().compactMap { index, day in
            guard let date = LocalClock.day(day.date) else { return nil }
            return Cell(day: day, week: (index + lead) / 7, weekday: WeekdayNames.letters[LocalClock.isoWeekday(date) - 1])
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Chart(cells) { cell in
                RectangleMark(
                    x: .value("Semana", cell.week),
                    y: .value("Día", cell.weekday),
                    width: .ratio(0.86),
                    height: .ratio(0.86)
                )
                .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                .foregroundStyle(color(cell.day))
                .opacity(selected == nil || selected?.id == cell.id ? 1 : 0.45)
            }
            .chartYScale(domain: WeekdayNames.letters)
            .chartXAxis(.hidden)
            .chartYAxis {
                AxisMarks(position: .leading) { _ in AxisValueLabel().font(.caption2) }
            }
            .chartOverlay { proxy in
                GeometryReader { _ in
                    Rectangle().fill(.clear).contentShape(.rect)
                        .gesture(SpatialTapGesture().onEnded { value in
                            guard let week: Double = proxy.value(atX: value.location.x),
                                  let weekday: String = proxy.value(atY: value.location.y) else { return }
                            let hit = cells.first { $0.week == Int(week.rounded()) && $0.weekday == weekday }?.day
                            selected = hit?.id == selected?.id ? nil : hit
                        })
                }
            }
            .frame(height: 170)
            .sensoryFeedback(.selection, trigger: selected)

            HStack {
                if let selected, let date = LocalClock.day(selected.date) {
                    Text(date.formatted(.dateTime.weekday(.wide).day().month()))
                        .font(.caption.weight(.semibold))
                    Text(selected.due == 0 ? "sin tomas" : "\(selected.taken) de \(selected.due) tomas")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Últimos 30 días · toca un día").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                legend
            }
            .animation(.snappy, value: selected)
        }
    }

    private var legend: some View {
        HStack(spacing: 3) {
            Text("menos").font(.caption2).foregroundStyle(.tertiary)
            ForEach([0.0, 0.5, 1.0], id: \.self) { rate in
                RoundedRectangle(cornerRadius: 3).fill(Theme.body.opacity(0.2 + rate * 0.8)).frame(width: 10, height: 10)
            }
            Text("más").font(.caption2).foregroundStyle(.tertiary)
        }
    }

    private func color(_ day: AdherenceDay) -> Color {
        guard let rate = day.rate else { return Color.secondary.opacity(0.12) }
        if rate == 0 { return Theme.energy.opacity(0.55) }
        return Theme.body.opacity(0.2 + rate * 0.8)
    }
}

/// Each med's 30-day rate as a soft bar, with its current streak alongside.
private struct PerMedicationChart: View {
    let medications: [MedicationAdherence]

    var body: some View {
        Chart(medications) { med in
            BarMark(
                x: .value("Adherencia", med.last30.rate ?? 0),
                y: .value("Medicamento", med.name),
                height: .fixed(16)
            )
            .clipShape(Capsule())
            .foregroundStyle(LinearGradient(colors: [Theme.body.opacity(0.5), Theme.body], startPoint: .leading, endPoint: .trailing))
            .annotation(position: .trailing, spacing: 6) {
                HStack(spacing: 6) {
                    Text((med.last30.rate ?? 0).formatted(.percent.precision(.fractionLength(0))))
                        .font(.caption.weight(.semibold))
                        .fontDesign(.rounded)
                    if med.currentStreak > 0 {
                        Label("\(med.currentStreak)", systemImage: "flame.fill")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Theme.energy)
                    }
                }
            }
        }
        .chartXScale(domain: 0...1.35)
        .chartXAxis(.hidden)
        .chartYAxis {
            AxisMarks(position: .leading) { _ in AxisValueLabel().font(.subheadline) }
        }
        .frame(height: CGFloat(max(medications.count, 1)) * 40)
    }
}
