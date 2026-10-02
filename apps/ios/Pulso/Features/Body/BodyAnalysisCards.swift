import Charts
import SwiftUI

// InBody's sheet, Pulso's way: the segmental analysis as a body, the
// muscle-fat and obesity bars, the visceral dial and the change across scans.
// The engine lays out bands and positions (`BodyAnalysis`); these only draw.

/// How each analysed metric reads on the phone: name, symbol, domain colour.
enum BodyGaugeStyle {
    static func title(_ metric: String) -> String {
        switch metric {
        case "weight": "Peso"
        case "skeletalMuscleMass": "Músculo esquelético"
        case "bodyFatMass": "Masa grasa"
        case "bmi": "IMC"
        case "percentBodyFat": "Grasa corporal"
        default: "Grasa visceral"
        }
    }

    static func symbol(_ metric: String) -> String {
        switch metric {
        case "weight": "scalemass.fill"
        case "skeletalMuscleMass": "figure.strengthtraining.traditional"
        case "bodyFatMass": "drop.fill"
        case "bmi": "gauge.with.dots.needle.50percent"
        case "percentBodyFat": "percent"
        default: "circle.circle"
        }
    }

    static func color(_ metric: String) -> Color {
        switch metric {
        case "weight", "bmi": Theme.body
        case "skeletalMuscleMass": Theme.protein
        default: Theme.fat
        }
    }

    /// Normal is fine; more muscle is fine; low fat, weight or BMI is a note, not an alarm. Nil = neutral.
    static func isGood(_ gauge: BodyGauge) -> Bool? {
        if gauge.band == .normal { return true }
        if gauge.metric == "skeletalMuscleMass" { return gauge.band == .high }
        return gauge.band == .high ? false : nil
    }
}

/// "Normal ✓" in blue, "Alto !" in orange, "Bajo ⓘ" in grey: a symbol and a word, never hue alone.
struct BandChip: View {
    let gauge: BodyGauge

    var body: some View {
        let good = BodyGaugeStyle.isGood(gauge)
        Label(gauge.band.title, systemImage: good == nil ? "info.circle.fill" : good! ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
            .font(.caption2.weight(.bold))
            .foregroundStyle(good == nil ? Color.secondary : good! ? Theme.good : Theme.caution)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background((good == nil ? Color.secondary : good! ? Theme.good : Theme.caution).opacity(0.12), in: .capsule)
            .lineLimit(1)
            .fixedSize()
    }
}

// MARK: - Body figure

enum BodySegment: CaseIterable, Identifiable {
    case rightArm, leftArm, trunk, rightLeg, leftLeg
    var id: Self { self }

    var title: String {
        switch self {
        case .rightArm: "Brazo der."
        case .leftArm: "Brazo izq."
        case .trunk: "Tronco"
        case .rightLeg: "Pierna der."
        case .leftLeg: "Pierna izq."
        }
    }

    func value(in values: SegmentValues) -> SegmentValue {
        switch self {
        case .rightArm: values.rightArm
        case .leftArm: values.leftArm
        case .trunk: values.trunk
        case .rightLeg: values.rightLeg
        case .leftLeg: values.leftLeg
        }
    }
}

/// A neutral front-view figure in a 200 × 410 box, split as InBody measures it; the
/// person's right side is drawn on the left, like the result sheet. Same outline as the web.
struct BodyFigureShape: Shape {
    static let size = CGSize(width: 200, height: 410)
    /// nil draws the head and neck.
    let segment: BodySegment?

    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width / Self.size.width, rect.height / Self.size.height)
        let dx = rect.minX + (rect.width - Self.size.width * scale) / 2
        let dy = rect.minY + (rect.height - Self.size.height * scale) / 2
        let mirrored = segment == .leftArm || segment == .leftLeg
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: dx + (mirrored ? Self.size.width - x : x) * scale, y: dy + y * scale)
        }
        var path = Path()
        switch segment {
        case nil:
            path.addEllipse(in: CGRect(origin: p(76, 14), size: CGSize(width: 48 * scale, height: 48 * scale)))
            path.addRoundedRect(in: CGRect(origin: p(91, 58), size: CGSize(width: 18 * scale, height: 18 * scale)), cornerSize: CGSize(width: 6 * scale, height: 6 * scale))
        case .rightArm, .leftArm:
            path.move(to: p(58, 82))
            path.addCurve(to: p(41, 112), control1: p(46, 84), control2: p(42, 96))
            path.addLine(to: p(36, 172))
            path.addLine(to: p(30, 232))
            path.addCurve(to: p(43, 234), control1: p(29, 244), control2: p(42, 246))
            path.addLine(to: p(50, 174))
            path.addLine(to: p(58, 124))
            path.closeSubpath()
        case .trunk:
            path.move(to: p(64, 86))
            path.addCurve(to: p(100, 72), control1: p(64, 76), control2: p(76, 72))
            path.addCurve(to: p(136, 86), control1: p(124, 72), control2: p(136, 76))
            path.addLine(to: p(132, 160))
            path.addCurve(to: p(132, 222), control1: p(130, 185), control2: p(128, 200))
            path.addLine(to: p(134, 236))
            path.addLine(to: p(66, 236))
            path.addLine(to: p(68, 222))
            path.addCurve(to: p(68, 160), control1: p(72, 200), control2: p(70, 185))
            path.closeSubpath()
        case .rightLeg, .leftLeg:
            path.move(to: p(67, 242))
            path.addLine(to: p(98, 242))
            path.addLine(to: p(96, 300))
            path.addLine(to: p(92, 360))
            path.addLine(to: p(90, 396))
            path.addCurve(to: p(74, 396), control1: p(90, 406), control2: p(74, 406))
            path.addLine(to: p(72, 360))
            path.addLine(to: p(66, 300))
            path.closeSubpath()
        }
        return path
    }
}

/// Sequential, one hue: deeper means more against the standard. The band is also written beside each segment.
private func segmentFill(_ color: Color, _ band: BodyBand?) -> Color {
    switch band {
    case .low: color.opacity(0.32)
    case .normal: color.opacity(0.62)
    case .high: color.opacity(0.95)
    case nil: color.opacity(0.5)
    }
}

/// InBody's segmental analysis as a body: each segment tinted by its lean (or fat) mass against the standard.
struct SegmentFigureCard: View {
    let segments: BodyAnalysis.Segments
    @State private var showFat = false

    private var values: SegmentValues? { showFat ? segments.fat ?? segments.lean : segments.lean ?? segments.fat }
    private var other: SegmentValues? { showFat ? segments.lean : segments.fat }
    private var fatShown: Bool { showFat ? segments.fat != nil : segments.lean == nil }
    private var color: Color { fatShown ? Theme.fat : Theme.body }

    var body: some View {
        Card {
            HStack {
                CardTitle(text: "Por segmento", systemImage: "figure.stand")
                Spacer(minLength: 8)
            }
            if segments.lean != nil && segments.fat != nil {
                Picker("Qué masa", selection: $showFat) {
                    Text("Magra").tag(false)
                    Text("Grasa").tag(true)
                }
                .pickerStyle(.segmented)
                .sensoryFeedback(.selection, trigger: showFat)
            }
            if let values {
                HStack(alignment: .center, spacing: 6) {
                    VStack(alignment: .trailing) {
                        label(.rightArm, values, alignment: .trailing)
                        Spacer(minLength: 12)
                        label(.rightLeg, values, alignment: .trailing)
                    }
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    VStack(spacing: 8) {
                        figure(values)
                        label(.trunk, values, alignment: .center)
                    }
                    VStack(alignment: .leading) {
                        label(.leftArm, values, alignment: .leading)
                        Spacer(minLength: 12)
                        label(.leftLeg, values, alignment: .leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.vertical, 6)
                .animation(.snappy, value: showFat)
                legend
            }
            if !segments.balance.isEmpty {
                FlowChips(balance: segments.balance)
            }
            Text(segments.basis == "height" ? "% del estándar para tu altura." : "% respecto a tu propio peso: añade tu altura al perfil para compararlo con el estándar.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .fontDesign(.rounded)
    }

    private func figure(_ values: SegmentValues) -> some View {
        ZStack {
            BodyFigureShape(segment: nil).fill(Color.secondary.opacity(0.22))
            ForEach(BodySegment.allCases) { segment in
                BodyFigureShape(segment: segment)
                    .fill(segmentFill(color, segment.value(in: values).band).gradient)
                    .overlay(BodyFigureShape(segment: segment).stroke(Color(.secondarySystemGroupedBackground), lineWidth: 1.5))
            }
        }
        .frame(width: 104, height: 104 * BodyFigureShape.size.height / BodyFigureShape.size.width)
        .accessibilityElement()
        .accessibilityLabel(BodySegment.allCases.map { "\($0.title): \($0.value(in: values).band?.title ?? "sin rango")" }.joined(separator: ", "))
    }

    private func label(_ segment: BodySegment, _ values: SegmentValues, alignment: HorizontalAlignment) -> some View {
        let value = segment.value(in: values)
        return VStack(alignment: alignment, spacing: 1) {
            Text(segment.title).font(.caption).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value.kg.decimal()).font(.headline).contentTransition(.numericText())
                Text("kg").font(.caption2).foregroundStyle(.secondary)
            }
            if let band = value.band, let percent = value.percent {
                HStack(spacing: 3) {
                    Circle().fill(segmentFill(color, band)).frame(width: 7, height: 7)
                    Text(band.title).fontWeight(.semibold)
                    Text("\(Int(percent)) %").foregroundStyle(.secondary)
                }
                .font(.caption2)
            }
            if let other {
                Text("\(segment.value(in: other).kg.decimal()) kg \(fatShown ? "magra" : "grasa")")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.75)
        .monospacedDigit()
        .multilineTextAlignment(alignment == .trailing ? .trailing : alignment == .leading ? .leading : .center)
    }

    private var legend: some View {
        HStack(spacing: 12) {
            ForEach([BodyBand.low, .normal, .high], id: \.self) { band in
                HStack(spacing: 4) {
                    Capsule().fill(segmentFill(color, band)).frame(width: 16, height: 8)
                    Text(band.title)
                }
            }
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
    }
}

/// Balance callouts as small chips that wrap.
private struct FlowChips: View {
    let balance: [BodyAnalysis.Segments.Balance]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) { chips }
            VStack(alignment: .leading, spacing: 6) { chips }
        }
    }

    @ViewBuilder private var chips: some View {
        ForEach(balance, id: \.self) { item in
            Label(item.text, systemImage: item.even ? "checkmark" : "scalemass")
                .font(.caption.weight(.medium))
                .foregroundStyle(item.even ? Theme.good : Theme.caution)
                .padding(.horizontal, 9)
                .padding(.vertical, 5)
                .background(.background.tertiary, in: .capsule)
                .lineLimit(1)
        }
    }
}

// MARK: - Bars

/// One InBody bar: fill to the value, the normal zone marked, the previous scan as a ghost tick, the sheet's ticks.
struct GaugeBar: View {
    let gauge: BodyGauge

    var body: some View {
        let color = BodyGaugeStyle.color(gauge.metric)
        let unit = gauge.unit == "nivel" ? "" : gauge.unit
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: BodyGaugeStyle.symbol(gauge.metric))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(color)
                    .frame(width: 24, height: 24)
                    .background(color.opacity(0.15), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                Text(BodyGaugeStyle.title(gauge.metric)).font(.subheadline.weight(.medium)).lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 4)
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(gauge.value.decimal()).font(.headline).contentTransition(.numericText())
                    Text(unit).font(.caption2).foregroundStyle(.secondary)
                }
                .monospacedDigit()
                .lineLimit(1)
                BandChip(gauge: gauge)
            }
            GeometryReader { geo in
                let w = geo.size.width
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.secondary.opacity(0.15))
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Color.primary.opacity(0.07))
                        .overlay(alignment: .leading) { Rectangle().fill(Color.primary.opacity(0.3)).frame(width: 1) }
                        .overlay(alignment: .trailing) { Rectangle().fill(Color.primary.opacity(0.3)).frame(width: 1) }
                        .frame(width: w * (gauge.at.high - gauge.at.low), height: 16)
                        .offset(x: w * gauge.at.low)
                    Capsule().fill(color.gradient).frame(width: max(w * gauge.at.value, 10))
                    if let previous = gauge.at.previous {
                        Capsule()
                            .fill(Color.primary.opacity(0.55))
                            .frame(width: 2.5, height: 16)
                            .overlay(Capsule().stroke(Color(.secondarySystemGroupedBackground), lineWidth: 1))
                            .offset(x: w * previous - 1.25)
                    }
                }
                .frame(height: 10)
                .frame(maxHeight: .infinity)
            }
            .frame(height: 16)
            ticks
            Text(caption).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(BodyGaugeStyle.title(gauge.metric)) \(gauge.value.decimal()) \(unit), \(gauge.band.title). \(caption)")
    }

    /// Every other tick: eleven labels do not fit a phone.
    private var ticks: some View {
        GeometryReader { geo in
            ForEach(Array(gauge.ticks.enumerated()).filter { $0.offset % 2 == 0 }, id: \.offset) { index, tick in
                Text(tick)
                    .font(.system(size: 9, weight: .medium, design: .rounded))
                    .foregroundStyle(.secondary)
                    .fixedSize()
                    .position(x: geo.size.width * Double(index) / Double(max(gauge.ticks.count - 1, 1)), y: 5)
            }
        }
        .frame(height: 10)
        .padding(.horizontal, 6)
    }

    private var caption: String {
        let unit = gauge.unit == "nivel" ? "" : " \(gauge.unit)"
        var parts = ["Normal \(gauge.normal.low.decimal())–\(gauge.normal.high.decimal())\(unit)"]
        if let percent = gauge.percent { parts.append("\(Int(percent)) % del estándar") }
        if let previous = gauge.previous { parts.append("antes \(previous.decimal())\(unit)") }
        return parts.joined(separator: " · ")
    }
}

/// InBody's "Análisis músculo-grasa": weight, skeletal muscle and fat mass against the standard for the height.
struct MuscleFatCard: View {
    let analysis: BodyAnalysis

    var body: some View {
        Card {
            CardTitle(text: "Músculo y grasa", systemImage: "chart.bar.xaxis")
            if let muscleFat = analysis.muscleFat {
                VStack(spacing: 18) {
                    ForEach(muscleFat.gauges) { GaugeBar(gauge: $0) }
                }
                if let basis = analysis.basis {
                    Text(basisText(basis)).font(.caption).foregroundStyle(.secondary)
                }
            } else {
                EmptyStateView(systemImage: "ruler", title: analysis.basis == nil ? "Falta tu altura" : "Falta un escaneo completo",
                               message: analysis.basis == nil ? "Añade altura y sexo a tu perfil (en la Mac, o díselo al Coach) y comparo peso, músculo y grasa con lo normal para ti." : "Con un escaneo de InBody (peso, músculo y grasa) verás dónde está cada uno.",
                               tint: Theme.protein)
            }
        }
        .fontDesign(.rounded)
    }

    private func basisText(_ basis: BodyAnalysis.Basis) -> String {
        let sex = basis.sex == "male" ? " (hombre)" : basis.sex == "female" ? " (mujer)" : ""
        let height = (basis.heightCm / 100).formatted(.number.precision(.fractionLength(2)))
        var text = "% del estándar para \(height) m\(sex): \(basis.standardWeight.decimal()) kg."
        if basis.heightFrom == "scan" { text += " Altura deducida del IMC del escaneo." }
        if basis.sex == nil { text += " Sin sexo en el perfil uso un promedio." }
        return text
    }
}

/// InBody's "Análisis de obesidad": BMI and % fat as bars, the visceral level as a dial.
struct ObesityCard: View {
    let gauges: [BodyGauge]

    var body: some View {
        Card {
            CardTitle(text: "Obesidad", systemImage: "ruler")
            VStack(spacing: 18) {
                ForEach(gauges.filter { $0.metric != "visceralFatLevel" }) { GaugeBar(gauge: $0) }
            }
            if let visceral = gauges.first(where: { $0.metric == "visceralFatLevel" }) {
                Divider().padding(.vertical, 4)
                VisceralDial(gauge: visceral)
            }
        }
        .fontDesign(.rounded)
    }
}

/// Visceral fat level 1–20 on a half dial: 1–9 healthy (blue), 10 and up high (orange, dashed).
struct VisceralDial: View {
    let gauge: BodyGauge

    private struct Arc: Shape {
        var from: Double
        var to: Double
        func path(in rect: CGRect) -> Path {
            var path = Path()
            let radius = min(rect.width / 2, rect.height) - 6
            let center = CGPoint(x: rect.midX, y: rect.maxY - 2)
            path.addArc(center: center, radius: radius, startAngle: .degrees(180 + 180 * from), endAngle: .degrees(180 + 180 * to), clockwise: false)
            return path
        }
    }

    var body: some View {
        HStack(spacing: 16) {
            GeometryReader { geo in
                let radius = min(geo.size.width / 2, geo.size.height) - 6
                let angle = Angle.degrees(180 + 180 * gauge.at.value).radians
                ZStack {
                    Arc(from: 0, to: gauge.at.high).stroke(Theme.good.opacity(0.4), style: StrokeStyle(lineWidth: 10, lineCap: .round))
                    Arc(from: gauge.at.high + 0.04, to: 1).stroke(Theme.caution.opacity(0.4), style: StrokeStyle(lineWidth: 10, lineCap: .round, dash: [3, 3]))
                    Circle()
                        .fill(Theme.fat)
                        .stroke(Color(.secondarySystemGroupedBackground), lineWidth: 3)
                        .frame(width: 15, height: 15)
                        .position(x: geo.size.width / 2 + radius * cos(angle), y: geo.size.height - 2 + radius * sin(angle))
                    Text(gauge.value.decimal(0))
                        .font(.title.bold())
                        .contentTransition(.numericText())
                        .position(x: geo.size.width / 2, y: geo.size.height - 16)
                }
            }
            .frame(width: 120, height: 66)
            VStack(alignment: .leading, spacing: 6) {
                Label("Grasa visceral", systemImage: BodyGaugeStyle.symbol(gauge.metric))
                    .font(.subheadline.weight(.medium))
                BandChip(gauge: gauge)
                Text("Nivel de 1 a 20; sano hasta 9." + (gauge.previous.map { " Antes \($0.decimal(0))." } ?? ""))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Grasa visceral nivel \(gauge.value.decimal(0)), \(gauge.band.title); sano hasta 9")
    }
}

// MARK: - Evolution

/// Weight, muscle and fat mass across InBody scans on one axis: kg changed since the first scan.
struct BodyEvolutionCard: View {
    let scans: [BodyScan]
    @State private var selected: Date?

    private struct Series: Identifiable {
        let name: String
        let symbol: String
        let color: Color
        let value: (BodyScan) -> Double?
        var id: String { name }
    }

    private let series = [
        Series(name: "Peso", symbol: "scalemass.fill", color: Theme.body) { $0.weight },
        Series(name: "Músculo", symbol: "figure.strengthtraining.traditional", color: Theme.protein) { $0.skeletalMuscleMass },
        Series(name: "Masa grasa", symbol: "drop.fill", color: Theme.fat) { $0.bodyFatMass },
    ]

    /// Full scans, oldest first, at most 24.
    private var points: [BodyScan] {
        Array(scans.filter { $0.weight != nil && $0.skeletalMuscleMass != nil && $0.bodyFatMass != nil }.prefix(24).reversed())
    }

    var body: some View {
        Card {
            CardTitle(text: "Evolución", systemImage: "chart.line.uptrend.xyaxis")
            let points = points
            if points.count < 2 {
                EmptyStateView(systemImage: "qrcode.viewfinder", title: "Hace falta otro escaneo", message: "Con dos escaneos de InBody verás cómo cambian peso, músculo y grasa.", tint: Theme.body)
            } else {
                let shown = selected.flatMap { date in points.min { abs($0.date.timeIntervalSince(date)) < abs($1.date.timeIntervalSince(date)) } } ?? points.last!
                header(first: points[0], shown: shown)
                chart(points, shown: shown).frame(height: 200)
            }
        }
        .fontDesign(.rounded)
    }

    private func header(first: BodyScan, shown: BodyScan) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 14) {
                ForEach(series) { s in
                    VStack(alignment: .leading, spacing: 2) {
                        Label(s.name, systemImage: s.symbol)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(s.color)
                            .labelStyle(.titleAndIcon)
                        Text(signed((s.value(shown) ?? 0) - (s.value(first) ?? 0)) + " kg")
                            .font(.headline)
                            .monospacedDigit()
                            .contentTransition(.numericText())
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                }
            }
            Text("\(shown.date.formatted(.dateTime.day().month())) · desde el \(first.date.formatted(.dateTime.day().month()))")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func chart(_ points: [BodyScan], shown: BodyScan) -> some View {
        let first = points[0]
        return Chart {
            ForEach(series) { s in
                ForEach(points) { scan in
                    let delta = (s.value(scan) ?? 0) - (s.value(first) ?? 0)
                    AreaMark(x: .value("Fecha", scan.date), yStart: .value("Base", 0), yEnd: .value("Cambio", delta), series: .value("Serie", s.name))
                        .foregroundStyle(LinearGradient(colors: [s.color.opacity(0.16), s.color.opacity(0.0)], startPoint: delta >= 0 ? .top : .bottom, endPoint: delta >= 0 ? .bottom : .top))
                        .interpolationMethod(.monotone)
                    LineMark(x: .value("Fecha", scan.date), y: .value("Cambio", delta), series: .value("Serie", s.name))
                        .foregroundStyle(s.color)
                        .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round))
                        .interpolationMethod(.monotone)
                }
                PointMark(x: .value("Fecha", shown.date), y: .value("Cambio", (s.value(shown) ?? 0) - (s.value(first) ?? 0)))
                    .foregroundStyle(s.color)
                    .symbolSize(60)
            }
            RuleMark(y: .value("Cero", 0))
                .foregroundStyle(.secondary.opacity(0.4))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
            if selected != nil {
                RuleMark(x: .value("Fecha", shown.date)).foregroundStyle(.secondary.opacity(0.5))
            }
        }
        .chartXSelection(value: $selected)
        .chartXAxis { AxisMarks(values: .automatic(desiredCount: 3)) { AxisValueLabel(format: .dateTime.day().month()) } }
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { value in
                AxisValueLabel { if let kg = value.as(Double.self) { Text(signed(kg)) } }
            }
        }
        .sensoryFeedback(.selection, trigger: shown.id)
        .accessibilityLabel("Cambio desde el primer escaneo: " + series.map { "\($0.name) \(signed(($0.value(points.last!) ?? 0) - ($0.value(first) ?? 0))) kg" }.joined(separator: ", "))
    }

    private func signed(_ value: Double) -> String {
        (value > 0.05 ? "+" : value < -0.05 ? "−" : "±") + abs(value).decimal()
    }
}

// MARK: - Previews

let previewAnalysis: BodyAnalysis = {
    func gauge(_ metric: String, _ value: Double, _ previous: Double?, _ unit: String, _ normal: (Double, Double), _ band: BodyBand, _ percent: Double?, _ at: (Double, Double?, Double, Double), _ ticks: [String]) -> BodyGauge {
        BodyGauge(metric: metric, measuredAt: 1_790_838_000_000, value: value, previous: previous, unit: unit, normal: .init(low: normal.0, high: normal.1), band: band, percent: percent, at: .init(value: at.0, previous: at.1, low: at.2, high: at.3), ticks: ticks)
    }
    let pct = ["55", "70", "85", "100", "115", "130", "145", "160", "175", "190", "205"]
    let seg = { (kg: Double, pct: Double?, band: BodyBand?) in SegmentValue(kg: kg, percent: pct, band: band) }
    return BodyAnalysis(
        basis: .init(heightCm: 180, heightFrom: "profile", sex: "male", standardWeight: 71.3),
        muscleFat: .init(measuredAt: 1_790_838_000_000, gauges: [
            gauge("weight", 82.6, 83.4, "kg", (60.6, 82), .high, 116, (0.41, 0.42, 0.2, 0.4), pct),
            gauge("skeletalMuscleMass", 36.1, 35.8, "kg", (30.5, 37.3), .normal, 106, (0.36, 0.34, 0.2, 0.4), ["70", "80", "90", "100", "110", "120", "130", "140", "150", "160", "170"]),
            gauge("bodyFatMass", 16.7, 17.6, "kg", (8.6, 17.1), .normal, 156, (0.39, 0.4, 0.2, 0.4), ["40", "60", "80", "100", "160", "220", "280", "340", "400", "460", "520"]),
        ]),
        obesity: [
            gauge("bmi", 25.5, 25.7, "kg/m²", (18.5, 25), .high, nil, (0.41, 0.42, 0.2, 0.4), ["10", "15", "18,5", "21", "25", "30", "35", "40", "45", "50", "55"]),
            gauge("percentBodyFat", 20.2, 21.1, "%", (10, 20), .high, nil, (0.4, 0.42, 0.2, 0.4), ["0", "5", "10", "15", "20", "25", "30", "35", "40", "45", "50"]),
            gauge("visceralFatLevel", 8, 9, "nivel", (1, 9), .normal, nil, (0.39, 0.44, 0, 0.44), ["1", "5", "10", "15", "20"]),
        ],
        segments: .init(
            measuredAt: 1_790_838_000_000, basis: "height",
            lean: SegmentValues(rightArm: seg(3.9, 117, .high), leftArm: seg(3.8, 114, .high), trunk: seg(29.9, 117, .high), rightLeg: seg(9.9, 109, .normal), leftLeg: seg(9.7, 107, .normal)),
            fat: SegmentValues(rightArm: seg(1.1, 171, .high), leftArm: seg(1.2, 187, .high), trunk: seg(8.8, 171, .high), rightLeg: seg(2.7, 149, .normal), leftLeg: seg(2.7, 149, .normal)),
            balance: [.init(text: "Brazos equilibrados", even: true), .init(text: "Pierna izq. 6 % menos", even: false)]
        )
    )
}()

#Preview("Análisis · 375 pt · XXL") {
    let scans = (0..<5).map { i in
        BodyScan(id: "\(i)", measuredAt: 1_790_838_000_000 - Double(i) * 30 * 86_400_000, source: "inbody", device: "570",
                 weight: 82.6 + Double(i) * 0.9, skeletalMuscleMass: 36.1 - Double(i) * 0.35, bodyFatMass: 16.7 + Double(i) * 1.1)
    }
    return NarrowPreview(dynamicType: .xxLarge) {
        SegmentFigureCard(segments: previewAnalysis.segments!)
        MuscleFatCard(analysis: previewAnalysis)
        ObesityCard(gauges: previewAnalysis.obesity)
        BodyEvolutionCard(scans: scans)
    }
}

#Preview("Análisis · claro") {
    NarrowPreview {
        SegmentFigureCard(segments: previewAnalysis.segments!)
        MuscleFatCard(analysis: BodyAnalysis(basis: nil, muscleFat: nil, obesity: [], segments: nil))
    }
    .preferredColorScheme(.light)
}
