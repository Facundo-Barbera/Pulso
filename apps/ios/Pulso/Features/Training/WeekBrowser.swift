import SwiftUI

/// A week of a block, as the browser selects it.
struct WeekRef: Hashable {
    var programId: String
    var number: Int
}

/// What a week's rows do: open a done day's session, preview a day, repeat one, resume a block.
struct WeekActions {
    var openSession: (WeekSession) -> Void = { _ in }
    var preview: (TrainingBlock, ProgramWeek, WeekDay) -> Void = { _, _, _ in }
    var repeatDay: (WeekDay) -> Void = { _ in }
    var resume: (TrainingBlock) -> Void = { _ in }
}

/// ‹ Semana 2 de 6 › across every block (earlier blocks first), a dot per week,
/// and the selected week's days with what happened to each.
struct WeekBrowser: View {
    let blocks: [TrainingBlock]
    let nextDayId: String?
    @Binding var selection: WeekRef?
    var actions = WeekActions()

    private var all: [(block: TrainingBlock, week: ProgramWeek)] { blocks.flatMap { b in b.weeks.map { (b, $0) } } }
    private var currentRef: WeekRef? {
        let block = blocks.last { $0.active } ?? blocks.last
        return block.map { WeekRef(programId: $0.programId, number: $0.currentWeek) }
    }
    private var index: Int {
        let list = all
        guard let ref = selection ?? currentRef else { return max(0, list.count - 1) }
        let found = list.firstIndex { (item: (block: TrainingBlock, week: ProgramWeek)) -> Bool in
            item.block.programId == ref.programId && item.week.number == ref.number
        }
        return found ?? max(0, list.count - 1)
    }

    var body: some View {
        if all.indices.contains(index) {
            let (block, week) = all[index]
            VStack(alignment: .leading, spacing: 12) {
                header(block, week)
                WeekDots(weeks: block.weeks, selected: week.number) { selection = WeekRef(programId: block.programId, number: $0) }
                Card {
                    VStack(spacing: 0) {
                        ForEach(Array(week.days.enumerated()), id: \.element.id) { i, day in
                            WeekDayRow(number: i + 1, day: day, week: week, isNext: block.active && week.isCurrent && day.dayId == nextDayId, actions: actions, preview: { actions.preview(block, week, day) })
                            if i < week.days.count - 1 { Divider().padding(.leading, 44) }
                        }
                    }
                    if !week.other.isEmpty { OtherSessions(sessions: week.other, open: actions.openSession) }
                    if let note = weekNote(block, week) {
                        Label(note, systemImage: week.deload ? "arrow.down.right" : "info.circle")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(.top, 4)
                    }
                }
                .id(WeekRef(programId: block.programId, number: week.number))
                .transition(.opacity)
            }
            .animation(.snappy, value: index)
            .sensoryFeedback(.selection, trigger: index)
            .contentShape(Rectangle())
            .simultaneousGesture(DragGesture(minimumDistance: 24).onEnded { value in
                let dx = value.translation.width
                guard abs(dx) > max(60, abs(value.translation.height) * 1.5) else { return }
                step(dx < 0 ? 1 : -1)
            })
        }
    }

    private func header(_ block: TrainingBlock, _ week: ProgramWeek) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Button { step(-1) } label: { Image(systemName: "chevron.left") }
                    .disabled(index == 0)
                    .accessibilityLabel("Semana anterior")
                VStack(spacing: 2) {
                    Text("Semana \(week.number) de \(block.weeks.count)")
                        .font(.headline)
                        .fontDesign(.rounded)
                        .contentTransition(.numericText())
                    Text(range(week))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                Button { step(1) } label: { Image(systemName: "chevron.right") }
                    .disabled(index >= all.count - 1)
                    .accessibilityLabel("Semana siguiente")
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .tint(Theme.training)
            HStack(spacing: 8) {
                if blocks.count > 1 || !block.active {
                    GlassChip("Bloque \(block.number) · \(block.name)", systemImage: "square.stack.3d.up", tint: block.active ? Theme.training : nil)
                }
                if week.isCurrent && block.active { GlassChip("Esta semana", tint: Theme.training) }
                if week.deload { GlassChip("Descarga", systemImage: "arrow.down.right", tint: Theme.training) }
                if week.startedEarly { GlassChip("Empezada antes", systemImage: "forward.end") }
                Spacer(minLength: 0)
                if !block.active {
                    Button("Retomar") { actions.resume(block) }
                        .font(.subheadline.weight(.semibold))
                        .buttonStyle(.glass)
                        .controlSize(.small)
                        .tint(Theme.training)
                }
            }
        }
    }

    /// "28 sep – 4 oct"
    private func range(_ week: ProgramWeek) -> String {
        let day = Date.FormatStyle.dateTime.day().month(.abbreviated)
        return "\(week.start.formatted(day)) – \(week.lastDay.formatted(day))"
    }

    private func weekNote(_ block: TrainingBlock, _ week: ProgramWeek) -> String? {
        if let note = week.note { return note }
        if block.active && week.isFuture { return "Mismo plan: las cargas se ajustan con lo que hagas antes." }
        if let reason = block.endReason, !block.active, week.number == block.weeks.count { return "Bloque terminado: \(reason)" }
        return nil
    }

    private func step(_ delta: Int) {
        let target = index + delta
        guard all.indices.contains(target) else { return }
        withAnimation(.snappy) { selection = WeekRef(programId: all[target].block.programId, number: all[target].week.number) }
    }
}

/// A dot per week of the block: filled by the share of days done, the selected one ringed.
private struct WeekDots: View {
    let weeks: [ProgramWeek]
    let selected: Int
    let select: (Int) -> Void

    var body: some View {
        HStack(spacing: 6) {
            ForEach(weeks) { week in
                let share = week.days.isEmpty ? 0 : Double(week.done) / Double(week.days.count)
                Button { select(week.number) } label: {
                    Capsule()
                        .fill(Theme.training.opacity(week.isFuture ? 0.12 : 0.18))
                        .overlay(alignment: .leading) {
                            GeometryReader { geo in
                                Capsule().fill(Theme.training.gradient).frame(width: geo.size.width * share)
                            }
                        }
                        .overlay { if week.number == selected { Capsule().strokeBorder(Theme.training, lineWidth: 1.5) } }
                        .frame(height: 8)
                        .clipShape(.capsule)
                        .padding(.vertical, 8)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Semana \(week.number): \(week.done) de \(week.days.count) días")
            }
        }
    }
}

/// One program day in a week: done (quiet summary, opens its session), partial,
/// missed, the next one, or still ahead (opens a preview).
private struct WeekDayRow: View {
    let number: Int
    let day: WeekDay
    let week: ProgramWeek
    let isNext: Bool
    let actions: WeekActions
    let preview: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: open) {
                HStack(spacing: 12) {
                    StatusIcon(status: day.status, isNext: isNext)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Día \(number) · \(day.name)")
                            .font(.body.weight(isNext ? .semibold : .regular))
                            .foregroundStyle(day.status == .missed ? .secondary : .primary)
                            .lineLimit(1)
                        Text(subtitle)
                            .font(.subheadline)
                            .foregroundStyle(isNext ? AnyShapeStyle(Theme.training) : AnyShapeStyle(.secondary))
                            .lineLimit(2)
                    }
                    Spacer(minLength: 4)
                }
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if day.status.isDone {
                Menu {
                    if let session = day.last { Button("Ver sesión", systemImage: "list.bullet.rectangle") { actions.openSession(session) } }
                    Button("Ver el día", systemImage: "eye") { preview() }
                    if week.isCurrent {
                        Button("Repetir este día", systemImage: "arrow.counterclockwise") { actions.repeatDay(day) }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                        .frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("Opciones de \(day.name)")
            } else {
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
        }
    }

    private func open() {
        if day.status.isDone, let session = day.last { actions.openSession(session) } else { preview() }
    }

    /// "Hecho · jue 1 oct · 41 min · 10 series", "Siguiente", "No se hizo"…
    private var subtitle: String {
        if let session = day.last, day.status.isDone {
            var parts = [day.status == .partial ? "A medias" : "Hecho", session.start.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)), "\(session.minutes) min"]
            if session.sets > 0 { parts.append("\(session.sets) \(session.sets == 1 ? "serie" : "series")") }
            if session.cardioMinutes > 0 { parts.append("\(Int(session.cardioMinutes.rounded())) min de cardio") }
            if day.sessions.count > 1 { parts.append("×\(day.sessions.count)") }
            return parts.joined(separator: " · ")
        }
        if isNext { return "Siguiente" }
        switch day.status {
        case .missed: return "No se hizo"
        default: return week.isFuture ? "Previsto" : "Pendiente"
        }
    }
}

private struct StatusIcon: View {
    let status: WeekDayStatus
    let isNext: Bool

    var body: some View {
        Group {
            switch status {
            case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.training)
            case .partial: Image(systemName: "circle.lefthalf.filled").foregroundStyle(Theme.energy)
            case .missed: Image(systemName: "xmark.circle").foregroundStyle(.secondary)
            case .planned:
                if isNext {
                    Image(systemName: "play.circle.fill").foregroundStyle(Theme.training).symbolEffect(.pulse, options: .repeat(2))
                } else {
                    Image(systemName: "circle").foregroundStyle(.tertiary)
                }
            }
        }
        .font(.title2)
        .frame(width: 32)
        .accessibilityHidden(true)
    }
}

/// "También esta semana": sessions of another block (or none) that still count.
private struct OtherSessions: View {
    let sessions: [WeekSession]
    let open: (WeekSession) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("También esta semana").font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.top, 8)
            ForEach(sessions) { session in
                Button { open(session) } label: {
                    HStack {
                        Label(session.name, systemImage: "checkmark.circle").foregroundStyle(.primary)
                        Spacer()
                        Text(session.start.formatted(.dateTime.weekday(.abbreviated).day())).foregroundStyle(.secondary)
                    }
                    .font(.subheadline)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }
}
