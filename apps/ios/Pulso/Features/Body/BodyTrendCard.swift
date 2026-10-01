import Charts
import SwiftUI

/// One metric over time: readings, the fitted trend, and the next 12 weeks
/// with an 80% band, plus the goal line and when the trend reaches it.
struct BodyTrendCard: View {
    let store: BodyStore
    @Binding var metric: BodyMetric
    let setGoal: () -> Void
    @State private var selected: Date?

    private var projection: BodyProjection? { store.projections[metric] }
    private var color: Color {
        switch metric {
        case .weight: Theme.body
        case .bodyFatMass, .percentBodyFat: Theme.fat
        case .skeletalMuscleMass: Theme.protein
        }
    }

    var body: some View {
        Card {
            HStack {
                CardTitle(text: "Tendencia", systemImage: "chart.line.uptrend.xyaxis")
                Spacer()
                Button(store.goal(metric) == nil ? "Fijar meta" : "Meta", systemImage: "flag.checkered", action: setGoal)
                    .font(.caption.weight(.semibold))
                    .buttonStyle(.glass)
                    .controlSize(.small)
            }
            Picker("Métrica", selection: $metric) {
                ForEach(BodyMetric.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            .sensoryFeedback(.selection, trigger: metric)

            if let projection, !projection.observed.isEmpty {
                readout(projection)
                chart(projection).frame(height: 220)
                if !projection.horizons.isEmpty { horizons(projection) }
                if let goal = projection.goal {
                    Label(goal.message, systemImage: goal.eta == nil ? "flag" : "flag.checkered")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(color)
                } else {
                    Text(projection.note).font(.footnote).foregroundStyle(.secondary)
                }
            } else {
                ContentUnavailableView("Sin datos de \(metric.title.lowercased())", systemImage: "chart.xyaxis.line",
                                       description: Text("Aparecen con tus mediciones de InBody o de Salud."))
                    .frame(height: 220)
            }
        }
        .fontDesign(.rounded)
        .animation(.snappy, value: metric)
    }

    /// The selected point, or the current trend value.
    @ViewBuilder private func readout(_ p: BodyProjection) -> some View {
        let point = selected.flatMap { date in nearest(to: date, in: p) }
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Group {
                Text((point?.value ?? p.current ?? p.observed.last?.value ?? 0).decimal())
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .contentTransition(.numericText())
                Text(metric.unit).font(.headline).foregroundStyle(.secondary)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 1) {
                if let point {
                    Text(point.date.formatted(date: .abbreviated, time: .omitted)).font(.caption.weight(.semibold))
                    Text(point.projected ? "proyección" : "medición").font(.caption2).foregroundStyle(.secondary)
                } else if let slope = p.slopePerWeek {
                    DeltaBadge(delta: slope, unit: "\(metric.unit)/sem", lowerIsBetter: metric.lowerIsBetter)
                    Text("tendencia").font(.caption2).foregroundStyle(.secondary)
                }
            }
            .lineLimit(1)
            .layoutPriority(1)
        }
    }

    private func chart(_ p: BodyProjection) -> some View {
        let lastObserved = p.observed.last?.date ?? .now
        let future = p.band.filter { $0.date >= lastObserved }
        let goal = store.goal(metric)?.target
        return Chart {
            ForEach(future, id: \.at) { point in
                AreaMark(x: .value("Fecha", point.date), yStart: .value("Bajo", point.low), yEnd: .value("Alto", point.high))
                    .foregroundStyle(LinearGradient(colors: [color.opacity(0.28), color.opacity(0.08)], startPoint: .top, endPoint: .bottom))
                    .interpolationMethod(.monotone)
            }
            ForEach(p.band, id: \.at) { point in
                LineMark(x: .value("Fecha", point.date), y: .value("Tendencia", point.value), series: .value("Serie", "tendencia"))
                    .foregroundStyle(color.opacity(0.75))
                    .lineStyle(StrokeStyle(lineWidth: 2, dash: [5, 4]))
            }
            ForEach(p.observed, id: \.at) { point in
                LineMark(x: .value("Fecha", point.date), y: .value(metric.title, point.value), series: .value("Serie", "medido"))
                    .foregroundStyle(color)
                    .lineStyle(StrokeStyle(lineWidth: 2.5))
                    .interpolationMethod(.monotone)
                PointMark(x: .value("Fecha", point.date), y: .value(metric.title, point.value))
                    .foregroundStyle(color)
                    .symbolSize(p.observed.count > 40 ? 8 : 30)
            }
            if let goal {
                RuleMark(y: .value("Meta", goal))
                    .foregroundStyle(.secondary)
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 3]))
                    .annotation(position: .top, alignment: .leading) {
                        Text("Meta \(goal.decimal()) \(metric.unit)").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                    }
            }
            if let selected, let point = nearest(to: selected, in: p) {
                RuleMark(x: .value("Fecha", point.date)).foregroundStyle(.secondary.opacity(0.4))
                PointMark(x: .value("Fecha", point.date), y: .value(metric.title, point.value))
                    .foregroundStyle(color)
                    .symbolSize(90)
            }
        }
        .chartYScale(domain: yDomain(p, goal: goal))
        .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) { AxisValueLabel(format: .dateTime.month(.abbreviated)) } }
        .chartYAxis { AxisMarks(position: .trailing, values: .automatic(desiredCount: 4)) { AxisValueLabel() } }
        .chartXSelection(value: $selected)
    }

    private func horizons(_ p: BodyProjection) -> some View {
        HStack(spacing: 8) {
            ForEach(p.horizons, id: \.weeks) { h in
                VStack(spacing: 2) {
                    Text("\(h.weeks) sem").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                    Text(h.value.decimal()).font(.headline).monospacedDigit()
                    Text("\(h.low.decimal())–\(h.high.decimal())").font(.caption2).foregroundStyle(.secondary).monospacedDigit()
                }
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .padding(.horizontal, 4)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .glassEffect(.regular, in: .rect(cornerRadius: 12))
            }
        }
    }

    private struct Selected { var date: Date; var value: Double; var projected: Bool }

    private func nearest(to date: Date, in p: BodyProjection) -> Selected? {
        let lastObserved = p.observed.last?.date ?? .distantPast
        let candidates = p.observed.map { Selected(date: $0.date, value: $0.value, projected: false) }
            + p.band.filter { $0.date > lastObserved }.map { Selected(date: $0.date, value: $0.value, projected: true) }
        return candidates.min { abs($0.date.timeIntervalSince(date)) < abs($1.date.timeIntervalSince(date)) }
    }

    private func yDomain(_ p: BodyProjection, goal: Double?) -> ClosedRange<Double> {
        let lastObserved = p.observed.last?.date ?? .now
        let values = p.observed.map(\.value)
            + p.band.filter { $0.date >= lastObserved }.flatMap { [$0.low, $0.high] }
            + [goal].compactMap { $0 }
        guard let low = values.min(), let high = values.max() else { return 0...1 }
        let pad = max((high - low) * 0.12, 0.5)
        return (low - pad)...(high + pad)
    }
}
