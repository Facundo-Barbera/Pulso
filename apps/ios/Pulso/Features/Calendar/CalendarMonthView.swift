import SwiftUI

/// A month grid: busier days glow stronger, dots say what kind of day it was.
/// Swipe or use the arrows to change month.
struct CalendarMonthView: View {
    @Binding var selection: Date
    let store: CalendarStore
    @State private var month: Date

    init(selection: Binding<Date>, store: CalendarStore) {
        _selection = selection
        self.store = store
        _month = State(initialValue: selection.wrappedValue)
    }

    private var grid: [Date] { CalendarMath.monthGrid(month) }

    var body: some View {
        VStack(spacing: 12) {
            header
            HStack(spacing: 0) {
                ForEach(CalendarMath.week(of: .now), id: \.self) { day in
                    Text(day.formatted(.dateTime.weekday(.narrow)).uppercased())
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                }
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 7), spacing: 4) {
                ForEach(grid, id: \.self) { day in
                    Button {
                        withAnimation(.snappy) { selection = day }
                    } label: {
                        MonthCell(
                            day: day,
                            inMonth: Calendar.current.isDate(day, equalTo: month, toGranularity: .month),
                            selected: Calendar.current.isDate(day, inSameDayAs: selection),
                            count: store.items(on: day).count { $0.kind != .meal_time },
                            dots: store.dots(on: day)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .contentShape(.rect)
        .gesture(
            DragGesture(minimumDistance: 30).onEnded { value in
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                shift(value.translation.width < 0 ? 1 : -1)
            }
        )
        .task(id: LocalClock.date(month)) {
            guard let first = grid.first, let last = grid.last else { return }
            await store.ensure(from: first, to: last)
        }
        .onChange(of: selection) { _, day in
            if !Calendar.current.isDate(day, equalTo: month, toGranularity: .month) { withAnimation(.snappy) { month = day } }
        }
        .sensoryFeedback(.selection, trigger: LocalClock.date(month))
    }

    private var header: some View {
        HStack {
            Text(month.formatted(.dateTime.month(.wide).year()).capitalized)
                .font(.title3.weight(.bold))
                .fontDesign(.rounded)
                .contentTransition(.numericText())
            Spacer()
            Button("Mes anterior", systemImage: "chevron.left") { shift(-1) }
                .labelStyle(.iconOnly)
                .buttonStyle(.glass)
            Button("Mes siguiente", systemImage: "chevron.right") { shift(1) }
                .labelStyle(.iconOnly)
                .buttonStyle(.glass)
        }
    }

    private func shift(_ months: Int) {
        withAnimation(.snappy) { month = Calendar.current.date(byAdding: .month, value: months, to: month)! }
    }
}

private struct MonthCell: View {
    let day: Date
    let inMonth: Bool
    let selected: Bool
    let count: Int
    let dots: [String]

    var body: some View {
        VStack(spacing: 4) {
            Text(day.formatted(.dateTime.day()))
                .font(.callout.weight(Calendar.current.isDateInToday(day) ? .bold : .medium))
                .fontDesign(.rounded)
                .foregroundStyle(Calendar.current.isDateInToday(day) ? Color.accentColor : .primary)
            HStack(spacing: 2) {
                ForEach(dots.prefix(3), id: \.self) { Circle().fill(CalendarStyle.tint($0)).frame(width: 4, height: 4) }
            }
            .frame(height: 4)
        }
        .frame(maxWidth: .infinity, minHeight: 46)
        .background {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.accentColor.opacity(count == 0 ? 0 : 0.06 + 0.05 * Double(min(count, 6))))
        }
        .overlay {
            if selected { RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.accentColor, lineWidth: 2) }
        }
        .opacity(inMonth ? 1 : 0.35)
        .contentShape(.rect)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(day.formatted(date: .complete, time: .omitted)), \(count) elementos")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
