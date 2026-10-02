import SwiftUI

/// One entry of today's timeline: every active medication once per dose, with
/// how it stands today. Mirrors the web's `todayItems` (src/web/medication.ts).
struct TodayItem: Identifiable, Equatable {
    enum State: Equatable {
        /// `ahora`: due within the last hour (or a workout's window is open); `atrasada`: longer ago;
        /// `entreno`: waiting for a workout; `dia`: due today at any time; `noToca`: scheduled, not today; `aDemanda`: as-needed.
        case tomada, omitida, ahora, atrasada, pendiente, entreno, dia, aDemanda, noToca
    }

    var id: String
    var medication: Medication
    var state: State
    /// "HH:mm" it sits at: when taken, else when due; nil with no time today.
    var at: String?
    /// When it is due: "A las 9:00", "Con la comida · 14:00", "Después de entrenar", "Cuando haga falta".
    var when: String
    /// How it stands: "Tomada a las 9:56", "Toca ahora", "Se pasó hace 2 h", "próxima: dom 4 oct"…
    var line: String
    /// The slot to log against; nil for as-needed, extra intakes and days off.
    var slot: DoseSlot?
    /// Intakes logged today outside a slot, newest first.
    var intakes: [DoseEvent] = []

    /// Still to take today.
    var isLeft: Bool { [.ahora, .atrasada, .pendiente, .entreno, .dia].contains(state) }

    /// What an any-time dose says until it is taken.
    static let anyTimeLine = "Hoy toca · cuando quieras"
    var isTaken: Bool { state == .tomada || (state == .aDemanda && !intakes.isEmpty) }

    static let dueNowMinutes = 60

    /// Today, in order: timed items by the clock (taken ones when taken), then what waits for
    /// a workout or is due any time today, the as-needed meds not taken yet and what isn't due today. `history` is the
    /// store's logged doses, newest first.
    static func build(medications: [Medication], day: MedicationDay?, history: [DoseEvent], now: Date = .now, calendar: Calendar = .current) -> [TodayItem] {
        let date = LocalClock.date(now)
        let time = LocalClock.time(now)
        let slots = day?.date == date ? day?.slots ?? [] : []
        let slotted = Set(slots.map { "\($0.medicationId)|\($0.slot)" })
        // Taken today but not on one of today's slots: as-needed intakes, or extras.
        func isLoose(_ event: DoseEvent) -> Bool {
            guard event.date == date, event.status == .tomada else { return false }
            guard let key = event.scheduledTime else { return true }
            return !slotted.contains("\(event.medicationId)|\(key)")
        }
        let loose = history.filter(isLoose).sorted { ($0.takenAt ?? 0) > ($1.takenAt ?? 0) }

        var items: [TodayItem] = []
        for med in medications where med.active {
            let intakes = loose.filter { $0.medicationId == med.id }
            let at = intakes.first?.takenAt.map(clock)
            if med.schedule.asNeeded {
                let line: String
                if let at {
                    line = intakes.count == 1 ? "Tomada a las \(LocalClock.display(at))" : "\(intakes.count) hoy · última a las \(LocalClock.display(at))"
                } else if let last = history.first(where: { $0.medicationId == med.id && $0.status == .tomada })?.date {
                    line = "Última \(lastLabel(last, today: date, calendar: calendar))"
                } else {
                    line = "Ninguna hoy"
                }
                items.append(TodayItem(id: med.id, medication: med, state: .aDemanda, at: at, when: "Cuando haga falta", line: line, intakes: intakes))
                continue
            }
            let own = slots.filter { $0.medicationId == med.id }
            for slot in own {
                let (state, line) = status(of: slot, now: time)
                items.append(TodayItem(id: slot.id, medication: med, state: state, at: slot.takenAt.map(clock) ?? slot.time, when: when(slot), line: line, slot: slot))
            }
            for intake in intakes {
                let at = clock(intake.takenAt ?? 0)
                items.append(TodayItem(id: intake.id, medication: med, state: .tomada, at: at, when: "Fuera de horario", line: "Tomada a las \(LocalClock.display(at))", intakes: [intake]))
            }
            if own.isEmpty && intakes.isEmpty && !(med.endDate.map { date > $0 } ?? false) {
                items.append(TodayItem(id: med.id, medication: med, state: .noToca, at: nil, when: offWhen(med.schedule), line: offLine(med, date: date, calendar: calendar)))
            }
        }
        func rank(_ item: TodayItem) -> Int {
            switch item.state {
            case .aDemanda: item.at == nil ? 2 : 0
            case .entreno, .dia: 1
            case .noToca: 3
            default: 0
            }
        }
        return items.sorted { (rank($0), $0.at ?? "99", $0.medication.name) < (rank($1), $1.at ?? "99", $1.medication.name) }
    }

    private static func clock(_ ms: Double) -> String { LocalClock.time(Date(timeIntervalSince1970: ms / 1000)) }
    private static func minutes(_ time: String) -> Int { (Int(time.prefix(2)) ?? 0) * 60 + (Int(time.suffix(2)) ?? 0) }

    /// "35 min", "1 h 20 min", "3 h".
    static func gap(_ minutes: Int) -> String {
        if minutes < 60 { return "\(minutes) min" }
        if minutes % 60 == 0 || minutes >= 180 { return "\(Int((Double(minutes) / 60).rounded())) h" }
        return "\(minutes / 60) h \(minutes % 60) min"
    }

    private static func when(_ slot: DoseSlot) -> String {
        switch slot.moment {
        case .hora: return "A las \(LocalClock.display(slot.slot))"
        case .dia: return "Cualquier hora"
        case .manana, .tarde, .noche: return slot.window.map { "\(slot.moment.title) · \($0.range)" } ?? slot.moment.title
        case .entreno: return slot.training?.state == .rest ? (slot.time.map { "Hoy descansas · \(LocalClock.display($0))" } ?? "Hoy descansas") : DoseMoment.entreno.title
        default: return slot.time.map { "\(slot.moment.title) · \(LocalClock.display($0))" } ?? slot.moment.title
        }
    }

    private static func status(of slot: DoseSlot, now: String) -> (State, String) {
        switch slot.status {
        case .tomada: return (.tomada, slot.takenAt.map { "Tomada a las \(LocalClock.display(clock($0)))" } ?? "Tomada")
        case .omitida: return (.omitida, "Omitida")
        case .pendiente, .pospuesta: break
        }
        if slot.moment == .dia { return (.dia, slot.status == .pospuesta ? "Pospuesta · hoy, cuando quieras" : anyTimeLine) }
        if let window = slot.window {
            if now < window.start { return (.pendiente, slot.status == .pospuesta ? "Pospuesta" : "Desde las \(LocalClock.display(window.start))") }
            return now <= window.end
                ? (.ahora, "Cuando quieras hasta las \(LocalClock.display(window.end))")
                : (.atrasada, "Era \(slot.moment.title.lowercased()) · aún estás a tiempo hoy")
        }
        guard let time = slot.time else { return (.entreno, slot.training?.status ?? "Esperando el entreno") }
        if let training = slot.training, training.state == .trained, let until = training.until {
            return (now <= until ? .ahora : .atrasada, training.status)
        }
        if time > now { return (.pendiente, slot.status == .pospuesta ? "Pospuesta" : "En \(gap(minutes(time) - minutes(now)))") }
        let late = minutes(now) - minutes(time)
        return late <= dueNowMinutes ? (.ahora, "Toca ahora") : (.atrasada, "Se pasó hace \(gap(late))")
    }

    /// When a med is due, read on a day it isn't: "Jueves · cualquier hora", "Después de entrenar", "Cada 3 días · 8:00".
    private static func offWhen(_ schedule: MedicationSchedule) -> String {
        let weekly = schedule.days.count == 1 && schedule.interval == nil && schedule.monthDay == nil
        let frequency = weekly ? WeekdayNames.long(schedule.days[0]) : schedule.frequencyLine
        let text = [frequency, schedule.summary.isEmpty ? nil : schedule.summary].compactMap { $0 }.joined(separator: " · ")
        return text.prefix(1).uppercased() + text.dropFirst()
    }

    /// Why not today, to follow `offWhen`: "hoy es descanso", "próxima: mañana", "próxima: jue 8 oct".
    private static func offLine(_ med: Medication, date: String, calendar: Calendar) -> String {
        guard let today = LocalClock.day(date) else { return "hoy no toca" }
        if let start = LocalClock.day(med.startDate), start > today {
            return "empieza el \(start.formatted(.dateTime.day().month(.wide)))"
        }
        if !med.schedule.isDue(on: date) {
            // Monthly and every-N schedules can be weeks away; a year covers every frequency.
            let next = (1...366).lazy
                .compactMap { calendar.date(byAdding: .day, value: $0, to: today) }
                .first { day in med.schedule.isDue(on: LocalClock.date(day)) && !(med.endDate.map { LocalClock.date(day) > $0 } ?? false) }
            guard let next else { return "hoy no toca" }
            let offset = calendar.dateComponents([.day], from: today, to: next).day ?? 0
            return offset == 1 ? "próxima: mañana" : "próxima: \(shortDay(next))"
        }
        if let training = med.schedule.training, training.restDayTime == nil { return "hoy es descanso" }
        return "hoy no toca"
    }

    /// "jue 8 oct".
    static func shortDay(_ day: Date) -> String {
        "\(day.formatted(.dateTime.weekday(.abbreviated))) \(day.formatted(.dateTime.day().month(.abbreviated)))"
    }

    /// As-needed meds taken most days and not yet today, by name: the engine's daily
    /// suggestions, plus any taken on `usualDays` of the last seven.
    static let usualDays = 4
    static func usual(_ items: [TodayItem], nudges: [ScheduleNudge], history: [DoseEvent], now: Date = .now, calendar: Calendar = .current) -> [String] {
        let today = LocalClock.date(now)
        let weekAgo = LocalClock.date(calendar.date(byAdding: .day, value: -7, to: now) ?? now)
        let suggested = Set(nudges.filter { $0.cadence == .daily }.map(\.medicationId))
        return items.filter { item in
            guard item.state == .aDemanda, item.intakes.isEmpty else { return false }
            if suggested.contains(item.medication.id) { return true }
            let days = Set(history.filter { $0.medicationId == item.medication.id && $0.status == .tomada && $0.date >= weekAgo && $0.date < today }.map(\.date))
            return days.count >= usualDays
        }
        .map(\.medication.name)
    }

    /// "ayer", "el domingo" (within the week), "el 12 de septiembre".
    private static func lastLabel(_ last: String, today: String, calendar: Calendar) -> String {
        guard let day = LocalClock.day(last), let now = LocalClock.day(today) else { return "el \(last)" }
        let ago = calendar.dateComponents([.day], from: day, to: now).day ?? 0
        if ago == 1 { return "ayer" }
        if ago < 7 { return "el \(WeekdayNames.names[LocalClock.isoWeekday(day, calendar: calendar) - 1])" }
        return "el \(day.formatted(.dateTime.day().month(.wide)))"
    }
}

/// Today as one timeline: by the clock with a «now» mark, then what can wait and what isn't due.
struct TodayTimeline: View {
    let items: [TodayItem]
    let store: MedicationStore
    var now: Date = .now

    var body: some View {
        let clock = items.filter { $0.at != nil || $0.state == .entreno }
        let anyTime = items.filter { $0.state == .dia }
        let whenNeeded = items.filter { $0.state == .aDemanda && $0.at == nil }
        let off = items.filter { $0.state == .noToca }
        let time = LocalClock.time(now)
        let nowAt = clock.firstIndex { $0.state == .entreno || ($0.at ?? "") > time } ?? clock.count
        VStack(alignment: .leading, spacing: 18) {
            if !clock.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(clock.prefix(nowAt)) { TimelineRow(item: $0, store: store) }
                    NowMark()
                    ForEach(clock.dropFirst(nowAt)) { TimelineRow(item: $0, store: store) }
                }
                .background(alignment: .leading) {
                    // The rail through the markers.
                    Rectangle().fill(.quaternary).frame(width: 1.5).padding(.leading, TimelineRow.railX).padding(.vertical, 18)
                }
            }
            if !anyTime.isEmpty { section("Hoy, cuando quieras", anyTime) }
            if !whenNeeded.isEmpty { section("Cuando haga falta", whenNeeded) }
            if !off.isEmpty { section("Hoy no toca", off) }
        }
    }

    private func section(_ title: String, _ rows: [TodayItem]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased()).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            ForEach(rows) { TimelineRow(item: $0, store: store) }
        }
    }
}

private struct NowMark: View {
    var body: some View {
        HStack(spacing: 10) {
            Text("Ahora")
                .font(.caption2.weight(.bold))
                .foregroundStyle(Color.accentColor)
                .frame(width: TimelineRow.timeWidth, alignment: .trailing)
            Circle().fill(Color.accentColor).frame(width: 9, height: 9).frame(width: TimelineRow.markerSize)
            Rectangle()
                .fill(LinearGradient(colors: [Color.accentColor, .clear], startPoint: .leading, endPoint: .trailing))
                .frame(height: 1)
        }
        .frame(height: 22)
        .accessibilityLabel("Ahora")
    }
}

/// One dose of today: the time, a marker on the rail, what and when, and its one action.
struct TimelineRow: View {
    let item: TodayItem
    let store: MedicationStore

    static let timeWidth: CGFloat = 46
    static let markerSize: CGFloat = 24
    static var railX: CGFloat { timeWidth + 10 + markerSize / 2 }

    var body: some View {
        HStack(spacing: 10) {
            Text(item.at.map(LocalClock.display) ?? "")
                .font(.footnote.weight(item.state == .atrasada ? .semibold : .regular))
                .fontDesign(.rounded)
                .monospacedDigit()
                .foregroundStyle(item.state == .atrasada ? AnyShapeStyle(Theme.caution) : AnyShapeStyle(.secondary))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(width: Self.timeWidth, alignment: .trailing)
            marker.frame(width: Self.markerSize)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(item.medication.name).font(.body.weight(.medium)).lineLimit(1)
                    Text(item.medication.doseText).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .contentTransition(.opacity)
            }
            .opacity(item.state == .noToca ? 0.6 : 1)
            .strikethrough(item.state == .omitida, color: .secondary)
            Spacer(minLength: 6)
            trailing
        }
        .padding(.vertical, 6)
        .contentShape(.rect)
        .contextMenu { menu }
    }

    /// "A las 17:30 · Se pasó hace 2 h · con agua", with the state in its color.
    private var detail: AttributedString {
        var text = AttributedString(item.when)
        if !item.isTaken && item.state != .omitida {
            var line = AttributedString(" · \(item.line)")
            if item.state == .atrasada { line.foregroundColor = Theme.caution }
            if item.state == .ahora { line.foregroundColor = Color.accentColor }
            text += line
        }
        if let instructions = item.medication.instructions, item.state != .noToca { text += AttributedString(" · \(instructions)") }
        return text
    }

    @ViewBuilder private var marker: some View {
        if item.isTaken {
            Image(systemName: "checkmark.circle.fill").font(.title3).foregroundStyle(Theme.good).symbolEffect(.bounce, value: item.isTaken)
        } else {
            switch item.state {
            case .entreno:
                Image(systemName: "figure.strengthtraining.traditional")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.training)
                    .frame(width: 22, height: 22)
                    .background(Theme.training.opacity(0.15), in: .circle)
                    .symbolEffect(.pulse, isActive: item.slot?.training?.state == .training)
            case .dia:
                Image(systemName: DoseMoment.dia.symbol)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 22, height: 22)
                    .background(Color.accentColor.opacity(0.15), in: .circle)
            case .ahora:
                Circle().fill(Color.accentColor).frame(width: 14, height: 14)
                    .background(Circle().fill(Color.accentColor.opacity(0.25)).frame(width: 22, height: 22))
            case .atrasada:
                // An exclamation, not only the warm ring, so "late" reads without colour.
                Image(systemName: "exclamationmark.circle.fill").font(.title3).foregroundStyle(Theme.caution)
            case .omitida:
                Image(systemName: "xmark.circle").font(.title3).foregroundStyle(.secondary)
            case .aDemanda:
                Circle().strokeBorder(.secondary, style: StrokeStyle(lineWidth: 1.5, dash: [3, 3])).frame(width: 18, height: 18)
            default:
                Circle().strokeBorder(.secondary.opacity(item.state == .noToca ? 0.4 : 0.8), lineWidth: 1.5).background(Circle().fill(Color(.secondarySystemGroupedBackground))).frame(width: 18, height: 18)
            }
        }
    }

    @ViewBuilder private var trailing: some View {
        if let slot = item.slot {
            if slot.isPending {
                Button("Tomada", systemImage: "checkmark") { Task { await store.take(slot) } }
                    .buttonStyle(.glassProminent)
                    .controlSize(.small)
                    .lineLimit(1)
                    .layoutPriority(1)
                    .sensoryFeedback(.success, trigger: slot.status)
            } else if slot.status == .tomada {
                Text("Tomada").font(.caption.weight(.semibold)).foregroundStyle(Theme.good)
            }
        } else if item.state == .aDemanda {
            Button(item.intakes.isEmpty ? "Tomé una" : "Otra", systemImage: "plus") { Task { await store.takeNow(item.medication) } }
                .buttonStyle(.glass)
                .controlSize(.small)
                .lineLimit(1)
                .layoutPriority(1)
                .sensoryFeedback(.success, trigger: item.intakes.count)
        } else if item.state == .tomada {
            Text("Tomada").font(.caption.weight(.semibold)).foregroundStyle(Theme.good)
        }
    }

    @ViewBuilder private var menu: some View {
        if let slot = item.slot {
            if slot.status != .tomada { Button("Tomada", systemImage: "checkmark.circle") { Task { await store.take(slot) } } }
            if slot.status != .omitida { Button("Omitir", systemImage: "xmark.circle") { Task { await store.skip(slot) } } }
            if slot.eventId != nil { Button("Volver a pendiente", systemImage: "arrow.uturn.backward") { Task { await store.undo(slot) } } }
        } else if let last = item.intakes.first {
            Button("Borrar la última toma", systemImage: "trash", role: .destructive) { Task { await store.undo(event: last) } }
        }
    }
}

/// Quiet suggestions to give an as-needed med a schedule: «Ponerle horario» opens the editor prefilled.
struct ScheduleNudgesCard: View {
    let nudges: [ScheduleNudge]
    let store: MedicationStore
    let accept: (ScheduleNudge) -> Void

    var body: some View {
        Card {
            ForEach(nudges) { nudge in
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: nudge.cadence == .weekly ? "calendar.badge.clock" : "alarm")
                            .font(.body)
                            .foregroundStyle(Color.accentColor)
                            .frame(width: 34, height: 34)
                            .background(Color.accentColor.opacity(0.15), in: .circle)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(nudge.title).font(.subheadline.weight(.semibold))
                            Text(nudge.detail).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    HStack {
                        Spacer()
                        Button("Ahora no") { withAnimation(.snappy) { store.dismiss(nudge) } }
                            .buttonStyle(.borderless)
                            .controlSize(.small)
                        Button("Ponerle horario") { accept(nudge) }
                            .buttonStyle(.glassProminent)
                            .controlSize(.small)
                    }
                }
                if nudge.id != nudges.last?.id { Divider() }
            }
        }
    }
}
