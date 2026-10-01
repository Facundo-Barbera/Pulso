import SwiftUI

/// Compact medication card for the Hoy tab: today's doses with one-tap
/// "tomada", what's next, and a low-stock nudge. Tapping the header pushes
/// `MedicationView`, so it must live inside a `NavigationStack`.
struct MedicationTodayCard: View {
    let model: PulsoModel
    @State private var store = MedicationStore.shared
    @State private var adding = false

    var body: some View {
        Card {
            NavigationLink {
                MedicationView(model: model)
            } label: {
                HStack {
                    CardTitle(text: "Medicación", systemImage: "pills.fill")
                    Spacer()
                    if let day = store.day, !day.slots.isEmpty {
                        Text("\(day.taken)/\(day.slots.count)")
                            .font(.subheadline.weight(.semibold))
                            .fontDesign(.rounded)
                            .monospacedDigit()
                            .contentTransition(.numericText())
                            .foregroundStyle(day.taken == day.slots.count ? Theme.body : .secondary)
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
                    Text("Anota lo que tomas y te avisamos.").font(.subheadline).foregroundStyle(.secondary)
                    Button("Añadir medicación", systemImage: "plus") { adding = true }
                        .buttonStyle(.glass)
                        .controlSize(.small)
                }
            }
        } else if let day = store.day, !day.slots.isEmpty {
            VStack(spacing: 8) {
                ForEach(visibleSlots(day)) { slot in
                    DoseRow(slot: slot, store: store, compact: true)
                }
            }
            if let next = day.next {
                Label {
                    Text("Próxima: \(next.name) a las \(LocalClock.display(next.time))")
                } icon: {
                    Image(systemName: "bell.badge")
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
            } else if day.taken == day.slots.count {
                Label("Todo tomado por hoy", systemImage: "checkmark.seal.fill")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Theme.body)
            }
            LowStockNote(medications: store.lowStock)
        } else {
            Label("Hoy no hay tomas programadas.", systemImage: "moon.zzz")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            LowStockNote(medications: store.lowStock)
        }
    }

    /// Pending ones first (up to four), so the card stays compact on busy days.
    private func visibleSlots(_ day: MedicationDay) -> [DoseSlot] {
        let pending = day.slots.filter { $0.status != .tomada && $0.status != .omitida }
        let done = day.slots.filter { $0.status == .tomada || $0.status == .omitida }
        return Array((pending + done).prefix(4))
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
            Text(LocalClock.display(slot.time))
                .font(.subheadline.weight(.semibold))
                .fontDesign(.rounded)
                .monospacedDigit()
                .foregroundStyle(isLate ? Theme.energy : .secondary)
                .lineLimit(1)
                .layoutPriority(1)
        }
        .contentShape(.rect)
        .contextMenu {
            if !done { Button("Tomada", systemImage: "checkmark.circle") { Task { await store.take(slot) } } }
            if slot.status != .omitida { Button("Omitir", systemImage: "xmark.circle") { Task { await store.skip(slot) } } }
            if slot.eventId != nil { Button("Volver a pendiente", systemImage: "arrow.uturn.backward") { Task { await store.undo(slot) } } }
        }
    }

    private var icon: String {
        switch slot.status {
        case .tomada: "checkmark.circle.fill"
        case .omitida: "xmark.circle"
        case .pospuesta: "clock.badge"
        case .pendiente: "circle"
        }
    }

    private var color: Color {
        switch slot.status {
        case .tomada: Theme.body
        case .omitida: .secondary
        case .pospuesta: Theme.carbs
        case .pendiente: isLate ? Theme.energy : .accentColor
        }
    }

    private var isLate: Bool {
        guard slot.status == .pendiente || slot.status == .pospuesta,
              let at = LocalClock.instant(date: slot.date, time: slot.time) else { return false }
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
            .foregroundStyle(Theme.energy)
        }
    }

    private var text: String {
        if medications.count == 1, let med = medications.first {
            return "Quedan \(Int(med.stock ?? 0)) dosis de \(med.name)"
        }
        return "Poco stock: " + medications.map(\.name).formatted(.list(type: .and))
    }
}
