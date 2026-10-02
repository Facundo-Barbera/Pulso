import SwiftUI

/// Every dose logged in the last weeks, grouped by day, newest first: what was
/// taken, skipped or postponed and when. Long-press a row to remove a mistaken log.
struct MedicationHistoryCard: View {
    let store: MedicationStore
    @State private var expanded = false

    private static let collapsedDays = 7

    private var days: [(date: String, doses: [DoseEvent])] {
        let grouped = Dictionary(grouping: store.history, by: \.date)
        return grouped.keys.sorted(by: >).map { ($0, grouped[$0] ?? []) }
    }

    var body: some View {
        Card {
            HStack {
                CardTitle(text: "Historial", systemImage: "clock.arrow.circlepath")
                Spacer()
                if !store.history.isEmpty {
                    Text("\(store.history.count { $0.status == .tomada }) tomas · \(MedicationStore.historyDays) días")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            if days.isEmpty {
                Label("Aún no registraste ninguna toma.", systemImage: "list.bullet.clipboard")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 4)
            } else {
                let shown = expanded ? days : Array(days.prefix(Self.collapsedDays))
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(shown, id: \.date) { day in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(Self.dayTitle(day.date))
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(.secondary)
                            ForEach(day.doses) { dose in
                                HistoryRow(dose: dose, medication: store.medications.first { $0.id == dose.medicationId })
                                    .contextMenu {
                                        Button("Eliminar registro", systemImage: "trash", role: .destructive) {
                                            Task { await store.undo(event: dose) }
                                        }
                                    }
                            }
                        }
                    }
                }
                if days.count > Self.collapsedDays {
                    Button(expanded ? "Ver menos" : "Ver todo el historial") { withAnimation(.snappy) { expanded.toggle() } }
                        .font(.subheadline.weight(.medium))
                        .padding(.top, 2)
                }
            }
        }
    }

    /// "Hoy", "Ayer", else "lunes 29 sept".
    static func dayTitle(_ date: String) -> String {
        guard let day = LocalClock.day(date) else { return date }
        let calendar = Calendar.current
        if calendar.isDateInToday(day) { return "Hoy" }
        if calendar.isDateInYesterday(day) { return "Ayer" }
        let text = day.formatted(.dateTime.weekday(.wide).day().month(.abbreviated))
        return text.prefix(1).uppercased() + text.dropFirst()
    }
}

private struct HistoryRow: View {
    let dose: DoseEvent
    let medication: Medication?

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(color)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 1) {
                Text(medication?.name ?? "Medicamento eliminado")
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if let time = takenTime {
                Text(time)
                    .font(.subheadline.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
        }
        .contentShape(Rectangle())
    }

    private var symbol: String {
        switch dose.status {
        case .tomada: "checkmark.circle.fill"
        case .omitida: "xmark.circle.fill"
        case .pospuesta: "clock.badge.exclamationmark"
        case .pendiente: "circle"
        }
    }

    private var color: Color {
        switch dose.status {
        case .tomada: Theme.good
        case .omitida: .secondary
        case .pospuesta: Theme.caution
        case .pendiente: .secondary
        }
    }

    private var detail: String {
        let status = switch dose.status {
        case .tomada: "Tomada"
        case .omitida: "Omitida"
        case .pospuesta: "Pospuesta"
        case .pendiente: "Pendiente"
        }
        let parts = [status, medication?.doseText, dose.scheduledTime.map(Self.scheduled) ?? "sin horario"]
        return parts.compactMap { $0 }.joined(separator: " · ")
    }

    /// "programada 8:00", or the moment for a slot tied to one ("después de entrenar").
    static func scheduled(_ key: String) -> String {
        DoseMoment(slotKey: key) == .hora ? "programada \(LocalClock.display(key))" : DoseMoment.label(slotKey: key)
    }

    private var takenTime: String? {
        guard let takenAt = dose.takenAt else { return nil }
        return Date(timeIntervalSince1970: takenAt / 1000).formatted(date: .omitted, time: .shortened)
    }
}
