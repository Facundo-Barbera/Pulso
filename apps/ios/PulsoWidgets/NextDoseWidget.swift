import AppIntents
import SwiftUI
import WidgetKit

/// Próxima dosis, with a "Tomada" button that logs it without opening the app.
struct NextDoseWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKind.nextDose, provider: SnapshotProvider()) { entry in
            NextDoseWidgetView(entry: entry)
        }
        .configurationDisplayName("Próxima dosis")
        .description("Tu próximo medicamento o suplemento, y marcarlo como tomado.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

struct NextDoseWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    private var snapshot: WidgetSnapshot? { entry.snapshot }
    /// Doses from a previous day are not today's to take.
    private var dose: WidgetSnapshot.Dose? {
        snapshot?.nextDose.flatMap { $0.date == WidgetClock.date(entry.date) ? $0 : nil }
    }
    private var color: Color { WidgetStyle.medication }

    private func isLate(_ dose: WidgetSnapshot.Dose) -> Bool { dose.due < entry.date }

    var body: some View {
        switch family {
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Label("Próxima dosis", systemImage: "pills.fill").font(.caption.weight(.semibold))
                if let dose {
                    Text(dose.name).font(.headline).lineLimit(1).widgetAccentable()
                    Text("\(dose.due.formatted(date: .omitted, time: .shortened)) · \(dose.doseText)").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                } else {
                    Text("Nada pendiente").font(.headline)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .containerBackground(for: .widget) {}
        case .accessoryInline:
            Label(dose.map { "\($0.due.formatted(date: .omitted, time: .shortened)) \($0.name)" } ?? "Sin dosis pendientes", systemImage: "pills.fill")
                .containerBackground(for: .widget) {}
        case .systemMedium:
            medium.pulsoBackground(color)
        default:
            small.pulsoBackground(color)
        }
    }

    @ViewBuilder private var small: some View {
        if let dose {
            VStack(alignment: .leading, spacing: 4) {
                WidgetHeader(title: "Medicación", systemImage: "pills.fill", color: color)
                Spacer(minLength: 0)
                Text(dose.name).font(.headline).lineLimit(2).minimumScaleFactor(0.7)
                due(dose)
                Spacer(minLength: 0)
                takeButton(dose)
            }
        } else {
            empty
        }
    }

    @ViewBuilder private var medium: some View {
        if let dose {
            // ~297 pt inside on a 375 pt phone: a 56 pt icon and a 110 pt button left ~100 pt for
            // the name and "PRÓXIMA DOSIS", which truncated. Slimmer icon and button.
            HStack(spacing: 12) {
                Image(systemName: "pills.fill")
                    .font(.title2)
                    .foregroundStyle(color.gradient)
                    .frame(width: 44, height: 44)
                    .background(color.opacity(0.15), in: Circle())
                VStack(alignment: .leading, spacing: 3) {
                    WidgetHeader(title: "Próxima dosis", systemImage: "clock", color: color)
                    Text(dose.name).font(.headline).lineLimit(2).minimumScaleFactor(0.8)
                    due(dose)
                    if let more = moreToday { Text(more).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                takeButton(dose).frame(width: 96)
            }
        } else {
            empty
        }
    }

    private func due(_ dose: WidgetSnapshot.Dose) -> some View {
        HStack(spacing: 4) {
            Text(isLate(dose) ? "Atrasada" : dose.due.formatted(date: .omitted, time: .shortened))
                .foregroundStyle(isLate(dose) ? Theme.caution : .primary)
                .layoutPriority(1)
            Text("· \(dose.doseText)").foregroundStyle(.secondary)
        }
        .lineLimit(1)
        .font(.caption.weight(.semibold))
    }

    private func takeButton(_ dose: WidgetSnapshot.Dose) -> some View {
        Button(intent: TakeDoseIntent(dose)) {
            Label("Tomada", systemImage: "checkmark")
                .font(.caption.weight(.bold))
                .lineLimit(1)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
        .tint(color)
    }

    private var moreToday: String? {
        guard let left = snapshot?.dosesLeft, left > 1 else { return nil }
        return left == 2 ? "Y 1 más hoy" : "Y \(left - 1) más hoy"
    }

    private var empty: some View {
        entry.paired
            ? WidgetEmpty(systemImage: "checkmark.seal.fill", text: "Nada pendiente por hoy", color: Theme.good)
            : WidgetEmpty(systemImage: "pills.circle", text: WidgetStyle.unpaired, color: color)
    }
}

#Preview(as: .systemSmall) {
    NextDoseWidget()
} timeline: {
    SnapshotEntry(date: .now, snapshot: .preview, paired: true)
    SnapshotEntry(date: .now, snapshot: .longDose, paired: true)
}

#Preview(as: .systemMedium) {
    NextDoseWidget()
} timeline: {
    SnapshotEntry(date: .now, snapshot: .longDose, paired: true)
}

#Preview(as: .accessoryRectangular) {
    NextDoseWidget()
} timeline: {
    SnapshotEntry(date: .now, snapshot: .longDose, paired: true)
}

#Preview(as: .accessoryInline) {
    NextDoseWidget()
} timeline: {
    SnapshotEntry(date: .now, snapshot: .longDose, paired: true)
}

private extension WidgetSnapshot {
    /// A long Spanish name and dose, to check nothing spills out of a widget.
    static var longDose: WidgetSnapshot {
        var snapshot = WidgetSnapshot.preview
        snapshot.nextDose?.name = "Vitamina D3 + K2 2000 UI con aceite de oliva"
        snapshot.nextDose?.doseText = "2 comprimidos masticables"
        return snapshot
    }
}
