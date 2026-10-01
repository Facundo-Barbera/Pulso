import SwiftUI

/// The calendar: a week strip and the selected day's timeline, a month view,
/// and "Salud" (injuries and illnesses, now and history). Items open where they
/// live; busy blocks and health events open their editor here.
struct CalendarView: View {
    let model: PulsoModel
    @State private var store = CalendarStore.shared
    @State private var selection: Date
    @State private var mode = Mode.week
    @State private var sheet: Sheet?
    @State private var appleCalendar = AppleCalendarBusy.enabled
    @Environment(\.askCoach) private var askCoach

    enum Mode: String, CaseIterable, Identifiable {
        case week = "Semana", month = "Mes", health = "Salud"
        var id: String { rawValue }
    }

    private enum Sheet: Identifiable {
        case newBusy(Date), busy(BusyBlock), newHealth, health(HealthEvent)
        var id: String {
            switch self {
            case .newBusy: "new-busy"
            case let .busy(block): "busy-\(block.id)"
            case .newHealth: "new-health"
            case let .health(event): "health-\(event.id)"
            }
        }
    }

    init(model: PulsoModel, initialDate: Date = .now) {
        self.model = model
        _selection = State(initialValue: initialDate)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                Picker("Vista", selection: $mode.animation(.snappy)) {
                    ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                if let replan = store.lastReplan { ReplanCard(replan: replan, askCoach: { askCoach($0) }) { store.lastReplan = nil } }
                switch mode {
                case .week: week
                case .month: month
                case .health:
                    HealthEventsSection(store: store, onEdit: { sheet = .health($0) }, onAdd: { sheet = .newHealth })
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 32)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Calendario")
        .toolbar { toolbar }
        .task {
            await store.refresh(around: selection)
            await store.syncAppleCalendar()
        }
        .refreshable {
            await store.syncAppleCalendar()
            await store.refresh(around: selection)
        }
        .sheet(item: $sheet) { sheet in
            switch sheet {
            case let .newBusy(date): BusyBlockEditor(store: store, block: nil, date: date)
            case let .busy(block): BusyBlockEditor(store: store, block: block)
            case .newHealth: HealthEventEditor(store: store, event: nil)
            case let .health(event): HealthEventEditor(store: store, event: event)
            }
        }
        .animation(.snappy, value: store.lastReplan)
        .sensoryFeedback(.selection, trigger: mode)
    }

    // MARK: Modes

    private var week: some View {
        VStack(spacing: 16) {
            Card { CalendarWeekStrip(model: model, selection: $selection) }
            Card {
                dayHeader
                DayAgenda(day: selection, items: store.items(on: selection), onSelect: open) { sheet = .newBusy(selection) }
            }
        }
    }

    private var month: some View {
        VStack(spacing: 16) {
            Card { CalendarMonthView(selection: $selection, store: store) }
            Card {
                dayHeader
                let items = store.items(on: selection)
                if items.isEmpty {
                    Text("Nada este día.").font(.subheadline).foregroundStyle(.secondary)
                } else {
                    ForEach(items) { item in
                        Button { open(item) } label: { AgendaRow(item: item) }
                            .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var dayHeader: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(selection.formatted(.dateTime.weekday(.wide).day().month(.wide)).capitalizedFirst)
                .font(.title3.weight(.bold))
                .fontDesign(.rounded)
                .contentTransition(.numericText())
                .animation(.snappy, value: LocalClock.date(selection))
            Spacer()
            if !Calendar.current.isDateInToday(selection) {
                Button("Hoy") { withAnimation(.snappy) { selection = .now } }
                    .font(.subheadline.weight(.semibold))
                    .buttonStyle(.glass)
            }
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Button("Marcar ocupado", systemImage: "briefcase") { sheet = .newBusy(selection) }
                Button("Lesión o enfermedad", systemImage: "cross.case") { sheet = .newHealth }
                Divider()
                Button("Planificar con el Coach", systemImage: "sparkles") {
                    askCoach("Planifica mi semana de entrenamiento y las horas de comida según mi calendario.")
                }
                Toggle(isOn: Binding(get: { appleCalendar }, set: { on in
                    Task { appleCalendar = await store.setAppleCalendar(on) && on }
                })) {
                    Label("Leer Calendario de Apple", systemImage: "calendar")
                }
            } label: {
                Image(systemName: "plus")
            }
            .buttonStyle(.glassProminent)
            .accessibilityLabel("Añadir")
        }
    }

    /// Busy blocks and health events edit here; everything else opens its tab.
    private func open(_ item: CalendarItem) {
        switch item.kind {
        case .busy:
            if let block = store.busyBlock(id: item.link.id) { sheet = .busy(block) }
        case .health:
            if let event = store.healthEvent(id: item.link.id) { sheet = .health(event) }
        default:
            CoachLauncher.shared.show(tab: item.link.tab)
        }
    }
}

/// What the last change did to planned training: what moved, and what still clashes.
private struct ReplanCard: View {
    let replan: Replan
    let askCoach: (String) -> Void
    let dismiss: () -> Void

    var body: some View {
        Card {
            HStack {
                CardTitle(text: "Entreno reorganizado", systemImage: "arrow.triangle.2.circlepath")
                Spacer()
                Button("Cerrar", systemImage: "xmark", action: dismiss)
                    .labelStyle(.iconOnly)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            ForEach(replan.moved, id: \.id) { move in
                Label {
                    Text(move.name).fontWeight(.semibold) + Text(" → \(Self.day(move.to)) \(move.time)").foregroundStyle(.secondary)
                } icon: {
                    Image(systemName: "arrow.right.circle.fill").foregroundStyle(Theme.training)
                }
                .font(.subheadline)
            }
            ForEach(replan.unresolved, id: \.id) { item in
                Label {
                    Text("\(item.name) (\(Self.day(item.date))): ").fontWeight(.semibold) + Text(item.conflict).foregroundStyle(.secondary)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                }
                .font(.subheadline)
            }
            if !replan.unresolved.isEmpty {
                Button("Resolver con el Coach", systemImage: "sparkles") {
                    askCoach("Algunas sesiones de mi calendario chocan con lo que tengo esta semana. ¿Cómo las reorganizo?")
                }
                .buttonStyle(.glassProminent)
            }
        }
        .transition(.move(edge: .top).combined(with: .opacity))
        .sensoryFeedback(.success, trigger: replan)
    }

    static func day(_ date: String) -> String {
        LocalClock.day(date)?.formatted(.dateTime.weekday(.abbreviated).day()) ?? date
    }
}

private extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

#Preview("Calendario · 375 pt") {
    NavigationStack { CalendarView(model: .shared) }
        .frame(width: 375)
}
