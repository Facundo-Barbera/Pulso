import Charts
import SwiftUI

// The models (`@pulso/contract` workouts.ts) live in TrainingModels.swift, shared with the Watch.

extension RecordedPart {
    var symbol: String {
        Workout(id: workoutId, source: "healthkit", activity: activity, startedAt: startedAt, endedAt: endedAt).symbol
    }
}

extension PulsoAPI {
    private struct LinkBody: Encodable {
        var sessionId: String?
        // Explicit null: "kept apart" must reach the engine, not be left out.
        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(sessionId, forKey: .sessionId)
        }
        enum CodingKeys: String, CodingKey { case sessionId }
    }
    private struct LinkResponse: Decodable { var session: TrainingSession? }

    /// "Unir con…" (a session id) or "Separar" (nil). Returns the session as it is now.
    func linkWorkout(_ workoutId: String, to sessionId: String?) async throws -> TrainingSession? {
        let response: LinkResponse = try await call("api/mobile/workouts/\(workoutId)/link", method: "PUT", body: LinkBody(sessionId: sessionId))
        return response.session
    }
}

// MARK: - The session's card

/// "Registrado también por Apple Watch": each workout merged into the session
/// with its kcal and heart rate, the heart-rate chart, "Separar" for a wrong
/// guess and "Unir con…" for one the engine missed.
struct RecordedCard: View {
    let session: TrainingSession
    let changed: (TrainingSession) -> Void
    @State private var busy = false
    @State private var linked = 0

    private var parts: [RecordedPart] { session.recorded?.parts ?? [] }
    private var joinable: [RecordedPart] { session.joinable ?? [] }

    var body: some View {
        Card {
            CardTitle(text: parts.isEmpty ? "Salud" : "Registrado también por \(session.recorded?.byWatch == true ? "Apple Watch" : "Salud")", systemImage: "applewatch")
            if parts.isEmpty {
                Text("Ningún entrenamiento de Salud cuenta como parte de esta sesión.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            ForEach(parts) { part in
                HStack(spacing: 12) {
                    Image(systemName: part.symbol)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.pink)
                        .frame(width: 34, height: 34)
                        .background(.pink.opacity(0.15), in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text(part.title).font(.subheadline.weight(.semibold))
                        Text(part.facts).font(.caption).foregroundStyle(.secondary).fontDesign(.rounded)
                    }
                    Spacer(minLength: 8)
                    Button("Separar") { link(part.workoutId, to: nil) }
                        .font(.caption.weight(.medium))
                        .buttonStyle(.glass)
                        .disabled(busy)
                        .accessibilityHint("No era parte de esta sesión")
                }
            }
            if let points = session.recorded?.heartRate, points.count > 1 {
                HeartRateChart(points: points, average: session.recorded?.avgHeartRate)
                    .padding(.top, 4)
            }
            if !joinable.isEmpty {
                Menu {
                    ForEach(joinable) { candidate in
                        Button {
                            link(candidate.workoutId, to: session.id)
                        } label: {
                            Text(candidate.title)
                            Text([candidate.facts, Date(timeIntervalSince1970: candidate.startedAt / 1000).formatted(date: .omitted, time: .shortened), candidate.joinedTo != nil ? "en otra sesión" : nil].compactMap { $0 }.joined(separator: " · "))
                        }
                    }
                } label: {
                    Label("Unir con…", systemImage: "link")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glass)
                .disabled(busy)
            }
        }
        .sensoryFeedback(.success, trigger: linked)
        .animation(.snappy, value: parts)
    }

    private func link(_ workoutId: String, to sessionId: String?) {
        guard let api = PulsoModel.shared.api else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                if let updated = try await api.linkWorkout(workoutId, to: sessionId), updated.id == session.id {
                    changed(updated)
                } else {
                    changed(try await api.trainingSession(session.id))
                }
                linked += 1
                await TrainingStore.shared.load()
                await PulsoModel.shared.refresh()
            } catch {
                PulsoModel.shared.handle(error)
            }
        }
    }
}

/// The Watch's heart rate during the session: a soft area, no grid, the average as a quiet rule.
struct HeartRateChart: View {
    let points: [HeartRatePoint]
    var average: Double?
    @State private var selected: Date?

    private var readout: HeartRatePoint? {
        guard let selected else { return nil }
        return points.min { abs($0.date.timeIntervalSince(selected)) < abs($1.date.timeIntervalSince(selected)) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text("Frecuencia cardiaca").font(.caption).foregroundStyle(.secondary)
                Spacer()
                if let readout {
                    Text("\(Int(readout.bpm)) ppm · \(readout.date.formatted(date: .omitted, time: .shortened))")
                        .font(.caption.weight(.semibold))
                        .fontDesign(.rounded)
                        .contentTransition(.numericText())
                } else if let average {
                    Text("media \(Int(average.rounded())) ppm").font(.caption).foregroundStyle(.secondary).fontDesign(.rounded)
                }
            }
            Chart {
                ForEach(points, id: \.at) { point in
                    AreaMark(x: .value("Hora", point.date), yStart: .value("Base", (points.map(\.bpm).min() ?? 0) - 10), yEnd: .value("ppm", point.bpm))
                        .foregroundStyle(LinearGradient(colors: [.pink.opacity(0.35), .pink.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                        .interpolationMethod(.catmullRom)
                    LineMark(x: .value("Hora", point.date), y: .value("ppm", point.bpm))
                        .foregroundStyle(.pink)
                        .interpolationMethod(.catmullRom)
                }
                if let readout {
                    PointMark(x: .value("Hora", readout.date), y: .value("ppm", readout.bpm))
                        .foregroundStyle(.pink)
                        .symbolSize(60)
                }
            }
            .chartYScale(domain: ((points.map(\.bpm).min() ?? 60) - 10)...((points.map(\.bpm).max() ?? 180) + 5))
            .chartYAxis(.hidden)
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 3)) { _ in
                    AxisValueLabel(format: .dateTime.hour().minute())
                }
            }
            .chartXSelection(value: $selected)
            .frame(height: 110)
            .animation(.snappy, value: selected)
        }
    }
}
