import Charts
import SwiftUI

/// The sleep deep dive: last night as the hero, its stages, trends, schedule
/// consistency and debt. Entry point for Hoy's sleep card.
struct SleepView: View {
    let model: PulsoModel
    @State private var store = SleepStore()

    var body: some View {
        ScrollView {
            if let night = store.night, let overview = store.overview {
                VStack(spacing: 20) {
                    NightPicker(store: store, night: night)
                    SleepHero(night: night)
                    HypnogramCard(night: night)
                    InsightsCard(insights: night.insights + (night.night == store.nights.first?.night ? overview.summary.insights : []))
                    ScoreFactorsCard(score: night.score)
                    TrendCard(nights: store.nights, targetMin: overview.targetMin, selected: $store.selected)
                    ConsistencyCard(nights: store.nights, summary: overview.summary)
                    DebtCard(summary: overview.summary) { minutes in
                        Task { await store.setTarget(minutes, model: model) }
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 32)
                .animation(.snappy, value: night.night)
            } else if store.loaded && !store.syncing {
                SleepEmptyState { Task { await store.sync(model, force: true) } }
                    .containerRelativeFrame(.vertical)
            } else {
                ProgressView("Leyendo tu sueño…")
                    .containerRelativeFrame(.vertical)
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Sueño")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            if store.syncing {
                ProgressView()
            } else {
                Button("Sincronizar", systemImage: "arrow.triangle.2.circlepath") {
                    Task { await store.sync(model, force: true) }
                }
            }
        }
        .refreshable { await store.sync(model, force: true) }
        .task {
            await store.load(model)
            await store.sync(model)
        }
    }
}

// MARK: - Night picker and hero

private struct NightPicker: View {
    let store: SleepStore
    let night: SleepNight

    var body: some View {
        HStack {
            Button("Noche anterior", systemImage: "chevron.left") { store.older() }
                .disabled(!store.hasOlder)
            Spacer()
            Menu {
                Picker("Noche", selection: Binding(get: { night.night }, set: { store.selected = $0 })) {
                    ForEach(store.nights) { n in
                        Text(n.date.formatted(.dateTime.weekday(.wide).day().month())).tag(n.night)
                    }
                }
            } label: {
                VStack(spacing: 2) {
                    Text(title).font(.headline)
                    Text(night.date.formatted(.dateTime.weekday(.wide).day().month(.wide)))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .foregroundStyle(.primary)
                .contentTransition(.opacity)
            }
            Spacer()
            Button("Noche siguiente", systemImage: "chevron.right") { store.newer() }
                .disabled(!store.hasNewer)
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .sensoryFeedback(.selection, trigger: night.night)
    }

    private var title: String {
        if Calendar.current.isDateInToday(night.date) { return "Anoche" }
        if Calendar.current.isDateInYesterday(night.date) { return "Antenoche" }
        return "Noche"
    }
}

private struct SleepHero: View {
    let night: SleepNight

    var body: some View {
        VStack(spacing: 18) {
            ZStack {
                Circle().stroke(Theme.sleep.opacity(0.15), lineWidth: 18)
                Circle()
                    .trim(from: 0, to: night.score.value / 100)
                    .stroke(
                        AngularGradient(colors: [Theme.sleepDeep, Theme.sleep, Theme.sleepREM], center: .center),
                        style: StrokeStyle(lineWidth: 18, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 0) {
                    Text("\(Int(night.score.value))")
                        .font(.system(size: 64, weight: .bold, design: .rounded))
                        .contentTransition(.numericText(value: night.score.value))
                    Text("puntuación").font(.subheadline).foregroundStyle(.secondary)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(.horizontal, 24)
            }
            .frame(width: 200, height: 200)
            .animation(.snappy, value: night.score.value)

            VStack(spacing: 6) {
                Text(sleepDuration(night.minutes.asleep))
                    .font(.system(.title, design: .rounded).weight(.semibold))
                    .contentTransition(.numericText())
                HStack(spacing: 14) {
                    Label(night.bedtime.formatted(date: .omitted, time: .shortened), systemImage: "moon.fill")
                    Image(systemName: "arrow.right").font(.caption).foregroundStyle(.tertiary)
                    Label(night.wake.formatted(date: .omitted, time: .shortened), systemImage: "sunrise.fill")
                }
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
                .symbolRenderingMode(.multicolor)
            }

            Text(night.score.explanation)
                .font(.callout)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .padding(.horizontal, Theme.padding)
        .background(
            LinearGradient(colors: [Theme.sleep.opacity(0.18), .clear], startPoint: .top, endPoint: .bottom),
            in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous)
        )
    }
}

// MARK: - Hypnogram

private struct HypnogramCard: View {
    let night: SleepNight

    private var segments: [SleepSegment] {
        let staged = night.segments.filter { $0.stage != .inBed }
        return staged.isEmpty ? night.segments : staged
    }

    private var lanes: [SleepStage] {
        let present = Set(segments.map(\.stage))
        return [.awake, .rem, .core, .deep, .asleep, .inBed].filter(present.contains)
    }

    var body: some View {
        Card {
            CardTitle(text: "Fases", systemImage: "waveform.path.ecg")
            Chart(Array(segments.enumerated()), id: \.offset) { _, segment in
                BarMark(
                    xStart: .value("Inicio", segment.startDate),
                    xEnd: .value("Fin", segment.endDate),
                    y: .value("Fase", segment.stage.label)
                )
                .foregroundStyle(segment.stage.color.gradient)
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
            }
            .chartYScale(domain: lanes.map(\.label))
            .chartXAxis {
                AxisMarks(values: .stride(by: .hour, count: 2)) { _ in
                    AxisValueLabel(format: .dateTime.hour())
                }
            }
            .chartYAxis {
                AxisMarks { _ in AxisValueLabel() }
            }
            .frame(height: 170)

            if night.stagePct != nil {
                // Four columns of "1 h 45 min" need ~330 pt; a 375 pt card has ~310, so 2 × 2 there.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) {
                        stat(.awake); stat(.rem); stat(.core); stat(.deep)
                    }
                    Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 12) {
                        GridRow { stat(.awake); stat(.rem) }
                        GridRow { stat(.core); stat(.deep) }
                    }
                }
                .padding(.top, 4)
            }
        }
    }

    private func stat(_ stage: SleepStage) -> StageStat {
        switch stage {
        case .awake: StageStat(stage: .awake, minutes: night.minutes.awake, total: nil)
        case .rem: StageStat(stage: .rem, minutes: night.minutes.rem, total: night.minutes.asleep)
        case .core: StageStat(stage: .core, minutes: night.minutes.core, total: night.minutes.asleep)
        default: StageStat(stage: .deep, minutes: night.minutes.deep, total: night.minutes.asleep)
        }
    }
}

private struct StageStat: View {
    let stage: SleepStage
    let minutes: Double
    let total: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Circle().fill(stage.color).frame(width: 7, height: 7)
                Text(stage.label).font(.caption).foregroundStyle(.secondary)
            }
            Text(sleepDuration(minutes))
                .font(.system(.subheadline, design: .rounded).weight(.semibold))
                .contentTransition(.numericText())
            if let total, total > 0 {
                Text((minutes / total).formatted(.percent.precision(.fractionLength(0))))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Insights and score

private struct InsightsCard: View {
    let insights: [String]

    var body: some View {
        if !insights.isEmpty {
            Card {
                CardTitle(text: "Lo que vemos", systemImage: "sparkles")
                ForEach(insights, id: \.self) { insight in
                    Label {
                        Text(insight).font(.callout)
                    } icon: {
                        Image(systemName: "moon.stars.fill").foregroundStyle(Theme.sleep)
                    }
                }
            }
        }
    }
}

private struct ScoreFactorsCard: View {
    let score: SleepScore

    var body: some View {
        Card {
            CardTitle(text: "Puntuación", systemImage: "gauge.with.dots.needle.67percent")
            ForEach(score.factors) { factor in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(factor.label).font(.subheadline.weight(.medium))
                        Spacer(minLength: 8)
                        Text("\(Int(factor.points))/\(Int(factor.maxPoints))")
                            .font(.system(.subheadline, design: .rounded).monospacedDigit())
                            .foregroundStyle(.secondary)
                            .contentTransition(.numericText())
                            .lineLimit(1)
                            .layoutPriority(1)
                    }
                    ProgressView(value: factor.points, total: max(factor.maxPoints, 1))
                        .tint(Theme.sleep)
                    Text(factor.detail).font(.caption).foregroundStyle(.secondary)
                }
                .padding(.vertical, 2)
            }
        }
    }
}

// MARK: - Trend

private struct TrendCard: View {
    enum Metric: String, CaseIterable { case duration = "Duración", score = "Puntuación" }

    let nights: [SleepNight]
    let targetMin: Double
    @Binding var selected: String?
    @State private var range = 14
    @State private var metric = Metric.duration
    @State private var scrubbed: Date?

    private var shown: [SleepNight] { Array(nights.prefix(range)) }

    private func value(_ night: SleepNight) -> Double {
        metric == .duration ? night.minutes.asleep / 60 : night.score.value
    }

    private var readout: SleepNight? { scrubbed.flatMap(nearest) ?? shown.first }

    private func nearest(_ date: Date) -> SleepNight? {
        shown.min { abs($0.date.timeIntervalSince(date)) < abs($1.date.timeIntervalSince(date)) }
    }

    var body: some View {
        Card {
            HStack {
                CardTitle(text: "Tendencia", systemImage: "chart.xyaxis.line")
                Spacer(minLength: 8)
                // Capped rather than .fixedSize(), so at large text it shares the row instead of pushing past it.
                Picker("Noches", selection: $range) {
                    Text("14 n").tag(14)
                    Text("30 n").tag(30)
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 140)
            }
            Picker("Métrica", selection: $metric) {
                ForEach(Metric.allCases, id: \.self) { Text($0.rawValue) }
            }
            .pickerStyle(.segmented)

            if let readout {
                VStack(alignment: .leading, spacing: 0) {
                    Text(metric == .duration ? sleepDuration(readout.minutes.asleep) : "\(Int(readout.score.value)) puntos")
                        .font(.system(.title2, design: .rounded).weight(.semibold))
                        .contentTransition(.numericText())
                    Text(readout.date.formatted(.dateTime.weekday(.abbreviated).day().month()))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .animation(.snappy, value: readout.night)
            }

            Chart {
                ForEach(shown) { night in
                    AreaMark(x: .value("Noche", night.date, unit: .day), y: .value(metric.rawValue, value(night)))
                        .interpolationMethod(.catmullRom)
                        .foregroundStyle(LinearGradient(colors: [Theme.sleep.opacity(0.35), Theme.sleep.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                    LineMark(x: .value("Noche", night.date, unit: .day), y: .value(metric.rawValue, value(night)))
                        .interpolationMethod(.catmullRom)
                        .foregroundStyle(Theme.sleep)
                        .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round))
                }
                if metric == .duration {
                    RuleMark(y: .value("Objetivo", targetMin / 60))
                        .foregroundStyle(.secondary)
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                        .annotation(position: .top, alignment: .leading) {
                            Text("Objetivo \(sleepDuration(targetMin))").font(.caption2).foregroundStyle(.secondary)
                        }
                }
                if let readout {
                    PointMark(x: .value("Noche", readout.date, unit: .day), y: .value(metric.rawValue, value(readout)))
                        .foregroundStyle(Theme.sleep)
                        .symbolSize(70)
                }
            }
            .chartYScale(domain: metric == .duration ? 0...max(10, (shown.map(value).max() ?? 0) + 1) : 0...100)
            .chartXAxis {
                AxisMarks(values: .stride(by: .day, count: range > 14 ? 7 : 3)) { _ in
                    AxisValueLabel(format: .dateTime.day().month(.abbreviated))
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading) { _ in AxisValueLabel() }
            }
            .chartXSelection(value: $scrubbed)
            .frame(height: 180)
            .animation(.snappy, value: metric)
            .animation(.snappy, value: range)
            .sensoryFeedback(.selection, trigger: readout?.night)
            // Lifting the finger shows that night above.
            .onChange(of: scrubbed) { last, now in
                if now == nil, let last, let night = nearest(last) { selected = night.night }
            }
        }
    }
}

// MARK: - Consistency

private struct ConsistencyCard: View {
    let nights: [SleepNight]
    let summary: SleepSummary

    private var shown: [SleepNight] { Array(nights.prefix(14)) }

    var body: some View {
        Card {
            CardTitle(text: "Horarios", systemImage: "bed.double.fill")
            // Regularity beside "Te despiertas 07:15 ±25 min" needs ~330 pt at large text: stacked below that.
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) {
                    regularity
                    Spacer(minLength: 12)
                    clocks(alignment: .trailing)
                }
                VStack(alignment: .leading, spacing: 10) {
                    regularity
                    clocks(alignment: .leading)
                }
            }

            Chart {
                ForEach(shown) { night in
                    BarMark(
                        x: .value("Noche", night.date, unit: .day),
                        yStart: .value("Acostarse", night.bedtimeMin),
                        yEnd: .value("Despertar", night.wakeMin),
                        width: .fixed(8)
                    )
                    .foregroundStyle(LinearGradient(colors: [Theme.sleepDeep, Theme.sleepREM], startPoint: .top, endPoint: .bottom))
                    .clipShape(Capsule())
                }
                if let bed = summary.avgBedtimeMin {
                    RuleMark(y: .value("Acostarse", bed)).foregroundStyle(Theme.sleepDeep.opacity(0.5)).lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                }
                if let wake = summary.avgWakeMin {
                    RuleMark(y: .value("Despertar", wake)).foregroundStyle(Theme.sleepREM.opacity(0.6)).lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                }
            }
            // Earlier at the top, like a day planner.
            .chartYScale(domain: .automatic(includesZero: false, reversed: true))
            .chartYAxis {
                AxisMarks(position: .leading, values: .stride(by: 120)) { value in
                    AxisValueLabel {
                        if let minutes = value.as(Double.self) { Text(sleepClock(minutes)) }
                    }
                }
            }
            .chartXAxis {
                AxisMarks(values: .stride(by: .day, count: 3)) { _ in
                    AxisValueLabel(format: .dateTime.day().month(.abbreviated))
                }
            }
            .frame(height: 200)
        }
    }

    @ViewBuilder private var regularity: some View {
        if let regularity = summary.regularity {
            VStack(alignment: .leading, spacing: 0) {
                Text("\(Int(regularity))")
                    .font(.system(.largeTitle, design: .rounded).weight(.bold))
                    .contentTransition(.numericText())
                Text("regularidad").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func clocks(alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 4) {
            if let bed = summary.avgBedtimeMin {
                clockRow("moon.fill", "Te acuestas", bed, summary.bedtimeSdMin)
            }
            if let wake = summary.avgWakeMin {
                clockRow("sunrise.fill", "Te despiertas", wake, summary.wakeSdMin)
            }
        }
    }

    private func clockRow(_ icon: String, _ label: String, _ minutes: Double, _ sd: Double?) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).symbolRenderingMode(.multicolor)
            Text(label).foregroundStyle(.secondary)
            Text(sleepClock(minutes)).fontDesign(.rounded).fontWeight(.semibold).monospacedDigit()
            if let sd { Text("±\(Int(sd)) min").foregroundStyle(.tertiary) }
        }
        .font(.caption)
        .lineLimit(1)
    }
}

// MARK: - Debt and target

private struct DebtCard: View {
    let summary: SleepSummary
    let setTarget: (Double) -> Void
    @State private var target: Double?

    var body: some View {
        let current = target ?? summary.targetMin
        Card {
            CardTitle(text: "Deuda de sueño", systemImage: "hourglass")
            // "10 h 45 min" in large title is ~210 pt; with the caption beside it a 375 pt card overflows.
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) {
                    debt
                    Spacer(minLength: 8)
                    nightsCaption
                }
                VStack(alignment: .leading, spacing: 2) {
                    debt
                    nightsCaption
                }
            }
            Gauge(value: min(summary.debtMin, 600), in: 0...600) { EmptyView() }
                .gaugeStyle(.accessoryLinearCapacity)
                .tint(Gradient(colors: [Theme.sleepREM, Theme.sleepAwake]))
            Divider().padding(.vertical, 4)
            // Label and value stacked: in one line beside the stepper they need ~330 pt.
            Stepper(value: Binding(get: { current }, set: { target = $0 }), in: 300...660, step: 15) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Objetivo por noche").font(.subheadline).foregroundStyle(.secondary)
                    Text(sleepDuration(current))
                        .font(.system(.title3, design: .rounded).weight(.semibold))
                        .contentTransition(.numericText())
                }
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            }
            .sensoryFeedback(.selection, trigger: current)
            .task(id: target) {
                guard let target, target != summary.targetMin else { return }
                try? await Task.sleep(for: .milliseconds(700))
                if !Task.isCancelled { setTarget(target) }
            }
        }
    }

    private var debt: some View {
        Text(summary.debtMin < 1 ? "Al día" : sleepDuration(summary.debtMin))
            .font(.system(.largeTitle, design: .rounded).weight(.bold))
            .foregroundStyle(summary.debtMin >= 120 ? Theme.sleepAwake : .primary)
            .contentTransition(.numericText())
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }

    private var nightsCaption: some View {
        Text("últimas \(summary.nights) noches").font(.caption).foregroundStyle(.secondary).lineLimit(1)
    }
}

// MARK: - Empty state

private struct SleepEmptyState: View {
    let sync: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "moon.zzz.fill")
                .font(.system(size: 64))
                .foregroundStyle(LinearGradient(colors: [Theme.sleepREM, Theme.sleepDeep], startPoint: .top, endPoint: .bottom))
                .symbolEffect(.breathe)
            Text("Duerme con tu Apple Watch y tus noches aparecerán aquí.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Sincronizar desde Salud", systemImage: "heart.text.square", action: sync)
                .buttonStyle(.glassProminent)
                .tint(Theme.sleep)
        }
        .padding(32)
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Previews

private let previewNight: SleepNight = {
    let bed = 1_790_808_600_000.0 // 23:30 the night before
    let stages: [(SleepStage, Double)] = [(.core, 50), (.deep, 45), (.core, 60), (.rem, 35), (.awake, 12), (.core, 70), (.deep, 40), (.rem, 55), (.core, 80), (.rem, 60), (.awake, 8)]
    var start = bed
    let segments = stages.map { stage, minutes in
        defer { start += minutes * 60_000 }
        return SleepSegment(start: start, end: start + minutes * 60_000, stage: stage)
    }
    return SleepNight(
        night: "2026-10-01", source: "watch", inBedStart: bed, inBedEnd: start, asleepStart: bed, asleepEnd: start,
        minutes: SleepMinutes(inBed: 515, asleep: 495, awake: 20, core: 260, deep: 85, rem: 150, unspecified: 0),
        efficiency: 0.96, stagePct: SleepStagePct(core: 0.53, deep: 0.17, rem: 0.30), bedtimeMin: -30, wakeMin: 485,
        score: SleepScore(value: 100, factors: [
            SleepScoreFactor(key: "duration", label: "Duración respecto a tu objetivo de sueño", points: 40, maxPoints: 40, detail: "8 h 15 min de 8 h"),
        ], explanation: "Dormiste más de ocho horas con mucho sueño profundo y REM, y te despertaste poco."),
        insights: ["Te acostaste 40 minutos más tarde que tu media de las últimas dos semanas."],
        segments: segments
    )
}()

private let previewSummary = SleepSummary(
    nights: 14, targetMin: 510, avgBedtimeMin: -25, avgWakeMin: 455, bedtimeSdMin: 48, wakeSdMin: 35,
    regularity: 82, debtMin: 645, insights: []
)

#Preview("Sueño · 375 pt · XXL") {
    NarrowPreview(dynamicType: .xxLarge) {
        SleepHero(night: previewNight)
        HypnogramCard(night: previewNight)
        ScoreFactorsCard(score: previewNight.score)
        ConsistencyCard(nights: [previewNight], summary: previewSummary)
        DebtCard(summary: previewSummary) { _ in }
    }
}
