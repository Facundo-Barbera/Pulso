import Charts
import SwiftUI

/// Constancia: 7/30-day rates and the streak in one card; the 30-day heatmap
/// once there is a week of scheduled doses to read, and each med's rate when
/// there is more than one.
struct AdherenceSection: View {
    let report: AdherenceReport

    /// Days with scheduled doses the heatmap needs before it says anything.
    static let heatmapMinDays = 7

    var body: some View {
        Card {
            CardTitle(text: "Constancia", systemImage: "chart.line.uptrend.xyaxis")
            if report.overall.last30.due == 0 {
                Text("Cuando pase la hora de alguna toma con horario verás aquí cuántas cumples y tu racha.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                HStack(spacing: 0) {
                    RateStat(label: "7 días", window: report.overall.last7)
                    RateStat(label: "30 días", window: report.overall.last30)
                    StreakStat(current: report.overall.currentStreak, best: report.overall.bestStreak)
                }
                if report.days.count(where: { $0.due > 0 }) >= Self.heatmapMinDays {
                    AdherenceHeatmap(days: report.days)
                        .padding(.top, 4)
                } else {
                    Text("\(report.overall.last30.taken) de \(report.overall.last30.due) tomas cumplidas. El mapa del mes aparece tras \(Self.heatmapMinDays) días con tomas.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if report.medications.count > 1 {
                    Divider()
                    PerMedicationBars(medications: report.medications)
                }
            }
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
        .lineLimit(1)
        .minimumScaleFactor(0.7)
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
        .lineLimit(1)
        .minimumScaleFactor(0.7)
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
                // A missed day is marked, not only tinted.
                .annotation(position: .overlay) {
                    if cell.day.rate == 0 {
                        Image(systemName: "xmark").font(.system(size: 8, weight: .heavy)).foregroundStyle(Theme.caution)
                    }
                }
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

            // "miércoles, 30 de septiembre · 2 de 3 tomas" plus the legend needs ~320 pt: legend goes below.
            ViewThatFits(in: .horizontal) {
                HStack {
                    readout
                    Spacer(minLength: 8)
                    legend
                }
                VStack(alignment: .leading, spacing: 6) {
                    readout
                    legend
                }
            }
            .lineLimit(1)
            .animation(.snappy, value: selected)
        }
    }

    @ViewBuilder private var readout: some View {
        if let selected, let date = LocalClock.day(selected.date) {
            HStack(spacing: 6) {
                Text(date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)))
                    .font(.caption.weight(.semibold))
                Text(selected.due == 0 ? "sin tomas" : "\(selected.taken) de \(selected.due) tomas")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } else {
            Text("Últimos 30 días · toca un día").font(.caption).foregroundStyle(.secondary)
        }
    }

    private var legend: some View {
        HStack(spacing: 3) {
            Text("menos").font(.caption2).foregroundStyle(.tertiary)
            ForEach([0.0, 0.5, 1.0], id: \.self) { rate in
                RoundedRectangle(cornerRadius: 3).fill(Theme.good.opacity(0.2 + rate * 0.8)).frame(width: 10, height: 10)
            }
            Text("más").font(.caption2).foregroundStyle(.tertiary)
            Image(systemName: "xmark").font(.system(size: 8, weight: .heavy)).foregroundStyle(Theme.caution).padding(.leading, 4)
            Text("ninguna").font(.caption2).foregroundStyle(.tertiary)
        }
    }

    private func color(_ day: AdherenceDay) -> Color {
        guard let rate = day.rate else { return Color.secondary.opacity(0.12) }
        if rate == 0 { return Theme.caution.opacity(0.3) }
        return Theme.good.opacity(0.2 + rate * 0.8)
    }
}

/// Each med's 30-day rate as a soft bar, with its current streak alongside. Name above
/// the bar rather than as a chart axis label: a long name ("Vitamina D3 + K2 2000 UI")
/// as an axis label ate the plot and squeezed the bars to nothing on a 375 pt phone.
private struct PerMedicationBars: View {
    let medications: [MedicationAdherence]

    var body: some View {
        VStack(spacing: 14) {
            ForEach(medications) { med in
                let rate = med.last30.rate ?? 0
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(med.name).font(.subheadline.weight(.medium)).lineLimit(1)
                        Spacer(minLength: 8)
                        if med.currentStreak > 0 {
                            Label("\(med.currentStreak)", systemImage: "flame.fill")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(Theme.energy)
                        }
                        Text(rate.formatted(.percent.precision(.fractionLength(0))))
                            .font(.caption.weight(.semibold))
                            .fontDesign(.rounded)
                            .monospacedDigit()
                    }
                    Capsule()
                        .fill(Theme.good.opacity(0.15))
                        .frame(height: 10)
                        .overlay(alignment: .leading) {
                            GeometryReader { geo in
                                Capsule()
                                    .fill(LinearGradient(colors: [Theme.good.opacity(0.5), Theme.good], startPoint: .leading, endPoint: .trailing))
                                    .frame(width: rate > 0 ? max(geo.size.width * min(rate, 1), 10) : 0)
                            }
                        }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}

#Preview("Adherencia · 375 pt · XXL") {
    let window = AdherenceWindow(due: 60, taken: 57, rate: 0.95)
    let days = (0..<30).map { offset in
        let date = Calendar.current.date(byAdding: .day, value: offset - 29, to: .now)!
        return AdherenceDay(date: LocalClock.date(date), due: 2, taken: offset % 6 == 0 ? 1 : 2)
    }
    return NarrowPreview(dynamicType: .xxLarge) {
        AdherenceSection(report: AdherenceReport(
            overall: .init(last7: window, last30: window, currentStreak: 128, bestStreak: 212),
            medications: [
                MedicationAdherence(medicationId: "1", name: "Vitamina D3 + K2 2000 UI con aceite de oliva", last7: window, last30: window, currentStreak: 128, bestStreak: 212),
                MedicationAdherence(medicationId: "2", name: "Magnesio", last7: window, last30: AdherenceWindow(due: 30, taken: 12, rate: 0.4), currentStreak: 0, bestStreak: 9),
            ],
            days: days
        ))
    }
}
