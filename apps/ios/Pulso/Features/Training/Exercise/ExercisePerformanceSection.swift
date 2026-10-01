import Charts
import SwiftUI

/// Rendimiento: the history chart as the hero (e1RM or top weight, the record
/// as a rule line), then the three records as trophy rows. Loads read in the
/// exercise's unit.
struct ExercisePerformanceSection: View {
    let exerciseId: String
    @State private var performance: ExercisePerformance?
    @State private var failed = false

    private var unit: WeightUnit { TrainingStore.shared.unit(for: exerciseId) }

    init(exerciseId: String, preview: ExercisePerformance? = nil) {
        self.exerciseId = exerciseId
        _performance = State(initialValue: preview)
    }

    var body: some View {
        VStack(spacing: 20) {
            if let performance {
                if performance.history.isEmpty {
                    EmptyStateView(
                        systemImage: "chart.line.uptrend.xyaxis",
                        title: "Sin historial todavía",
                        message: "Cuando hagas este ejercicio en una sesión verás aquí tu progreso.",
                        tint: Theme.training
                    )
                } else {
                    PerformanceChart(history: performance.history, bestE1rm: performance.bestE1rm?.kg, heaviest: performance.maxWeight?.kg, unit: unit)
                    records(performance)
                }
            } else if failed {
                EmptyStateView(systemImage: "wifi.exclamationmark", title: "Sin conexión", message: "No se pudo cargar tu rendimiento.", tint: Theme.training, actionTitle: "Reintentar") {
                    Task { await load() }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
            }
        }
        .task(id: exerciseId) { await load() }
    }

    private func load() async {
        guard let api = PulsoModel.shared.api else { return }
        failed = false
        do {
            performance = try await api.exercisePerformance(exerciseId)
        } catch {
            failed = performance == nil
            PulsoModel.shared.handle(error)
        }
    }

    private func records(_ performance: ExercisePerformance) -> some View {
        Card {
            CardTitle(text: "Récords", systemImage: "trophy")
            TrophyRow(title: "Peso máximo", systemImage: "scalemass.fill",
                      value: performance.maxWeight.map { TrainingText.load($0.kg, reps: $0.reps, unit: unit) }, at: performance.maxWeight?.at)
            Divider()
            TrophyRow(title: "Mejor 1RM estimado", systemImage: "trophy.fill",
                      value: performance.bestE1rm.map { unit.format($0.kg) }, at: performance.bestE1rm?.at)
            Divider()
            TrophyRow(title: "Volumen máximo en una sesión", systemImage: "chart.bar.fill",
                      value: performance.maxVolume.map { unit.formatTotal($0.kg) }, at: performance.maxVolume?.at)
        }
    }
}

private struct TrophyRow: View {
    let title: String
    let systemImage: String
    let value: String?
    let at: Double?

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.title3)
                .foregroundStyle(.orange.gradient)
                .frame(width: 40, height: 40)
                .background(.orange.opacity(0.14), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline).foregroundStyle(.secondary)
                Text(value ?? "—").font(.title3.bold()).fontDesign(.rounded).lineLimit(1).minimumScaleFactor(0.7)
                if let at {
                    Text(Date(timeIntervalSince1970: at / 1000).formatted(.dateTime.day().month(.abbreviated).year()))
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

private struct PerformanceChart: View {
    let history: [ExercisePerformance.Point]
    let bestE1rm: Double?
    let heaviest: Double?
    let unit: WeightUnit
    @State private var metric = Metric.e1rm
    @State private var selected: Date?

    enum Metric: String, CaseIterable, Identifiable {
        case e1rm = "1RM estimado"
        case top = "Peso máximo"
        var id: Self { self }

        /// Kg; the chart reads it through `value(_:)` in the unit.
        func kg(_ point: ExercisePerformance.Point) -> Double {
            self == .e1rm ? point.e1rm : point.topWeightKg
        }
    }

    /// The metric in the exercise's unit, as plotted and read: 44,1 lb for 20 kg.
    private func value(_ point: ExercisePerformance.Point) -> Double { unit.shown(metric.kg(point)) }

    private var record: Double? {
        let kg = metric == .e1rm ? bestE1rm ?? history.map(\.e1rm).max() : heaviest ?? history.map(\.topWeightKg).max()
        return kg.map(unit.shown)
    }

    var body: some View {
        let shown = selected.flatMap { date in history.min { abs($0.day.timeIntervalSince(date)) < abs($1.day.timeIntervalSince(date)) } } ?? history.last!
        let low = (history.map(value).min() ?? 0) * 0.92
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(selected == nil ? "Última sesión" : shown.day.formatted(.dateTime.day().month().year()))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(WeightUnit.number(value(shown)))
                        .font(.system(size: 48, weight: .bold, design: .rounded))
                        .contentTransition(.numericText())
                    Text(unit.rawValue).font(.title3.weight(.semibold)).foregroundStyle(.secondary)
                    if let record, value(shown) >= record {
                        Image(systemName: "trophy.fill").font(.title3).foregroundStyle(.orange).symbolEffect(.bounce, value: shown.at)
                    }
                }
                .animation(.snappy, value: value(shown))
            }

            Chart {
                ForEach(history) { point in
                    AreaMark(x: .value("Fecha", point.day), yStart: .value("Base", low), yEnd: .value(metric.rawValue, value(point)))
                        .foregroundStyle(LinearGradient(colors: [Theme.training.opacity(0.35), Theme.training.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                        .interpolationMethod(.monotone)
                    LineMark(x: .value("Fecha", point.day), y: .value(metric.rawValue, value(point)))
                        .foregroundStyle(Theme.training)
                        .lineStyle(StrokeStyle(lineWidth: 3, lineCap: .round))
                        .interpolationMethod(.monotone)
                }
                if let record {
                    RuleMark(y: .value("Récord", record))
                        .foregroundStyle(.orange.opacity(0.7))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                        .annotation(position: .top, alignment: .leading) {
                            Text("PR \(WeightUnit.number(record)) \(unit.rawValue)")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.orange)
                        }
                }
                PointMark(x: .value("Fecha", shown.day), y: .value(metric.rawValue, value(shown)))
                    .foregroundStyle(Theme.training)
                    .symbolSize(130)
                if selected != nil {
                    RuleMark(x: .value("Fecha", shown.day))
                        .foregroundStyle(Theme.training.opacity(0.3))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                }
            }
            .chartYScale(domain: .automatic(includesZero: false))
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 4)) { _ in AxisValueLabel(format: .dateTime.day().month(.abbreviated)) }
            }
            .chartYAxis {
                AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { _ in AxisValueLabel() }
            }
            .chartXSelection(value: $selected)
            .frame(height: 220)
            .sensoryFeedback(.selection, trigger: shown.at)

            Picker("Métrica", selection: $metric.animation(.snappy)) {
                ForEach(Metric.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
        }
        .padding(18)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

#Preview("Rendimiento · 375 pt", traits: .fixedLayout(width: 375, height: 900)) {
    ScrollView {
        ExercisePerformanceSection(exerciseId: "press-banca", preview: .preview).padding()
    }
}
