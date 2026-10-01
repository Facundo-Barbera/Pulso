import Charts
import SwiftUI

// MARK: - Readiness hero

extension Readiness {
    var color: Color { Self.color(score: score) }

    static func color(score: Int?) -> Color {
        guard let score else { return .secondary }
        return score >= 75 ? Theme.body : score >= 50 ? Theme.carbs : Theme.protein
    }

    var title: String {
        switch level {
        case "high": "Lista para exigirte"
        case "medium": "Recuperación normal"
        case "low": "Día de recuperar"
        default: "Sin datos todavía"
        }
    }
}

/// The screen's hero: a big readiness ring, what it means, and why.
struct ReadinessHero: View {
    let readiness: Readiness?

    var body: some View {
        VStack(spacing: 18) {
            Ring(progress: Double(readiness?.score ?? 0) / 100, color: readiness?.color ?? .secondary, lineWidth: 16) {
                VStack(spacing: 0) {
                    Text(readiness?.score.map(String.init) ?? "–")
                        .font(.system(size: 56, weight: .bold, design: .rounded))
                        .contentTransition(.numericText())
                    Text("recuperación").font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(width: 180, height: 180)

            VStack(spacing: 6) {
                Text(readiness?.title ?? "Calculando…").font(.title3.weight(.semibold))
                if let explanation = readiness?.explanation {
                    Text(explanation)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }

            if let factors = readiness?.factors {
                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        ForEach(factors) { FactorPill(factor: $0) }
                    }
                }
            }
        }
        .padding(.vertical, 22)
        .padding(.horizontal, Theme.padding)
        .frame(maxWidth: .infinity)
        .background {
            RoundedRectangle(cornerRadius: Theme.corner + 6, style: .continuous)
                .fill(.background.secondary)
                .overlay(
                    RadialGradient(colors: [(readiness?.color ?? .clear).opacity(0.22), .clear], center: .top, startRadius: 10, endRadius: 320)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.corner + 6, style: .continuous))
                )
        }
        .animation(.snappy, value: readiness)
    }
}

private struct FactorPill: View {
    let factor: ReadinessFactor

    var body: some View {
        VStack(spacing: 3) {
            Image(systemName: symbol).font(.caption).foregroundStyle(Readiness.color(score: factor.score))
            Text(value).font(.subheadline.weight(.semibold)).fontDesign(.rounded).contentTransition(.numericText())
            Text(factor.label).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .glassEffect(.regular.tint(Readiness.color(score: factor.score).opacity(0.12)), in: .rect(cornerRadius: 14))
        .accessibilityElement(children: .combine)
        .accessibilityHint(factor.detail)
    }

    private var symbol: String {
        switch factor.key {
        case "hrv": "waveform.path.ecg"
        case "resting_hr": "heart.fill"
        default: "moon.zzz.fill"
        }
    }

    private var value: String {
        guard let v = factor.value else { return "–" }
        switch factor.key {
        case "hrv": return "\(Int(v.rounded())) ms"
        case "resting_hr": return "\(Int(v.rounded())) lpm"
        default: return Format.duration(minutes: v)
        }
    }
}

/// A progress ring with content in the middle.
struct Ring<Content: View>: View {
    let progress: Double
    let color: Color
    var lineWidth: CGFloat = 8
    @ViewBuilder var content: Content

    var body: some View {
        ZStack {
            Circle().stroke(color.opacity(0.16), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: min(max(progress, 0), 1))
                .stroke(
                    AngularGradient(colors: [color.opacity(0.7), color], center: .center, startAngle: .degrees(0), endAngle: .degrees(360 * max(progress, 0.01))),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            content
        }
        .padding(lineWidth / 2)
        .animation(.snappy, value: progress)
    }
}

// MARK: - Activity

struct ActivityCard: View {
    let day: DailyMetrics?

    var body: some View {
        Card {
            CardTitle(text: "Actividad", systemImage: "flame")
            HStack(alignment: .top) {
                goal("Pasos", day?.steps, TodayStore.stepGoal, Theme.body, "figure.walk") { Int($0).formatted() }
                goal("Activas", day?.activeEnergy, TodayStore.energyGoal, Theme.energy, "flame.fill") { "\(Int($0)) kcal" }
                goal("Ejercicio", day?.exerciseMinutes, TodayStore.exerciseGoal, Theme.training, "bolt.fill") { "\(Int($0)) min" }
            }
        }
    }

    private func goal(_ label: String, _ value: Double?, _ target: Double, _ color: Color, _ icon: String, _ format: (Double) -> String) -> some View {
        let done = (value ?? 0) >= target
        return VStack(spacing: 6) {
            Ring(progress: (value ?? 0) / target, color: color, lineWidth: 8) {
                Image(systemName: done ? "checkmark" : icon)
                    .font(.body.weight(.bold))
                    .foregroundStyle(color)
                    .contentTransition(.symbolEffect(.replace))
                    .symbolEffect(.bounce, value: done)
            }
            .frame(width: 70, height: 70)
            Text(value.map(format) ?? "–")
                .font(.subheadline.weight(.semibold))
                .fontDesign(.rounded)
                .contentTransition(.numericText())
            Text("\(label) · \(format(target))").font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Sleep

/// Compact summary of last night. Pass a destination (the sleep deep-dive) to make the whole card a link.
struct SleepCard<Destination: View>: View {
    let day: DailyMetrics?
    let onSync: () -> Void
    @ViewBuilder var destination: () -> Destination

    var body: some View {
        if Destination.self == EmptyView.self {
            summary(linked: false)
        } else {
            NavigationLink(destination: destination) { summary(linked: true) }
                .buttonStyle(.plain)
        }
    }

    private func summary(linked: Bool) -> some View {
        Card {
            HStack {
                CardTitle(text: "Sueño anoche", systemImage: "moon.stars.fill")
                Spacer()
                if linked {
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                }
            }
            if let minutes = day?.sleepMinutes {
                HStack(alignment: .firstTextBaseline) {
                    Text(Format.duration(minutes: minutes))
                        .font(.title.weight(.bold))
                        .fontDesign(.rounded)
                        .contentTransition(.numericText())
                    Spacer()
                    Text("Meta 8 h").font(.caption).foregroundStyle(.secondary)
                }
                if let stages, stages.contains(where: { $0.minutes > 0 }) {
                    StagesBar(stages: stages)
                }
            } else {
                EmptyCardState(
                    symbol: "bed.double",
                    message: "Duerme con el Apple Watch puesto para ver tus fases de sueño.",
                    action: ("Actualizar", onSync)
                )
            }
        }
    }

    private var stages: [Stage]? {
        guard let day, day.sleepDeep != nil || day.sleepCore != nil || day.sleepRem != nil else { return nil }
        return [
            Stage(label: "Profundo", minutes: day.sleepDeep ?? 0, color: Theme.training),
            Stage(label: "Básico", minutes: day.sleepCore ?? 0, color: Theme.fat),
            Stage(label: "REM", minutes: day.sleepRem ?? 0, color: Theme.body),
            Stage(label: "Despierto", minutes: day.sleepAwake ?? 0, color: Theme.energy),
        ]
    }
}

extension SleepCard where Destination == EmptyView {
    init(day: DailyMetrics?, onSync: @escaping () -> Void) {
        self.init(day: day, onSync: onSync) { EmptyView() }
    }
}

struct Stage {
    var label: String
    var minutes: Double
    var color: Color
}

private struct StagesBar: View {
    let stages: [Stage]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            GeometryReader { geo in
                let total = stages.map(\.minutes).reduce(0, +)
                let gaps = CGFloat(stages.count - 1) * 3
                HStack(spacing: 3) {
                    ForEach(stages, id: \.label) { stage in
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .fill(stage.color.gradient)
                            .frame(width: max(0, geo.size.width - gaps) * stage.minutes / total)
                    }
                }
            }
            .frame(height: 16)
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
                GridRow {
                    legend(stages[0])
                    legend(stages[1])
                }
                GridRow {
                    legend(stages[2])
                    legend(stages[3])
                }
            }
        }
    }

    private func legend(_ stage: Stage) -> some View {
        HStack(spacing: 6) {
            Circle().fill(stage.color).frame(width: 8, height: 8)
            Text(stage.label).foregroundStyle(.secondary)
            Text(Format.duration(minutes: stage.minutes)).fontDesign(.rounded).fontWeight(.medium)
        }
        .font(.caption)
    }
}

// MARK: - Trends

struct TrendsCard: View {
    let store: TodayStore

    var body: some View {
        Card {
            CardTitle(text: "Tendencias · 14 días", systemImage: "chart.xyaxis.line")
            Sparkline(title: "VFC", unit: "ms", points: store.trend(14) { $0.hrv }, baseline: baseline("hrv"), color: Theme.body)
            Divider()
            Sparkline(title: "Pulso en reposo", unit: "lpm", points: store.trend(14) { $0.restingHeartRate }, baseline: baseline("resting_hr"), color: Theme.protein)
            let vo2 = store.days.last { $0.vo2max != nil }?.vo2max
            let breathing = store.today?.respiratoryRate
            if vo2 != nil || breathing != nil {
                Divider()
                HStack {
                    if let vo2 { stat("VO₂ máx", vo2, "ml/kg·min") }
                    if let breathing { stat("Respiración", breathing, "rpm") }
                }
            }
        }
    }

    private func baseline(_ key: String) -> Double? {
        store.readiness?.factors.first { $0.key == key }?.baseline
    }

    private func stat(_ label: String, _ value: Double, _ unit: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value.formatted(.number.precision(.fractionLength(1)))).font(.headline).fontDesign(.rounded)
                Text(unit).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A 14-day line with a soft area, the baseline dashed, and a readout of the touched day.
private struct Sparkline: View {
    let title: String
    let unit: String
    let points: [(date: Date, value: Double)]
    let baseline: Double?
    let color: Color
    @State private var selected: Date?

    private var shown: (date: Date, value: Double)? {
        guard let selected else { return points.last }
        return points.min { abs($0.date.timeIntervalSince(selected)) < abs($1.date.timeIntervalSince(selected)) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.subheadline.weight(.medium))
                Spacer()
                if let shown {
                    Text(Int(shown.value.rounded()), format: .number)
                        .font(.title3.weight(.bold))
                        .fontDesign(.rounded)
                        .contentTransition(.numericText())
                    Text(unit).font(.caption).foregroundStyle(.secondary)
                    Text(selected == nil ? "hoy" : shown.date.formatted(.dateTime.day().month(.abbreviated)))
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            if points.count < 2 {
                Text("Hacen falta unos días de datos del Apple Watch.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 64)
            } else {
                chart
            }
        }
        .animation(.snappy, value: selected)
        .sensoryFeedback(.selection, trigger: shown?.date)
    }

    private var chart: some View {
        let low = min(points.map(\.value).min() ?? 0, baseline ?? .infinity)
        let high = max(points.map(\.value).max() ?? 1, baseline ?? -.infinity)
        let pad = max((high - low) * 0.2, 1)
        return Chart {
            ForEach(points, id: \.date) { point in
                AreaMark(x: .value("Día", point.date), yStart: .value("Base", low - pad), yEnd: .value(title, point.value))
                    .interpolationMethod(.catmullRom)
                    .foregroundStyle(LinearGradient(colors: [color.opacity(0.28), color.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                LineMark(x: .value("Día", point.date), y: .value(title, point.value))
                    .interpolationMethod(.catmullRom)
                    .foregroundStyle(color)
                    .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round))
            }
            if let baseline {
                RuleMark(y: .value("Media", baseline))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 4]))
                    .foregroundStyle(.secondary.opacity(0.5))
            }
            if let shown {
                PointMark(x: .value("Día", shown.date), y: .value(title, shown.value))
                    .foregroundStyle(color)
                    .symbolSize(60)
            }
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartYScale(domain: (low - pad)...(high + pad))
        .chartXSelection(value: $selected)
        .frame(height: 64)
    }
}

enum Format {
    static func duration(minutes: Double) -> String {
        let total = Int(minutes.rounded())
        let h = total / 60, m = total % 60
        return h == 0 ? "\(m) min" : m == 0 ? "\(h) h" : "\(h) h \(m) min"
    }
}
