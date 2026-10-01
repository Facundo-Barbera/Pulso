import SwiftUI

/// Full medication screen, pushed from `MedicationTodayCard`: today's ring as
/// the hero, today's doses, as-needed quick log, adherence and the list.
struct MedicationView: View {
    let model: PulsoModel
    @State private var store = MedicationStore.shared
    @State private var editing: EditTarget?
    @State private var importing = false

    private enum EditTarget: Identifiable {
        case new
        case existing(Medication)
        var id: String {
            if case let .existing(med) = self { return med.id }
            return "new"
        }
    }

    var body: some View {
        ScrollView {
            if store.loaded && store.medications.isEmpty {
                emptyState
            } else {
                VStack(spacing: 16) {
                    hero
                    if let day = store.day, !day.slots.isEmpty { todayCard(day) }
                    if !store.asNeeded.isEmpty { asNeededCard }
                    if let report = store.adherence, !report.medications.isEmpty { AdherenceSection(report: report) }
                    medicationsCard
                    MedicationHistoryCard(store: store)
                }
                .padding(.horizontal)
                .padding(.bottom, 24)
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Medicación")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Importar desde Salud", systemImage: "heart.text.square") { importing = true }
                } label: {
                    Image(systemName: "ellipsis")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Añadir", systemImage: "plus") { editing = .new }
                    .buttonStyle(.glassProminent)
            }
        }
        .refreshable { await store.refresh() }
        .task {
            MedicationNotifications.shared.activate()
            await store.refresh()
        }
        .animation(.snappy, value: store.day)
        .animation(.snappy, value: store.medications)
        .sheet(item: $editing) { target in
            switch target {
            case .new: MedicationEditor(store: store, medication: nil)
            case let .existing(med): MedicationEditor(store: store, medication: med)
            }
        }
        .sheet(isPresented: $importing) { HealthMedicationImport(store: store) }
    }

    // MARK: Sections

    private var hero: some View {
        let taken = store.takenToday
        let total = store.day?.slots.count ?? 0
        // Without a schedule there is no target: the ring fills once something is taken.
        let progress = total > 0 ? min(1, Double(store.day?.taken ?? 0) / Double(total)) : (taken > 0 ? 1 : 0)
        return VStack(spacing: 14) {
            ZStack {
                Circle().stroke(Color.accentColor.opacity(0.15), lineWidth: 18)
                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(
                        AngularGradient(colors: [Color.accentColor, Theme.body], center: .center),
                        style: StrokeStyle(lineWidth: 18, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 2) {
                    let shown = total > 0 ? (store.day?.taken ?? 0) : taken
                    Text("\(shown)")
                        .font(.system(size: 54, weight: .bold, design: .rounded))
                        .contentTransition(.numericText(value: Double(shown)))
                    Text(total > 0 ? "de \(total) tomas" : taken == 0 ? "sin tomas hoy" : taken == 1 ? "toma hoy" : "tomas hoy")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .padding(.horizontal, 24)
            }
            .frame(width: 190, height: 190)
            .animation(.snappy, value: taken)

            if let next = store.day?.next {
                Label("Próxima: \(next.name) · \(LocalClock.display(next.time))", systemImage: "bell.badge")
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .glassEffect(.regular, in: .capsule)
                    .padding(.horizontal)
            } else if total > 0 && taken == total {
                Label("Todo tomado por hoy", systemImage: "checkmark.seal.fill")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.body)
                    .symbolEffect(.bounce, value: taken)
            }
            if let streak = store.adherence?.overall.currentStreak, streak > 1 {
                Label("\(streak) días seguidos sin fallar", systemImage: "flame.fill")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.energy)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }

    private func todayCard(_ day: MedicationDay) -> some View {
        Card {
            CardTitle(text: "Hoy", systemImage: "calendar")
            ForEach(day.slots) { slot in
                DoseRow(slot: slot, store: store)
                if slot.id != day.slots.last?.id { Divider().padding(.leading, 46) }
            }
            Text("Mantén pulsado una toma para omitirla o deshacerla.")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }

    private var asNeededCard: some View {
        Card {
            CardTitle(text: "Cuando haga falta", systemImage: "hand.tap")
            ForEach(store.asNeeded) { med in
                let count = store.day?.asNeeded.count { $0.medicationId == med.id } ?? 0
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(med.name).font(.body.weight(.medium))
                        Text(count == 0 ? med.doseText : "\(med.doseText) · \(count) hoy")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .contentTransition(.numericText())
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

    private var medicationsCard: some View {
        Card {
            CardTitle(text: "Lo que tomas", systemImage: "list.bullet")
            LowStockNote(medications: store.lowStock)
            ForEach(store.medications) { med in
                Button { editing = .existing(med) } label: { MedicationRow(medication: med) }
                    .buttonStyle(.plain)
                if med.id != store.medications.last?.id { Divider().padding(.leading, 46) }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 18) {
            Image(systemName: "pills.circle.fill")
                .font(.system(size: 72))
                .foregroundStyle(Color.accentColor.gradient)
                .symbolEffect(.breathe)
            Text("Anota tus medicamentos y suplementos")
                .font(.title3.weight(.semibold))
                .multilineTextAlignment(.center)
            Text("Te recordamos cada toma y llevas la cuenta sin pensar.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Añadir medicación", systemImage: "plus") { editing = .new }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
            Button("Importar desde Salud", systemImage: "heart.text.square") { importing = true }
                .buttonStyle(.glass)
        }
        .padding(32)
        .padding(.top, 60)
    }
}

private struct MedicationRow: View {
    let medication: Medication

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: medication.kind.symbol)
                .font(.body)
                .foregroundStyle(medication.active ? Color.accentColor : .secondary)
                .frame(width: 34, height: 34)
                .background(Color.accentColor.opacity(medication.active ? 0.15 : 0.05), in: .circle)
            VStack(alignment: .leading, spacing: 2) {
                Text(medication.name).font(.body.weight(.medium)).foregroundStyle(medication.active ? .primary : .secondary)
                Text(summary).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer(minLength: 0)
            if let stock = medication.stock {
                Text("\(Int(stock))")
                    .font(.subheadline.weight(.semibold))
                    .fontDesign(.rounded)
                    .monospacedDigit()
                    .lineLimit(1)
                    .layoutPriority(1)
                    .foregroundStyle(medication.lowStock ? Theme.energy : .secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background((medication.lowStock ? Theme.energy : Color.secondary).opacity(0.12), in: .capsule)
                    .accessibilityLabel("Quedan \(Int(stock)) dosis")
            }
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .contentShape(.rect)
    }

    private var summary: String {
        var parts = [medication.doseText]
        if !medication.active {
            parts.append("En pausa")
        } else if medication.schedule.asNeeded {
            parts.append("Cuando haga falta")
        } else {
            parts.append(medication.schedule.times.map(LocalClock.display).formatted(.list(type: .and)))
            if !medication.schedule.days.isEmpty { parts.append(WeekdayNames.short(medication.schedule.days)) }
        }
        if let instructions = medication.instructions { parts.append(instructions) }
        return parts.joined(separator: " · ")
    }
}

/// Spanish weekday initials in ISO order (lunes first).
enum WeekdayNames {
    static let letters = ["L", "M", "X", "J", "V", "S", "D"]
    static let names = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]

    static func short(_ days: [Int]) -> String {
        if days.sorted() == [1, 2, 3, 4, 5] { return "Entre semana" }
        if days.sorted() == [6, 7] { return "Fines de semana" }
        return days.sorted().map { names[$0 - 1].prefix(3).capitalized }.joined(separator: ", ")
    }
}

#Preview("Medicación · 375 pt · XXL") {
    let slot = DoseSlot(medicationId: "1", name: "Vitamina D3 + K2 2000 UI con aceite de oliva", kind: .suplemento, dose: 2, unit: "comprimidos",
                        instructions: "Con la comida principal", date: LocalClock.date(.now), time: "21:30", status: .pendiente)
    let med = Medication(id: "1", name: slot.name, kind: .suplemento, dose: 2, unit: "comprimidos", instructions: "Con la comida principal",
                         schedule: MedicationSchedule(asNeeded: false, times: ["08:00", "14:00", "21:30"], days: [1, 3, 5]),
                         startDate: "2026-09-01", stock: 4, lowStockThreshold: 7, lowStock: true, active: true)
    return NarrowPreview(dynamicType: .xxLarge) {
        Card {
            DoseRow(slot: slot, store: .shared)
            DoseRow(slot: slot, store: .shared, compact: true)
        }
        Card { MedicationRow(medication: med) }
    }
}
