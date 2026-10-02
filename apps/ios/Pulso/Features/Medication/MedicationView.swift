import SwiftUI

/// Full medication screen, pushed from `MedicationTodayCard`: what is left
/// today as the hero, schedule suggestions, one timeline of today, constancy,
/// what you take and the history.
struct MedicationView: View {
    let model: PulsoModel
    @State private var store = MedicationStore.shared
    @State private var editing: EditTarget?
    @State private var importing = false

    private enum EditTarget: Identifiable {
        case new(MedicationKind)
        case existing(Medication)
        case suggested(Medication, ScheduleNudge)
        var id: String {
            switch self {
            case let .new(kind): "new-\(kind.rawValue)"
            case let .existing(med): med.id
            case let .suggested(med, _): "suggested-\(med.id)"
            }
        }
    }

    var body: some View {
        // Rebuilt each minute so «Toca ahora» / «Se pasó» follow the clock.
        TimelineView(.everyMinute) { context in
            let items = TodayItem.build(medications: store.medications, day: store.day, history: store.history, now: context.date)
            ScrollView {
                if store.loaded && store.medications.isEmpty {
                    emptyState
                } else {
                    VStack(spacing: 16) {
                        MedicationHero(items: items, streak: store.adherence?.overall.currentStreak ?? 0)
                        if !store.nudges.isEmpty {
                            ScheduleNudgesCard(nudges: store.nudges, store: store) { nudge in
                                if let med = store.medications.first(where: { $0.id == nudge.medicationId }) { editing = .suggested(med, nudge) }
                            }
                        }
                        if !items.isEmpty {
                            Card {
                                CardTitle(text: "Hoy", systemImage: "calendar")
                                TodayTimeline(items: items, store: store, now: context.date)
                                Text("Mantén pulsada una toma para omitirla o deshacerla.")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        if let report = store.adherence, !report.medications.isEmpty { AdherenceSection(report: report) }
                        medicationsCard
                        MedicationHistoryCard(store: store)
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 24)
                }
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Medicación")
        .navigationSubtitle(subtitle)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Importar desde Salud", systemImage: "heart.text.square") { importing = true }
                } label: {
                    Image(systemName: "ellipsis")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Medicamento", systemImage: MedicationKind.medicamento.symbol) { editing = .new(.medicamento) }
                    Button("Suplemento", systemImage: MedicationKind.suplemento.symbol) { editing = .new(.suplemento) }
                } label: {
                    Label("Añadir", systemImage: "plus")
                }
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
        .animation(.snappy, value: store.nudges)
        .sheet(item: $editing) { target in
            switch target {
            case let .new(kind): MedicationEditor(store: store, medication: nil, kind: kind)
            case let .existing(med): MedicationEditor(store: store, medication: med)
            case let .suggested(med, nudge): MedicationEditor(store: store, medication: med, suggestion: nudge)
            }
        }
        .sheet(isPresented: $importing) { HealthMedicationImport(store: store) }
    }

    // MARK: Sections

    /// What you take, medicines then supplements, in one card; a row opens its editor.
    private var medicationsCard: some View {
        Card {
            CardTitle(text: "Lo que tomas", systemImage: "list.bullet")
            LowStockNote(medications: store.lowStock)
            ForEach(MedicationKind.allCases) { kind in
                let meds = store.medications.filter { $0.kind == kind }
                if !meds.isEmpty {
                    Text(kind == .medicamento ? "MEDICAMENTOS" : "SUPLEMENTOS")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(.top, 4)
                    ForEach(meds) { med in
                        Button { editing = .existing(med) } label: { MedicationRow(medication: med) }
                            .buttonStyle(.plain)
                        if med.id != meds.last?.id { Divider().padding(.leading, 46) }
                    }
                }
            }
        }
    }

    /// "2 medicamentos · 3 suplementos"
    private var subtitle: String {
        let meds = store.medications.count { $0.kind == .medicamento && $0.active }
        let supplements = store.medications.count { $0.kind == .suplemento && $0.active }
        let parts = [
            meds > 0 ? "\(meds) \(meds == 1 ? "medicamento" : "medicamentos")" : nil,
            supplements > 0 ? "\(supplements) \(supplements == 1 ? "suplemento" : "suplementos")" : nil,
        ].compactMap { $0 }
        return parts.isEmpty ? "y suplementos" : parts.joined(separator: " · ")
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
            Button("Añadir medicamento", systemImage: MedicationKind.medicamento.symbol) { editing = .new(.medicamento) }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
            Button("Añadir suplemento", systemImage: MedicationKind.suplemento.symbol) { editing = .new(.suplemento) }
                .buttonStyle(.glass)
                .controlSize(.large)
            Button("Importar desde Salud", systemImage: "heart.text.square") { importing = true }
                .buttonStyle(.glass)
        }
        .padding(32)
        .padding(.top, 60)
    }
}

/// What is left today, never a ratio mixing scheduled and as-needed doses: the
/// ring is today's scheduled doses settled; the middle, how many are left.
private struct MedicationHero: View {
    let items: [TodayItem]
    let streak: Int

    private var left: [TodayItem] { items.filter(\.isLeft) }
    private var slots: [TodayItem] { items.filter { $0.slot != nil } }
    /// Taken today by the clock: "Levotiroxina 9:56".
    private var taken: [(name: String, at: String)] {
        items.flatMap { item -> [(name: String, at: String)] in
            if item.state == .tomada { return [(item.medication.name, item.at ?? "")] }
            if item.state == .aDemanda {
                return item.intakes.map { (item.medication.name, $0.takenAt.map { LocalClock.time(Date(timeIntervalSince1970: $0 / 1000)) } ?? "") }
            }
            return []
        }
        .sorted { $0.at < $1.at }
    }
    private var free: Bool { slots.isEmpty && taken.isEmpty }
    private var done: Bool { left.isEmpty && !free }

    private var progress: Double {
        if slots.isEmpty { return taken.isEmpty ? 0 : 1 }
        return Double(slots.count { $0.state == .tomada || $0.state == .omitida }) / Double(slots.count)
    }

    private var headline: String {
        if !left.isEmpty {
            var seen = Set<String>()
            let names = left.map(\.medication.name).filter { seen.insert($0).inserted }
            return "Te falta: \(names.formatted(.list(type: .and)))"
        }
        return free ? "Hoy no te toca nada" : "Todo listo por hoy"
    }

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle().stroke((done ? Theme.good : Color.accentColor).opacity(0.15), lineWidth: 18)
                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(
                        done ? AnyShapeStyle(Theme.good.gradient) : AnyShapeStyle(AngularGradient(colors: [Color.accentColor, Theme.good], center: .center)),
                        style: StrokeStyle(lineWidth: 18, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 2) {
                    if left.isEmpty {
                        Image(systemName: free ? "moon.zzz.fill" : "checkmark")
                            .font(.system(size: 48, weight: .bold))
                            .foregroundStyle(free ? AnyShapeStyle(.secondary) : AnyShapeStyle(Theme.good))
                            .symbolEffect(.bounce, value: done)
                        Text(free ? "Libre" : "Listo").font(.subheadline).foregroundStyle(.secondary)
                    } else {
                        Text("\(left.count)")
                            .font(.system(size: 58, weight: .bold, design: .rounded))
                            .contentTransition(.numericText(value: Double(left.count)))
                        Text("por tomar").font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            }
            .frame(width: 184, height: 184)
            .animation(.snappy, value: progress)
            .sensoryFeedback(.success, trigger: done) { _, now in now }

            Text(headline)
                .font(.title3.weight(.semibold))
                .multilineTextAlignment(.center)
                .foregroundStyle(done ? AnyShapeStyle(Theme.good) : AnyShapeStyle(.primary))
                .contentTransition(.opacity)

            if !left.isEmpty {
                // One capsule per dose still to take, with when.
                FlowChips(items: left)
            }
            if !taken.isEmpty {
                Text("Tomado hoy: " + taken.map { "\($0.name) \(LocalClock.display($0.at))" }.joined(separator: " · "))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            if streak > 1 && !left.contains(where: { $0.state == .atrasada }) {
                Label("\(streak) días seguidos sin fallar", systemImage: "flame.fill")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.energy)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .padding(.horizontal)
    }
}

/// The doses still to take as glass capsules: "Omega 3 · era a las 17:30".
private struct FlowChips: View {
    let items: [TodayItem]

    var body: some View {
        // Up to three side by side when they fit, else stacked.
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { chips }
            VStack(spacing: 8) { chips }
        }
    }

    private var chips: some View {
        ForEach(items) { item in
            HStack(spacing: 5) {
                if item.state == .entreno { Image(systemName: "figure.strengthtraining.traditional").foregroundStyle(Theme.training) }
                if item.state == .atrasada { Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Theme.caution) }
                Text(item.medication.name).fontWeight(.semibold)
                Text("· \(when(item))").foregroundStyle(item.state == .atrasada ? AnyShapeStyle(Theme.caution) : AnyShapeStyle(.secondary))
            }
            .font(.footnote)
            .lineLimit(1)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .glassEffect(.regular.tint(item.state == .atrasada ? Theme.caution.opacity(0.18) : nil), in: .capsule)
        }
    }

    private func when(_ item: TodayItem) -> String {
        switch item.state {
        case .entreno: "al terminar de entrenar"
        case .atrasada: "era a las \(item.at.map(LocalClock.display) ?? "")"
        case .ahora: "ahora"
        default: "a las \(item.at.map(LocalClock.display) ?? "")"
        }
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
                // Low stock gets an exclamation as well as the warm tint.
                HStack(spacing: 3) {
                    if medication.lowStock { Image(systemName: "exclamationmark.triangle.fill").imageScale(.small) }
                    Text("\(Int(stock))")
                }
                    .font(.subheadline.weight(.semibold))
                    .fontDesign(.rounded)
                    .monospacedDigit()
                    .lineLimit(1)
                    .layoutPriority(1)
                    .foregroundStyle(medication.lowStock ? Theme.caution : .secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background((medication.lowStock ? Theme.caution : Color.secondary).opacity(0.12), in: .capsule)
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
            parts.append(medication.schedule.line)
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

    /// "jueves"
    static func long(_ day: Int) -> String { names[max(1, min(7, day)) - 1] }
}

#Preview("Medicación · 375 pt · XXL") {
    let slot = DoseSlot(medicationId: "1", name: "Vitamina D3 + K2 2000 UI con aceite de oliva", kind: .suplemento, dose: 2, unit: "comprimidos",
                        instructions: "Con la comida principal", date: LocalClock.date(.now), slot: "21:30", time: "21:30", status: .pendiente)
    let creatine = DoseSlot(medicationId: "2", name: "Creatina", kind: .suplemento, dose: 5, unit: "g", date: LocalClock.date(.now), slot: "entreno",
                            moment: .entreno, time: nil, training: TrainingSlot(state: .planned, plannedAt: "18:00", fallback: "20:00"), status: .pendiente)
    let med = Medication(id: "1", name: slot.name, kind: .suplemento, dose: 2, unit: "comprimidos", instructions: "Con la comida principal",
                         schedule: MedicationSchedule(asNeeded: false, times: ["08:00", "14:00", "21:30"], days: [1, 3, 5]),
                         startDate: "2026-09-01", stock: 4, lowStockThreshold: 7, lowStock: true, active: true)
    return NarrowPreview(dynamicType: .xxLarge) {
        Card {
            DoseGroupsView(slots: [slot, creatine], store: .shared)
            DoseGroupsView(slots: [slot, creatine], store: .shared, compact: true)
        }
        Card { MedicationRow(medication: med) }
    }
}
