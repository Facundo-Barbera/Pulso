import SwiftUI

/// A Monday-first week that swipes by week, with a dot per kind of thing under
/// each day. Two uses:
/// - `CalendarWeekStrip(model:)`: a card for Hoy; tapping a day opens the calendar there.
/// - `CalendarWeekStrip(model:selection:)`: the calendar's own day picker.
struct CalendarWeekStrip: View {
    let model: PulsoModel
    private let selection: Binding<Date>?
    @State private var store = CalendarStore.shared
    @State private var page = 0

    /// Weeks reachable by swiping, either side of this one.
    static let span = 52

    init(model: PulsoModel) {
        self.model = model
        selection = nil
    }

    init(model: PulsoModel, selection: Binding<Date>) {
        self.model = model
        self.selection = selection
    }

    var body: some View {
        if selection != nil {
            strip
        } else {
            Card {
                header
                strip
                upcoming
            }
            .task { await store.refresh() }
        }
    }

    // MARK: Strip

    private var strip: some View {
        TabView(selection: $page) {
            ForEach(-Self.span...Self.span, id: \.self) { offset in
                week(CalendarMath.week(of: Calendar.current.date(byAdding: .weekOfYear, value: offset, to: .now)!))
                    .tag(offset)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .frame(height: 74)
        .task(id: page) {
            let start = CalendarMath.weekStart(Calendar.current.date(byAdding: .weekOfYear, value: page, to: .now)!)
            await store.ensure(from: Calendar.current.date(byAdding: .day, value: -7, to: start)!, to: Calendar.current.date(byAdding: .day, value: 13, to: start)!)
        }
        .onChange(of: page) { old, new in
            // Swiping keeps the same weekday selected in the new week.
            guard let selection, CalendarMath.weeksBetween(.now, selection.wrappedValue) != new else { return }
            selection.wrappedValue = Calendar.current.date(byAdding: .weekOfYear, value: new - old, to: selection.wrappedValue)!
        }
        .onChange(of: selection?.wrappedValue, initial: true) { _, day in
            guard let day else { return }
            let target = CalendarMath.weeksBetween(.now, day)
            if target != page, abs(target) <= Self.span { withAnimation(.snappy) { page = target } }
        }
        .sensoryFeedback(.selection, trigger: page)
    }

    private func week(_ days: [Date]) -> some View {
        HStack(spacing: 0) {
            ForEach(days, id: \.self) { day in
                if let selection {
                    Button {
                        withAnimation(.snappy) { selection.wrappedValue = day }
                    } label: {
                        DayCell(day: day, selected: Calendar.current.isDate(day, inSameDayAs: selection.wrappedValue), dots: store.dots(on: day))
                    }
                    .buttonStyle(.plain)
                } else {
                    NavigationLink {
                        CalendarView(model: model, initialDate: day)
                    } label: {
                        DayCell(day: day, selected: false, dots: store.dots(on: day))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: Card (Hoy)

    private var header: some View {
        HStack {
            CardTitle(text: "Esta semana", systemImage: "calendar")
            Spacer()
            NavigationLink {
                CalendarView(model: model)
            } label: {
                HStack(spacing: 2) {
                    Text("Calendario")
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                }
                .font(.subheadline.weight(.medium))
            }
        }
    }

    /// Active health events and the next planned session: what the week needs to respect.
    @ViewBuilder private var upcoming: some View {
        let next = nextTraining
        if !store.activeHealth.isEmpty || next != nil {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(store.activeHealth.prefix(2)) { event in
                    Label {
                        Text(event.title) + Text(" · \(event.status.label.lowercased())").foregroundStyle(.secondary)
                    } icon: {
                        Image(systemName: event.kind.symbol).foregroundStyle(Theme.protein)
                    }
                    .lineLimit(1)
                }
                if let next {
                    Label {
                        Text("Próximo entreno: ").foregroundStyle(.secondary) + Text(next.title).fontWeight(.semibold) + Text(" · \(Self.when(next))").foregroundStyle(.secondary)
                    } icon: {
                        Image(systemName: next.hasConflict ? "exclamationmark.triangle.fill" : "dumbbell.fill")
                            .foregroundStyle(next.hasConflict ? .orange : Theme.training)
                    }
                    .lineLimit(1)
                }
            }
            .font(.subheadline)
        }
    }

    private var nextTraining: CalendarItem? {
        let now = LocalClock.date(.now) + "T" + LocalClock.time(.now)
        return CalendarMath.days(from: .now, count: 8)
            .flatMap { store.items(on: $0) }
            .first { $0.kind == .training && ["planned", "moved"].contains($0.status) && ($0.start ?? "") >= now }
    }

    /// "hoy 18:00", "jue 18:00".
    static func when(_ item: CalendarItem) -> String {
        guard let start = item.start, let date = CalendarMath.parse(start) else { return "" }
        let day = Calendar.current.isDateInToday(date) ? "hoy" : Calendar.current.isDateInTomorrow(date) ? "mañana" : date.formatted(.dateTime.weekday(.abbreviated))
        return "\(day) \(date.formatted(date: .omitted, time: .shortened))"
    }
}

/// Weekday letter, day number (filled when selected, ringed when today) and kind dots.
private struct DayCell: View {
    let day: Date
    let selected: Bool
    let dots: [String]

    private var today: Bool { Calendar.current.isDateInToday(day) }

    var body: some View {
        VStack(spacing: 6) {
            Text(day.formatted(.dateTime.weekday(.narrow)).uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(today ? Color.accentColor : .secondary)
            Text(day.formatted(.dateTime.day()))
                .font(.callout.weight(selected || today ? .bold : .medium))
                .fontDesign(.rounded)
                .foregroundStyle(selected ? Color.white : .primary)
                .frame(width: 36, height: 36)
                .background {
                    if selected {
                        Circle().fill(Color.accentColor.gradient)
                    } else if today {
                        Circle().strokeBorder(Color.accentColor, lineWidth: 1.5)
                    }
                }
            HStack(spacing: 3) {
                ForEach(dots.prefix(4), id: \.self) { Circle().fill(CalendarStyle.tint($0)).frame(width: 5, height: 5) }
            }
            .frame(height: 5)
        }
        .frame(maxWidth: .infinity)
        .contentShape(.rect)
        .animation(.snappy, value: selected)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(day.formatted(date: .complete, time: .omitted))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
