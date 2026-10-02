import SwiftUI

/// Compact medication card for the Hoy tab: today's doses with one-tap
/// "tomada", what's next, and a low-stock nudge. Tapping the header pushes
/// `MedicationView`, so it must live inside a `NavigationStack`.
struct MedicationTodayCard: View {
    let model: PulsoModel
    @State private var store = MedicationStore.shared
    @State private var adding = false
    @State private var editing: Medication?

    var body: some View {
        Card {
            NavigationLink {
                MedicationView(model: model)
            } label: {
                HStack {
                    CardTitle(text: "Medicación y suplementos", systemImage: "pills.fill")
                    Spacer()
                    if let day = store.day, !day.slots.isEmpty {
                        Text("\(day.taken)/\(day.slots.count)")
                            .font(.subheadline.weight(.semibold))
                            .fontDesign(.rounded)
                            .monospacedDigit()
                            .contentTransition(.numericText())
                            .foregroundStyle(day.taken == day.slots.count ? Theme.good : .secondary)
                    }
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                }
            }
            .buttonStyle(.plain)

            content
        }
        .animation(.snappy, value: store.day)
        .task {
            MedicationNotifications.shared.activate()
            await store.refresh()
        }
        .sheet(isPresented: $adding) { MedicationEditor(store: store, medication: nil) }
        .sheet(item: $editing) { MedicationEditor(store: store, medication: $0) }
    }

    @ViewBuilder private var content: some View {
        if !store.loaded {
            ProgressView().frame(maxWidth: .infinity, minHeight: 60)
        } else if store.active.isEmpty {
            HStack(spacing: 14) {
                Image(systemName: "pills.circle.fill")
                    .font(.system(size: 38))
                    .foregroundStyle(Color.accentColor.gradient)
                    .symbolEffect(.bounce, options: .nonRepeating)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Anota tus medicamentos y suplementos y te avisamos.").font(.subheadline).foregroundStyle(.secondary)
                    Button("Añadir", systemImage: "plus") { adding = true }
                        .buttonStyle(.glass)
                        .controlSize(.small)
                }
            }
        } else if let day = store.day, !day.slots.isEmpty {
            DoseGroupsView(slots: visibleSlots(day), store: store, compact: true)
            if let next = day.next, let time = next.time {
                Label {
                    Text("Próxima: \(next.name) a las \(LocalClock.display(time))")
                } icon: {
                    Image(systemName: "bell.badge")
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
            } else if day.taken == day.slots.count {
                Label("Todo tomado por hoy", systemImage: "checkmark.seal.fill")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Theme.good)
            }
            LowStockNote(medications: store.lowStock)
            AsNeededRows(store: store, editing: $editing)
        } else if !store.asNeeded.isEmpty {
            AsNeededRows(store: store, editing: $editing)
            LowStockNote(medications: store.lowStock)
        } else {
            Label("Hoy no hay tomas programadas.", systemImage: "moon.zzz")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            LowStockNote(medications: store.lowStock)
        }
    }

    /// Pending ones first (up to four), so the card stays compact on busy days; shown in the day's order.
    private func visibleSlots(_ day: MedicationDay) -> [DoseSlot] {
        let pending = day.slots.filter(\.isPending)
        let done = day.slots.filter { !$0.isPending }
        let shown = Set((pending + done).prefix(4).map(\.id))
        return day.slots.filter { shown.contains($0.id) }
    }
}

/// A day's slots grouped by what they hang on (a time, training, a meal, bedtime), in the day's order.
struct DoseGroup: Identifiable, Equatable {
    var moment: DoseMoment
    var slots: [DoseSlot]
    var id: DoseMoment { moment }

    /// The training line ("Entrenando…", "Hoy descansas · 09:00"), from the first slot still to take.
    var trainingStatus: TrainingSlot? {
        moment == .entreno ? slots.first(where: \.isPending)?.training : nil
    }

    /// `slots` come sorted by time with the ones waiting for a workout last; groups keep that order.
    static func of(_ slots: [DoseSlot]) -> [DoseGroup] {
        var groups: [DoseGroup] = []
        for slot in slots {
            if let index = groups.firstIndex(where: { $0.moment == slot.moment }) {
                groups[index].slots.append(slot)
            } else {
                groups.append(DoseGroup(moment: slot.moment, slots: [slot]))
            }
        }
        return groups
    }
}

/// Dose rows under a small heading per moment. A day of only fixed times shows no headings.
struct DoseGroupsView: View {
    let slots: [DoseSlot]
    let store: MedicationStore
    var compact = false

    var body: some View {
        let groups = DoseGroup.of(slots)
        let headed = groups.count > 1 || groups.first?.moment != .hora
        VStack(alignment: .leading, spacing: compact ? 12 : 16) {
            ForEach(groups) { group in
                VStack(alignment: .leading, spacing: 8) {
                    if headed { MomentHeader(group: group) }
                    ForEach(group.slots) { slot in
                        DoseRow(slot: slot, store: store, compact: compact)
                        if !compact && slot.id != group.slots.last?.id { Divider().padding(.leading, 46) }
                    }
                }
            }
        }
    }
}

private struct MomentHeader: View {
    let group: DoseGroup

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(group.moment.title, systemImage: group.moment.symbol)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(group.moment == .entreno ? AnyShapeStyle(Theme.training) : AnyShapeStyle(.secondary))
            if let training = group.trainingStatus {
                Text(training.status)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .contentTransition(.opacity)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// One dose with a big tap target that marks it taken; long-press for more.
struct DoseRow: View {
    let slot: DoseSlot
    let store: MedicationStore
    var compact = false

    private var done: Bool { slot.status == .tomada }

    var body: some View {
        HStack(spacing: 12) {
            Button {
                Task { done ? await store.undo(slot) : await store.take(slot) }
            } label: {
                Image(systemName: icon)
                    .font(.title2)
                    .foregroundStyle(color)
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 34, height: 34)
            }
            .buttonStyle(.plain)
            .sensoryFeedback(.success, trigger: done) { _, new in new }
            .accessibilityLabel(done ? "Desmarcar \(slot.name)" : "Marcar \(slot.name) como tomada")

            VStack(alignment: .leading, spacing: 2) {
                Text(slot.name)
                    .font(.body.weight(.medium))
                    .strikethrough(slot.status == .omitida, color: .secondary)
                    .foregroundStyle(slot.status == .omitida ? .secondary : .primary)
                    .lineLimit(2)
                Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            trailing
        }
        .contentShape(.rect)
        .contextMenu {
            if !done { Button("Tomada", systemImage: "checkmark.circle") { Task { await store.take(slot) } } }
            if slot.status != .omitida { Button("Omitir", systemImage: "xmark.circle") { Task { await store.skip(slot) } } }
            if slot.eventId != nil { Button("Volver a pendiente", systemImage: "arrow.uturn.backward") { Task { await store.undo(slot) } } }
        }
    }

    /// The time it's due, or a training glyph while it waits for the workout.
    @ViewBuilder private var trailing: some View {
        if let time = slot.time {
            Text(LocalClock.display(time))
                .font(.subheadline.weight(.semibold))
                .fontDesign(.rounded)
                .monospacedDigit()
                .foregroundStyle(isLate ? Theme.caution : .secondary)
                .lineLimit(1)
                .layoutPriority(1)
        } else {
            Image(systemName: slot.training?.state == .training ? "figure.strengthtraining.traditional" : "hourglass")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.training)
                .symbolEffect(.pulse, isActive: slot.training?.state == .training && slot.isPending)
                .accessibilityLabel(slot.training?.status ?? "Después de entrenar")
        }
    }

    private var icon: String {
        switch slot.status {
        case .tomada: "checkmark.circle.fill"
        case .omitida: "xmark.circle"
        case .pospuesta: "clock.badge"
        case .pendiente: isLate ? "exclamationmark.circle" : "circle"
        }
    }

    private var color: Color {
        switch slot.status {
        case .tomada: Theme.good
        case .omitida: .secondary
        case .pospuesta: Theme.carbs
        case .pendiente: isLate ? Theme.caution : .accentColor
        }
    }

    /// Past the training window, or half an hour past its time.
    private var isLate: Bool {
        guard slot.isPending else { return false }
        if slot.training?.state == .trained, let until = slot.training?.until {
            return LocalClock.instant(date: slot.date, time: until).map { $0 < .now } ?? false
        }
        guard let time = slot.time, let at = LocalClock.instant(date: slot.date, time: time) else { return false }
        return at.addingTimeInterval(30 * 60) < .now
    }

    private var detail: String {
        if done, let takenAt = slot.takenAt {
            return "Tomada a las \(Date(timeIntervalSince1970: takenAt / 1000).formatted(date: .omitted, time: .shortened))"
        }
        if slot.status == .pospuesta { return "Pospuesta · \(slot.doseText)" }
        return [slot.doseText, compact ? nil : slot.instructions].compactMap { $0 }.joined(separator: " · ")
    }
}

/// "Quedan pocas" line for meds at or under their threshold.
struct LowStockNote: View {
    let medications: [Medication]

    var body: some View {
        if !medications.isEmpty {
            Label {
                Text(text)
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill").symbolEffect(.pulse, options: .nonRepeating)
            }
            .font(.footnote.weight(.medium))
            .foregroundStyle(Theme.caution)
        }
    }

    private var text: String {
        if medications.count == 1, let med = medications.first {
            return "Quedan \(Int(med.stock ?? 0)) dosis de \(med.name)"
        }
        return "Poco stock: " + medications.map(\.name).formatted(.list(type: .and))
    }
}

/// Medications without a schedule: each with today's count and a one-tap
/// "Tomé una". Ones imported from Apple Health arrive like this, so the row
/// also offers to give them a schedule (and reminders).
private struct AsNeededRows: View {
    let store: MedicationStore
    @Binding var editing: Medication?

    var body: some View {
        VStack(spacing: 10) {
            ForEach(store.asNeeded) { med in
                let count = store.day?.asNeeded.count { $0.medicationId == med.id } ?? 0
                HStack(spacing: 12) {
                    Image(systemName: count > 0 ? "checkmark.circle.fill" : "pills")
                        .font(.title2)
                        .foregroundStyle(count > 0 ? Theme.good : .secondary)
                        .contentTransition(.symbolEffect(.replace))
                        .frame(width: 34, height: 34)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(med.name).font(.body.weight(.medium)).lineLimit(1)
                        Button {
                            editing = med
                        } label: {
                            Text(count > 0 ? "\(med.doseText) · tomada \(count == 1 ? "hoy" : "\(count) veces hoy")" : "Sin horario · Programar")
                                .font(.caption)
                                .foregroundStyle(count > 0 ? AnyShapeStyle(.secondary) : AnyShapeStyle(Color.accentColor))
                                .contentTransition(.numericText())
                                .lineLimit(1)
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer(minLength: 8)
                    Button("Tomé una", systemImage: "plus") { Task { await store.takeNow(med) } }
                        .buttonStyle(.glass)
                        .controlSize(.small)
                        .lineLimit(1)
                        .layoutPriority(1)
                        .sensoryFeedback(.success, trigger: count)
                }
            }
        }
    }
}
