import Charts
import SwiftUI

/// One exercise over time: e1RM as the hero chart with a selected-point
/// readout, all-time bests, then each session's sets.
struct ExerciseHistoryView: View {
    let route: ExerciseRoute
    @State private var history: ExerciseHistory?
    @State private var failed = false
    @State private var metric = Metric.e1rm
    @State private var selected: Date?

    enum Metric: String, CaseIterable, Identifiable {
        case e1rm = "1RM est."
        case top = "Peso máx."
        case volume = "Volumen"
        var id: Self { self }

        func value(_ point: ExerciseHistoryPoint) -> Double {
            switch self {
            case .e1rm: point.bestE1rm
            case .top: point.topWeightKg
            case .volume: point.volumeKg
            }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let history {
                    if history.points.isEmpty {
                        empty
                    } else {
                        chartCard(history.points)
                        bests(history)
                        sessions(history.points)
                    }
                } else if failed {
                    ContentUnavailableView("Sin conexión", systemImage: "wifi.exclamationmark", description: Text("No se pudo cargar el historial."))
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 80)
                }
            }
            .padding(.horizontal, Theme.padding)
            .padding(.bottom, 32)
        }
        .navigationTitle(route.name)
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        guard let api = PulsoModel.shared.api else { return }
        do {
            history = try await api.exerciseHistory(route.exerciseId)
        } catch {
            failed = history == nil
            PulsoModel.shared.handle(error)
        }
    }

    // MARK: Chart

    private func chartCard(_ points: [ExerciseHistoryPoint]) -> some View {
        let shown = selected.flatMap { date in points.min { abs($0.day.timeIntervalSince(date)) < abs($1.day.timeIntervalSince(date)) } } ?? points.last!
        let values = points.map(metric.value)
        let low = (values.min() ?? 0) * 0.9
        return VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(selected == nil ? "Última sesión" : shown.day.formatted(.dateTime.day().month().year()))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text("\(Int(metric.value(shown).rounded()).formatted()) kg")
                    .font(.system(size: 44, weight: .bold, design: .rounded))
                    .contentTransition(.numericText())
                    .animation(.snappy, value: metric.value(shown))
            }

            Chart(points) { point in
                AreaMark(x: .value("Fecha", point.day), yStart: .value("Base", low), yEnd: .value(metric.rawValue, metric.value(point)))
                    .foregroundStyle(LinearGradient(colors: [Theme.training.opacity(0.35), Theme.training.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                    .interpolationMethod(.monotone)
                LineMark(x: .value("Fecha", point.day), y: .value(metric.rawValue, metric.value(point)))
                    .foregroundStyle(Theme.training)
                    .lineStyle(StrokeStyle(lineWidth: 3, lineCap: .round))
                    .interpolationMethod(.monotone)
                if point.sessionId == shown.sessionId {
                    PointMark(x: .value("Fecha", point.day), y: .value(metric.rawValue, metric.value(point)))
                        .foregroundStyle(Theme.training)
                        .symbolSize(120)
                    RuleMark(x: .value("Fecha", point.day))
                        .foregroundStyle(Theme.training.opacity(0.3))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                }
            }
            .chartYScale(domain: .automatic(includesZero: false))
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                    AxisValueLabel(format: .dateTime.day().month(.abbreviated))
                }
            }
            .chartYAxis {
                AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { _ in AxisValueLabel() }
            }
            .chartXSelection(value: $selected)
            .frame(height: 220)
            .sensoryFeedback(.selection, trigger: shown.sessionId)

            Picker("Métrica", selection: $metric.animation(.snappy)) {
                ForEach(Metric.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
        }
        .padding(18)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func bests(_ history: ExerciseHistory) -> some View {
        HStack(spacing: 12) {
            BestTile(label: "Mejor 1RM est.", value: history.bestE1rm, systemImage: "trophy.fill")
            BestTile(label: "Peso más alto", value: history.heaviestKg, systemImage: "scalemass.fill")
        }
    }

    private func sessions(_ points: [ExerciseHistoryPoint]) -> some View {
        Card {
            CardTitle(text: "Sesiones", systemImage: "list.bullet")
            ForEach(points.reversed()) { point in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(point.day.formatted(.dateTime.weekday(.abbreviated).day().month())).font(.body.weight(.medium))
                        Spacer()
                        Text("1RM \(point.bestE1rm.formatted()) kg").font(.subheadline).fontDesign(.rounded).foregroundStyle(.secondary)
                    }
                    Text(point.sets.map { $0.weightKg > 0 ? "\($0.weightKg.formatted())×\($0.reps)" : "\($0.reps)" }.joined(separator: "  ·  "))
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
                if point.id != points.first?.id { Divider() }
            }
        }
    }

    private var empty: some View {
        VStack(spacing: 14) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 56))
                .foregroundStyle(Theme.training.gradient)
            Text("Sin historial todavía").font(.title3.bold())
            Text("Cuando hagas este ejercicio en una sesión verás aquí tu progreso.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 80)
    }
}

private struct BestTile: View {
    let label: String
    let value: Double?
    let systemImage: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: systemImage).foregroundStyle(.orange)
            Text(value.map { "\($0.formatted()) kg" } ?? "—").font(.title3.bold()).fontDesign(.rounded)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
    }
}
