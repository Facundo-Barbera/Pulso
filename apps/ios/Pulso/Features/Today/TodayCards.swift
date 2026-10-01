import Charts
import SwiftUI

// MARK: - Readiness

extension Readiness {
    var color: Color {
        switch level {
        case "high": Theme.body
        case "medium": Theme.carbs
        case "low": Theme.protein
        default: .secondary
        }
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

struct ReadinessCard: View {
    let readiness: Readiness?

    var body: some View {
        Card {
            CardTitle(text: "Recuperación", systemImage: "bolt.heart")
            if let readiness {
                HStack(spacing: 18) {
                    Ring(progress: Double(readiness.score ?? 0) / 100, color: readiness.color, lineWidth: 12) {
                        VStack(spacing: 0) {
                            Text(readiness.score.map(String.init) ?? "–")
                                .font(.system(size: 38, weight: .bold, design: .rounded))
                                .contentTransition(.numericText())
                            Text("de 100").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    .frame(width: 112, height: 112)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(readiness.title).font(.title3.weight(.semibold))
                        Text(readiness.explanation).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                Divider()
                ForEach(readiness.factors) { FactorRow(factor: $0) }
            } else {
                Text("Cargando…").foregroundStyle(.secondary)
            }
        }
        .animation(.spring, value: readiness)
    }
}

private struct FactorRow: View {
    let factor: ReadinessFactor

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(factor.label).font(.subheadline.weight(.medium))
                Text(factor.detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text(value).font(.subheadline.monospacedDigit().weight(.semibold))
        }
        .overlay(alignment: .bottom) {
            if let score = factor.score {
                GeometryReader { geo in
                    Capsule().fill(.quaternary)
                    Capsule().fill(color(score)).frame(width: geo.size.width * Double(score) / 100)
                }
                .frame(height: 3)
                .offset(y: 6)
            }
        }
        .padding(.bottom, 6)
    }

    private var value: String {
        guard let v = factor.value else { return "–" }
        switch factor.key {
        case "hrv": return "\(Int(v.rounded())) ms"
        case "resting_hr": return "\(Int(v.rounded())) lpm"
        default: return Format.duration(minutes: v)
        }
    }

    private func color(_ score: Int) -> Color {
        score >= 75 ? Theme.body : score >= 50 ? Theme.carbs : Theme.protein
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
            Circle().stroke(color.opacity(0.18), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: min(max(progress, 0), 1))
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            content
        }
        .padding(lineWidth / 2)
    }
}

// MARK: - Activity

struct ActivityCard: View {
    let day: DailyMetrics?

    var body: some View {
        Card {
            CardTitle(text: "Actividad", systemImage: "figure.walk")
            HStack {
                goal("Pasos", day?.steps, TodayStore.stepGoal, Theme.body, "figure.walk") { Int($0).formatted() }
                goal("Activas", day?.activeEnergy, TodayStore.energyGoal, Theme.energy, "flame.fill") { "\(Int($0)) kcal" }
                goal("Ejercicio", day?.exerciseMinutes, TodayStore.exerciseGoal, Theme.training, "bolt.fill") { "\(Int($0)) min" }
            }
        }
    }

    private func goal(_ label: String, _ value: Double?, _ target: Double, _ color: Color, _ icon: String, _ format: (Double) -> String) -> some View {
        VStack(spacing: 6) {
            Ring(progress: (value ?? 0) / target, color: color, lineWidth: 7) {
                Image(systemName: icon).font(.body.weight(.semibold)).foregroundStyle(color)
            }
            .frame(width: 64, height: 64)
            Text(value.map(format) ?? "–").font(.subheadline.monospacedDigit().weight(.semibold))
            Text("\(label) · \(format(target))").font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Sleep

struct SleepCard: View {
    let day: DailyMetrics?

    private static let deep = Color(red: 0.30, green: 0.30, blue: 0.85)
    private static let core = Color(red: 0.35, green: 0.62, blue: 0.98)
    private static let rem = Color(red: 0.45, green: 0.85, blue: 0.95)
    private static let awake = Theme.energy

    var body: some View {
        Card {
            CardTitle(text: "Sueño anoche", systemImage: "bed.double.fill")
            if let minutes = day?.sleepMinutes {
                Text(Format.duration(minutes: minutes)).font(.title2.weight(.bold).monospacedDigit())
                if let stages, stages.contains(where: { $0.minutes > 0 }) {
                    GeometryReader { geo in
                        let total = stages.map(\.minutes).reduce(0, +)
                        HStack(spacing: 2) {
                            ForEach(stages, id: \.label) { stage in
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(stage.color)
                                    .frame(width: max(0, geo.size.width - 6) * stage.minutes / total)
                            }
                        }
                    }
                    .frame(height: 14)
                    HStack(spacing: 12) {
                        ForEach(stages, id: \.label) { stage in
                            HStack(spacing: 4) {
                                Circle().fill(stage.color).frame(width: 7, height: 7)
                                Text("\(stage.label) \(Format.duration(minutes: stage.minutes))")
                            }
                        }
                    }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                }
            } else {
                Text("Sin datos de sueño. Usá el Apple Watch al dormir para ver tus fases.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }

    private var stages: [(label: String, minutes: Double, color: Color)]? {
        guard let day, day.sleepDeep != nil || day.sleepCore != nil || day.sleepRem != nil else { return nil }
        return [
            ("Profundo", day.sleepDeep ?? 0, Self.deep),
            ("Básico", day.sleepCore ?? 0, Self.core),
            ("REM", day.sleepRem ?? 0, Self.rem),
            ("Despierto", day.sleepAwake ?? 0, Self.awake),
        ]
    }
}

// MARK: - Signals

struct SignalsCard: View {
    let store: TodayStore

    var body: some View {
        Card {
            CardTitle(text: "Señales · 14 días", systemImage: "waveform.path.ecg")
            HStack(spacing: 16) {
                Sparkline(title: "VFC", unit: "ms", points: store.trend(14) { $0.hrv }, baseline: baseline("hrv"), color: Theme.body)
                Sparkline(title: "Pulso reposo", unit: "lpm", points: store.trend(14) { $0.restingHeartRate }, baseline: baseline("resting_hr"), color: Theme.protein)
            }
            let vo2 = store.days.last { $0.vo2max != nil }?.vo2max
            let breathing = store.today?.respiratoryRate
            if vo2 != nil || breathing != nil {
                Divider()
                HStack {
                    if let vo2 { chip("VO₂ máx", String(format: "%.1f", vo2), "ml/kg·min") }
                    if let breathing { chip("Respiración", String(format: "%.1f", breathing), "rpm") }
                }
            }
        }
    }

    private func baseline(_ key: String) -> Double? {
        store.readiness?.factors.first { $0.key == key }?.baseline
    }

    private func chip(_ label: String, _ value: String, _ unit: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value).font(.headline.monospacedDigit())
                Text(unit).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct Sparkline: View {
    let title: String
    let unit: String
    let points: [(date: Date, value: Double)]
    let baseline: Double?
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(points.last.map { "\(Int($0.value.rounded()))" } ?? "–").font(.title3.weight(.bold).monospacedDigit())
                Text(unit).font(.caption2).foregroundStyle(.secondary)
            }
            Chart {
                if let baseline {
                    RuleMark(y: .value("Media", baseline))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                        .foregroundStyle(.secondary.opacity(0.6))
                }
                ForEach(points, id: \.date) { point in
                    LineMark(x: .value("Día", point.date), y: .value(title, point.value))
                        .interpolationMethod(.catmullRom)
                        .foregroundStyle(color)
                }
                if let last = points.last {
                    PointMark(x: .value("Día", last.date), y: .value(title, last.value))
                        .foregroundStyle(color)
                        .symbolSize(30)
                }
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .chartYScale(domain: .automatic(includesZero: false))
            .frame(height: 54)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Workouts

struct WorkoutsCard: View {
    let workouts: [Workout]

    var body: some View {
        Card {
            CardTitle(text: "Entrenamientos recientes", systemImage: "figure.run")
            if workouts.isEmpty {
                Text("Todavía nada.").font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(workouts.prefix(4)) { workout in
                let start = Date(timeIntervalSince1970: workout.startedAt / 1000)
                HStack(spacing: 12) {
                    Image(systemName: Self.icon(workout.activity))
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Theme.training)
                        .frame(width: 34, height: 34)
                        .background(Theme.training.opacity(0.15), in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text(Self.name(workout.activity)).font(.subheadline.weight(.semibold))
                        Text(details(workout, start: start)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(start.formatted(.relative(presentation: .named).locale(Locale(identifier: "es"))))
                        .font(.caption).foregroundStyle(.tertiary)
                }
            }
        }
    }

    private func details(_ workout: Workout, start: Date) -> String {
        var parts = ["\(Int((workout.endedAt - workout.startedAt) / 60_000)) min"]
        if let energy = workout.energy { parts.append("\(Int(energy)) kcal") }
        if let distance = workout.distance, distance > 0 { parts.append(String(format: "%.2f km", distance / 1000)) }
        return parts.joined(separator: " · ")
    }

    static func name(_ activity: String) -> String {
        switch activity {
        case "running": "Carrera"
        case "walking": "Caminata"
        case "hiking": "Senderismo"
        case "cycling": "Ciclismo"
        case "swimming": "Natación"
        case "strength", "functional_strength": "Fuerza"
        case "hiit": "HIIT"
        case "yoga": "Yoga"
        case "rowing": "Remo"
        case "elliptical": "Elíptica"
        case "core": "Core"
        case "flexibility": "Flexibilidad"
        case "cross_training": "Entrenamiento cruzado"
        case "soccer": "Fútbol"
        default: "Entrenamiento"
        }
    }

    static func icon(_ activity: String) -> String {
        switch activity {
        case "running": "figure.run"
        case "walking": "figure.walk"
        case "hiking": "figure.hiking"
        case "cycling": "figure.outdoor.cycle"
        case "swimming": "figure.pool.swim"
        case "strength", "functional_strength": "dumbbell.fill"
        case "hiit", "cross_training": "figure.highintensity.intervaltraining"
        case "yoga", "flexibility": "figure.yoga"
        case "rowing": "figure.rower"
        case "elliptical": "figure.elliptical"
        case "core": "figure.core.training"
        case "soccer": "figure.soccer"
        default: "figure.mixed.cardio"
        }
    }
}

enum Format {
    static func duration(minutes: Double) -> String {
        let total = Int(minutes.rounded())
        let h = total / 60, m = total % 60
        return h == 0 ? "\(m) min" : m == 0 ? "\(h) h" : "\(h) h \(m) min"
    }
}
