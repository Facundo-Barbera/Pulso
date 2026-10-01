import SwiftUI

/// One day: all-day things as banners (busy days hatched), then a timeline of
/// hours with sessions, meals, doses, sleep and busy blocks side by side when
/// they overlap.
struct DayAgenda: View {
    let day: Date
    let items: [CalendarItem]
    var onSelect: (CalendarItem) -> Void
    var onAddBusy: () -> Void

    private static let hourHeight: CGFloat = 54
    private static let gutter: CGFloat = 44

    private var key: String { LocalClock.date(day) }
    private var allDay: [CalendarItem] { items.filter(\.allDay) }
    private var timed: [(item: CalendarItem, span: (start: Int, end: Int))] {
        items.compactMap { item in CalendarMath.span(of: item, on: key).map { (item, $0) } }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(allDay) { item in
                Button { onSelect(item) } label: { AllDayBanner(item: item) }
                    .buttonStyle(.plain)
            }
            if timed.isEmpty {
                if allDay.isEmpty {
                    EmptyStateView(
                        systemImage: "calendar.badge.checkmark", title: "Día libre", message: "Nada planificado ni registrado.",
                        tint: Theme.training, actionTitle: "Marcar ocupado", action: onAddBusy
                    )
                }
            } else {
                timeline
            }
        }
    }

    // MARK: Timeline

    private var hours: ClosedRange<Int> {
        let spans = timed.map(\.span)
        let first = min(7, (spans.map(\.start).min() ?? 7 * 60) / 60)
        let last = max(22, Int((Double(spans.map(\.end).max() ?? 0) / 60).rounded(.up)))
        return first...min(24, last)
    }

    private func y(_ minute: Int) -> CGFloat {
        CGFloat(minute - hours.lowerBound * 60) / 60 * Self.hourHeight
    }

    private var timeline: some View {
        let entries = timed
        let layout = CalendarMath.columns(entries.map(\.span))
        let height = CGFloat(hours.count - 1) * Self.hourHeight
        return GeometryReader { geo in
            let width = geo.size.width - Self.gutter
            ZStack(alignment: .topLeading) {
                ForEach(Array(hours), id: \.self) { hour in
                    HStack(alignment: .center, spacing: 6) {
                        Text(hour == 24 ? "" : String(format: "%02d", hour))
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.tertiary)
                            .frame(width: Self.gutter - 8, alignment: .trailing)
                        Rectangle().fill(.quaternary).frame(height: 0.5)
                    }
                    .frame(height: 12)
                    .offset(y: y(hour * 60) - 6)
                }
                ForEach(Array(entries.enumerated()), id: \.element.item.id) { index, entry in
                    let slot = layout[index]
                    let columnWidth = width / CGFloat(slot.of)
                    Button { onSelect(entry.item) } label: {
                        TimelineBlock(item: entry.item, compact: y(entry.span.end) - y(entry.span.start) < 44)
                    }
                    .buttonStyle(.plain)
                    .frame(width: columnWidth - 3, height: max(24, y(entry.span.end) - y(entry.span.start) - 2))
                    .offset(x: Self.gutter + CGFloat(slot.column) * columnWidth, y: y(entry.span.start) + 1)
                }
                if Calendar.current.isDateInToday(day) {
                    NowLine()
                        .offset(x: Self.gutter - 4, y: y(CalendarMath.minute(LocalClock.date(.now) + "T" + LocalClock.time(.now), on: key)) - 4)
                }
            }
        }
        .frame(height: height)
        .padding(.vertical, 6)
    }
}

/// A block on the timeline: tinted fill with a leading bar; busy time is hatched grey.
private struct TimelineBlock: View {
    let item: CalendarItem
    let compact: Bool

    private var busy: Bool { item.kind == .busy }
    private var planned: Bool { item.kind == .meal_time || (item.kind == .training && ["planned", "moved"].contains(item.status)) }

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: item.hasConflict ? "exclamationmark.triangle.fill" : item.symbol)
                .font(.caption.weight(.semibold))
                .foregroundStyle(item.hasConflict ? .orange : item.tint)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text(item.title).font(.caption.weight(.semibold)).lineLimit(1)
                    if item.status == "done" { Image(systemName: "checkmark.circle.fill").font(.caption2).foregroundStyle(item.tint) }
                }
                if !compact, let detail = [item.statusLabel, item.subtitle].compactMap({ $0 }).joined(separator: " · ").nilIfEmpty {
                    Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, compact ? 3 : 6)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background {
            let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
            ZStack {
                shape.fill(item.tint.opacity(busy ? 0.10 : 0.16))
                if busy { Hatch().stroke(Color.secondary.opacity(0.25), lineWidth: 1).clipShape(shape) }
                if planned { shape.strokeBorder(item.tint.opacity(0.6), style: StrokeStyle(lineWidth: 1, dash: [4, 3])) }
            }
            .overlay(alignment: .leading) {
                Rectangle().fill(item.tint).frame(width: 3).clipShape(UnevenRoundedRectangle(topLeadingRadius: 8, bottomLeadingRadius: 8))
            }
        }
        .opacity(item.status == "skipped" || item.status == "missed" ? 0.5 : 1)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }
}

/// Diagonal lines, for busy time.
struct Hatch: Shape {
    var spacing: CGFloat = 7

    func path(in rect: CGRect) -> Path {
        var path = Path()
        var x = -rect.height
        while x < rect.width {
            path.move(to: CGPoint(x: x, y: rect.height))
            path.addLine(to: CGPoint(x: x + rect.height, y: 0))
            x += spacing
        }
        return path
    }
}

/// An all-day item: busy days hatched, health events tinted with their state.
private struct AllDayBanner: View {
    let item: CalendarItem

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: item.symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(item.tint)
                .frame(width: 28, height: 28)
                .background(item.tint.opacity(0.15), in: .circle)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(item.kind == .busy ? "Todo el día" : item.subtitle ?? "")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .padding(10)
        .background {
            let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
            ZStack {
                shape.fill(item.tint.opacity(0.10))
                if item.kind == .busy { Hatch().stroke(Color.secondary.opacity(0.22), lineWidth: 1).clipShape(shape) }
            }
        }
        .contentShape(.rect)
    }
}

private struct NowLine: View {
    var body: some View {
        HStack(spacing: 0) {
            Circle().fill(.red).frame(width: 8, height: 8)
            Rectangle().fill(.red).frame(height: 1.5)
        }
        .accessibilityHidden(true)
    }
}

/// A compact row for lists (the month view's selected day).
struct AgendaRow: View {
    let item: CalendarItem

    private var time: String {
        guard !item.allDay, let start = item.start, let date = CalendarMath.parse(start) else { return "Todo el día" }
        return date.formatted(date: .omitted, time: .shortened)
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: item.hasConflict ? "exclamationmark.triangle.fill" : item.symbol)
                .foregroundStyle(item.hasConflict ? .orange : item.tint)
                .frame(width: 30, height: 30)
                .background(item.tint.opacity(0.14), in: .circle)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                if let detail = [item.statusLabel, item.subtitle].compactMap({ $0 }).joined(separator: " · ").nilIfEmpty {
                    Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            Text(time).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
        .contentShape(.rect)
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
