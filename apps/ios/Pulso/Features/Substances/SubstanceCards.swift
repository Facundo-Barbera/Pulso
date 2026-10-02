import Charts
import SwiftUI

/// The hero: days in a row without use, and when the last one was.
struct SubstanceHero: View {
    let summary: SubstanceSummary

    var body: some View {
        let days = summary.daysWithout
        HeroCard(
            title: "Sin consumo",
            systemImage: "calendar.badge.clock",
            value: days.map(String.init) ?? "—",
            unit: days.map(SubstanceText.days) ?? nil,
            caption: summary.lastUse.map { "Último registro: \(SubstanceText.lastUse(date: $0.date, time: $0.time).lowercasedFirst)" },
            tint: SubstanceStyle.tint
        ) {
            if let drinks = summary.drinkDays, drinks > 0 {
                Label("Además, \(drinks) \(SubstanceText.days(drinks)) con bebidas anotadas en Dieta.", systemImage: "wineglass")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// Eight weeks as columns, weekdays as rows (Monday first); darker = more that day.
struct SubstanceHeatmapCard: View {
    let summary: SubstanceSummary
    @State private var selected: SubstanceDay?

    private static let weekdays = ["L", "M", "X", "J", "V", "S", "D"]

    var body: some View {
        let columns = SubstanceHeatmap.columns(summary.days)
        Card {
            HStack(alignment: .firstTextBaseline) {
                CardTitle(text: "Últimas 8 semanas", systemImage: "square.grid.3x3")
                Spacer(minLength: 8)
                Text(readout)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .contentTransition(.opacity)
            }
            Grid(horizontalSpacing: 5, verticalSpacing: 5) {
                ForEach(0..<7, id: \.self) { row in
                    GridRow {
                        Text(Self.weekdays[row])
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.tertiary)
                            .frame(width: 14)
                        ForEach(columns.indices, id: \.self) { column in
                            cell(columns[column][row])
                        }
                    }
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(usedDays) \(SubstanceText.days(usedDays)) con consumo en las últimas 8 semanas")
            HStack(spacing: 4) {
                Spacer()
                Text("Menos").font(.caption2).foregroundStyle(.tertiary)
                ForEach(0..<4, id: \.self) { level in
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(SubstanceStyle.tint.opacity(SubstanceHeatmap.opacity(level: level)))
                        .frame(width: 11, height: 11)
                }
                Text("Más").font(.caption2).foregroundStyle(.tertiary)
            }
            .accessibilityHidden(true)
        }
        .sensoryFeedback(.selection, trigger: selected)
        .animation(.snappy, value: selected)
    }

    private var usedDays: Int { summary.days.count { $0.uses > 0 } }

    private var readout: String {
        guard let selected else { return "\(usedDays) \(SubstanceText.days(usedDays)) con consumo" }
        let day = SubstanceText.dayTitle(selected.date)
        return selected.uses == 0 ? "\(day): sin consumo" : "\(day): \(selected.uses) \(selected.uses == 1 ? "registro" : "registros")"
    }

    @ViewBuilder private func cell(_ day: SubstanceDay?) -> some View {
        let shape = RoundedRectangle(cornerRadius: 4, style: .continuous)
        if let day {
            shape
                .fill(SubstanceStyle.tint.opacity(SubstanceHeatmap.opacity(level: day.uses > 0 ? max(day.level, 1) : 0)))
                .overlay {
                    if day.date == summary.today || day == selected {
                        shape.strokeBorder(day == selected ? Color.primary : SubstanceStyle.tint, lineWidth: 1.5)
                    }
                }
                .aspectRatio(1, contentMode: .fit)
                .frame(maxWidth: .infinity)
                .contentShape(shape)
                .onTapGesture { selected = selected == day ? nil : day }
        } else {
            Color.clear.aspectRatio(1, contentMode: .fit).frame(maxWidth: .infinity)
        }
    }
}

/// Days with use per ISO week, this week lighter, with the person's own maximum as a dashed rule.
struct SubstanceWeeksCard: View {
    let summary: SubstanceSummary
    let goal: Int?
    @State private var selectedDate: Date?

    var body: some View {
        Card {
            HStack(alignment: .firstTextBaseline) {
                CardTitle(text: "Días por semana", systemImage: "chart.bar")
                Spacer(minLength: 8)
                Text(readout)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
            Chart {
                ForEach(summary.weeks) { week in
                    if let start = week.start {
                        let current = week.id == summary.weeks.last?.id
                        BarMark(x: .value("Semana", start, unit: .weekOfYear), y: .value("Días", week.days))
                            .foregroundStyle(
                                LinearGradient(
                                    colors: [SubstanceStyle.tint.opacity(current ? 0.5 : 0.9), SubstanceStyle.tint.opacity(current ? 0.15 : 0.3)],
                                    startPoint: .top, endPoint: .bottom
                                )
                            )
                            .cornerRadius(5)
                            .opacity(selected == nil || selected?.id == week.id ? 1 : 0.45)
                    }
                }
                if let goal {
                    RuleMark(y: .value("Tu máximo", goal))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                        .foregroundStyle(.secondary)
                        .annotation(position: .top, alignment: .leading, spacing: 2) {
                            Text("Tu máximo").font(.caption2).foregroundStyle(.secondary)
                        }
                }
            }
            .chartYScale(domain: 0...7)
            .chartYAxis {
                AxisMarks(position: .leading, values: [0, 7]) { _ in AxisValueLabel() }
            }
            .chartXAxis {
                AxisMarks(values: .stride(by: .weekOfYear, count: 2)) { _ in
                    AxisValueLabel(format: .dateTime.day().month(.abbreviated), centered: true)
                }
            }
            .chartXSelection(value: $selectedDate)
            .frame(height: 150)
            .sensoryFeedback(.selection, trigger: selected?.id)
        }
    }

    private var selected: SubstanceWeek? {
        guard let selectedDate else { return nil }
        return summary.weeks.last { ($0.start ?? .distantFuture) <= selectedDate }
    }

    private var readout: String {
        if let week = selected, let start = week.start {
            return "Semana del \(start.formatted(.dateTime.day().month(.abbreviated))): \(week.days) \(SubstanceText.days(week.days))"
        }
        if let avg = summary.avgDaysPerWeek {
            return "Promedio \(avg.formatted(.number.precision(.fractionLength(0...1)))) por semana"
        }
        return "Esta semana: \(summary.daysThisWeek)"
    }
}

/// Uses split some way (time of day, form, substance) as soft horizontal bars.
struct SubstanceBarsCard: View {
    struct Row: Identifiable {
        var id: String
        var label: String
        /// An emoji or SF Symbol name, drawn like a substance's.
        var symbol: String?
        var uses: Int
    }

    let title: String
    let systemImage: String
    let rows: [Row]

    var body: some View {
        let top = max(rows.map(\.uses).max() ?? 1, 1)
        Card {
            CardTitle(text: title, systemImage: systemImage)
            VStack(spacing: 10) {
                ForEach(rows) { row in
                    HStack(spacing: 10) {
                        Label { Text(row.label) } icon: { SubstanceGlyphView(symbol: row.symbol) }
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .frame(width: 118, alignment: .leading)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        Capsule()
                            .fill(SubstanceStyle.tint.opacity(0.12))
                            .overlay(alignment: .leading) {
                                GeometryReader { proxy in
                                    Capsule()
                                        .fill(SubstanceStyle.tint.gradient)
                                        .frame(width: max(row.uses > 0 ? 8 : 0, proxy.size.width * Double(row.uses) / Double(top)))
                                }
                            }
                            .frame(height: 10)
                        Text("\(row.uses)")
                            .font(.subheadline.weight(.semibold))
                            .fontDesign(.rounded)
                            .monospacedDigit()
                            .contentTransition(.numericText(value: Double(row.uses)))
                            .frame(minWidth: 22, alignment: .trailing)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

/// Glass capsules for picking one item; the selected one takes the feature's tint.
/// With `clearable`, tapping the selected chip clears it.
struct SubstanceChips<Item: Hashable, Content: View>: View {
    let items: [Item]
    let selection: Item?
    var clearable = false
    var inset: CGFloat = 20
    let onSelect: (Item?) -> Void
    @ViewBuilder let label: (Item) -> Content

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    ForEach(items, id: \.self) { item in
                        let on = selection == item
                        Button {
                            withAnimation(.snappy) { onSelect(on && clearable ? nil : item) }
                        } label: {
                            label(item)
                                .font(.subheadline.weight(on ? .semibold : .regular))
                                .foregroundStyle(on ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
                                .lineLimit(1)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                        }
                        .buttonStyle(.plain)
                        .glassEffect(on ? .regular.tint(SubstanceStyle.tint).interactive() : .regular.interactive(), in: .capsule)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
                .padding(.horizontal, inset)
            }
        }
        .scrollClipDisabled()
    }
}

/// A substance's symbol and name, for chips and rows.
struct SubstanceLabel: View {
    let substance: Substance

    var body: some View {
        Label { Text(substance.name) } icon: { SubstanceGlyphView(symbol: substance.symbol) }
    }
}

/// Soft comparisons the engine makes between nights with and without use.
struct SubstanceCorrelationsCard: View {
    let correlations: [SubstanceCorrelation]

    var body: some View {
        let ready = correlations.filter { $0.enough && $0.text != nil }
        let waiting = correlations.filter { !$0.enough || $0.text == nil }
        Card {
            CardTitle(text: "Tu sueño y recuperación", systemImage: "bed.double")
            if ready.isEmpty, let first = waiting.first {
                quiet("Hacen falta más noches para comparar (\(first.nWith) con · \(first.nWithout) sin).")
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(ready) { item in
                        Label {
                            Text(item.text ?? "").font(.subheadline)
                        } icon: {
                            Image(systemName: item.symbol).foregroundStyle(SubstanceStyle.tint)
                        }
                    }
                }
                ForEach(waiting) { item in
                    quiet("\(item.label): hacen falta más noches para comparar (\(item.nWith) con · \(item.nWithout) sin).")
                }
            }
            Text("Son comparaciones entre tus noches, no causas.")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }

    private func quiet(_ text: String) -> some View {
        Text(text).font(.footnote).foregroundStyle(.secondary)
    }
}

/// The person's own weekly maximum, if they want one. Never suggested, never colored as a verdict.
struct SubstanceGoalCard: View {
    let maxDays: Int?
    let daysThisWeek: Int
    let onChange: (Int?) async -> Void
    @State private var value = 3
    @State private var saving: Task<Void, Never>?

    var body: some View {
        Card {
            CardTitle(text: "Tu máximo", systemImage: "slider.horizontal.3")
            if let maxDays {
                Stepper(value: $value, in: 0...7) {
                    Text("Máximo \(value) \(SubstanceText.days(value)) por semana")
                        .contentTransition(.numericText(value: Double(value)))
                }
                .onChange(of: value) { _, new in save(new, after: .milliseconds(700)) }
                HStack(spacing: 10) {
                    Text("Esta semana: \(daysThisWeek) de \(maxDays)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .contentTransition(.numericText(value: Double(daysThisWeek)))
                    Spacer(minLength: 8)
                    dots(max: maxDays)
                }
                Button("Quitar el máximo") { save(nil) }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .buttonStyle(.borderless)
            } else {
                Text("Opcional: un máximo de días por semana que eliges tú. Solo sirve de referencia.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("Elegir un máximo", systemImage: "plus") { save(value) }
                    .buttonStyle(.glass)
            }
        }
        .onAppear { value = maxDays ?? 3 }
        .onChange(of: maxDays) { _, new in if let new, saving == nil { value = new } }
        .animation(.snappy, value: maxDays)
    }

    /// Days used this week as filled dots; past the maximum they simply keep going.
    private func dots(max: Int) -> some View {
        HStack(spacing: 4) {
            ForEach(0..<Swift.max(max, daysThisWeek), id: \.self) { i in
                Circle()
                    .fill(i < daysThisWeek ? AnyShapeStyle(SubstanceStyle.tint) : AnyShapeStyle(SubstanceStyle.tint.opacity(0.15)))
                    .frame(width: 8, height: 8)
            }
        }
        .accessibilityHidden(true)
    }

    /// Debounced so stepping 2 → 5 is one request. Once the wait is over the task is
    /// let go, so a newer step can't cancel a request mid-flight.
    private func save(_ max: Int?, after delay: Duration = .zero) {
        guard max != maxDays else { return }
        saving?.cancel()
        saving = Task {
            if delay > .zero { try? await Task.sleep(for: delay) }
            guard !Task.isCancelled else { return }
            saving = nil
            await onChange(max)
        }
    }
}

private extension String {
    /// "Hoy, 21:30" → "hoy, 21:30" mid-sentence.
    var lowercasedFirst: String { prefix(1).lowercased() + dropFirst() }
}
