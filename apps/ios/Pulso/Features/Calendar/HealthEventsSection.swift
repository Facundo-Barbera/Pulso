import SwiftUI

/// The "Salud" segment: what is going on now, then the history by year, so
/// "me enfermé por esas fechas" has an answer.
struct HealthEventsSection: View {
    let store: CalendarStore
    var onEdit: (HealthEvent) -> Void
    var onAdd: () -> Void

    var body: some View {
        if store.healthLoaded && store.healthEvents.isEmpty {
            Card {
                EmptyStateView(
                    systemImage: "cross.case", title: "Sin lesiones ni enfermedades",
                    message: "Anota lesiones, enfermedades o molestias: el Coach adapta tu entreno y te queda el historial.",
                    tint: Theme.protein, actionTitle: "Registrar", action: onAdd
                )
            }
        } else {
            if !store.activeHealth.isEmpty {
                Card {
                    CardTitle(text: "Ahora", systemImage: "waveform.path.ecg")
                    ForEach(store.activeHealth) { event in
                        Button { onEdit(event) } label: { HealthEventRow(event: event) }
                            .buttonStyle(.plain)
                    }
                }
            }
            ForEach(historyByYear, id: \.year) { group in
                Card {
                    CardTitle(text: "Historial · \(group.year)", systemImage: "clock.arrow.circlepath")
                    ForEach(group.events) { event in
                        Button { onEdit(event) } label: { HealthEventRow(event: event) }
                            .buttonStyle(.plain)
                        if event.id != group.events.last?.id { Divider() }
                    }
                }
            }
        }
    }

    private var historyByYear: [(year: String, events: [HealthEvent])] {
        Dictionary(grouping: store.pastHealth) { String($0.startDate.prefix(4)) }
            .sorted { $0.key > $1.key }
            .map { ($0.key, $0.value) }
    }
}

struct HealthEventRow: View {
    let event: HealthEvent

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: event.kind.symbol)
                .font(.headline)
                .foregroundStyle(event.status.tint)
                .frame(width: 40, height: 40)
                .background(event.status.tint.opacity(0.14), in: .circle)
            VStack(alignment: .leading, spacing: 3) {
                Text(event.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text([event.kind.label, BodyArea.name(event.bodyArea), event.period].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if event.isActive, let affected = event.affectedTraining {
                    Label(affected, systemImage: "dumbbell").font(.caption).foregroundStyle(Theme.training).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if event.isActive {
                // The status in words too: active and recovering differ only in tint otherwise.
                VStack(alignment: .trailing, spacing: 4) {
                    SeverityDots(value: event.severity, tint: event.status.tint)
                    Text(event.status.label).font(.caption2.weight(.medium)).foregroundStyle(.secondary).lineLimit(1)
                }
            } else {
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
        }
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityValue("Intensidad \(event.severity) de 5, \(event.status.label)")
    }
}

/// Five dots, `value` of them filled.
struct SeverityDots: View {
    let value: Int
    var tint: Color = Theme.protein

    var body: some View {
        HStack(spacing: 3) {
            ForEach(1...5, id: \.self) { i in
                Circle().fill(i <= value ? tint : Color.secondary.opacity(0.25)).frame(width: 6, height: 6)
            }
        }
        .accessibilityHidden(true)
    }
}
