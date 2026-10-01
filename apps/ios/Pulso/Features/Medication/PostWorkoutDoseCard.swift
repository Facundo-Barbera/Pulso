import SwiftUI

/// On the session summary: today's doses tied to training ("Creatina 5 g"),
/// each with a one-tap "Tomar ahora". Shows nothing for a past session or when
/// nothing is waiting; a dose taken here stays, checked, until the sheet closes.
struct PostWorkoutDoseCard: View {
    /// When the session started; only today's sessions offer the doses.
    let sessionStart: Date
    @State private var store = MedicationStore.shared
    /// Slots that were pending while this card was up, so they stay once taken.
    @State private var offered: [String] = []

    private var slots: [DoseSlot] {
        (store.day?.slots ?? []).filter { offered.contains($0.id) }
    }

    var body: some View {
        Group {
            if !slots.isEmpty {
                Card {
                    CardTitle(text: "Después de entrenar", systemImage: DoseMoment.entreno.symbol)
                    ForEach(slots) { slot in
                        PostWorkoutDoseRow(slot: slot, store: store)
                    }
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: slots)
        .task {
            guard Calendar.current.isDateInToday(sessionStart) else { return }
            if !store.loaded { await store.refresh() }
            offer()
        }
        .onChange(of: store.pendingAfterWorkout.map(\.id)) { offer() }
    }

    private func offer() {
        guard Calendar.current.isDateInToday(sessionStart) else { return }
        for slot in store.pendingAfterWorkout where !offered.contains(slot.id) { offered.append(slot.id) }
    }
}

private struct PostWorkoutDoseRow: View {
    let slot: DoseSlot
    let store: MedicationStore

    private var taken: Bool { slot.status == .tomada }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: taken ? "checkmark.circle.fill" : slot.kind.symbol)
                .font(.title3)
                .foregroundStyle(taken ? Theme.body : Theme.training)
                .contentTransition(.symbolEffect(.replace))
                .symbolEffect(.bounce, value: taken)
                .frame(width: 34, height: 34)
                .background((taken ? Theme.body : Theme.training).opacity(0.15), in: .circle)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(slot.name) \(slot.doseText)")
                    .font(.body.weight(.medium))
                    .lineLimit(2)
                Text(caption)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .contentTransition(.opacity)
            }
            Spacer(minLength: 8)
            if taken {
                Text("Tomada")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.body)
                    .transition(.scale.combined(with: .opacity))
            } else {
                Button("Tomar ahora") { Task { await store.take(slot) } }
                    .font(.subheadline.weight(.semibold))
                    .buttonStyle(.glassProminent)
                    .tint(Theme.training)
                    .lineLimit(1)
                    .layoutPriority(1)
            }
        }
        .animation(.snappy, value: taken)
        .sensoryFeedback(.success, trigger: taken) { _, new in new }
    }

    private var caption: String {
        if taken, let takenAt = slot.takenAt {
            return "A las \(Date(timeIntervalSince1970: takenAt / 1000).formatted(date: .omitted, time: .shortened))"
        }
        if slot.training?.state == .trained, let until = slot.training?.until {
            return "Mejor antes de las \(LocalClock.display(until))"
        }
        return "Recién terminas: buen momento"
    }
}
