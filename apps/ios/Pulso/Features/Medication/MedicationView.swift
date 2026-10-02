import SwiftUI

/// Full medication screen, pushed from `MedicationTodayCard`: a compact hero
/// of today, schedule suggestions, today in sections, constancy, what you take
/// and the history.
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
        ScrollView {
            if store.loaded && store.medications.isEmpty {
                emptyState
            } else {
                // Rebuilt each minute so «Toca ahora» / «Se pasó» follow the clock.
                TimelineView(.everyMinute) { context in
                    let items = TodayItem.build(medications: store.medications, day: store.day, history: store.history, now: context.date)
                    VStack(spacing: 16) {
                        TodayOverview(
                            items: items,
                            usual: TodayItem.usual(items, nudges: store.nudges, history: store.history, now: context.date),
                            streak: store.adherence?.overall.currentStreak ?? 0,
                            nudges: store.nudges,
                            store: store
                        ) { nudge in
                            if let med = store.medications.first(where: { $0.id == nudge.medicationId }) { editing = .suggested(med, nudge) }
                        }
                        if let report = store.adherence, !report.medications.isEmpty { AdherenceSection(report: report) }
                        medicationsCard
                        MedicationHistoryCard(store: store)
                    }
                    .padding(.horizontal)
                }
            }
        }
        // On top of the safe area, so the first card clears the bar and the last the tab bar.
        .contentMargins(.top, 8, for: .scrollContent)
        .contentMargins(.bottom, 32, for: .scrollContent)
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

/// Today on the Medicación screen: the hero, schedule suggestions and today's sections.
struct TodayOverview: View {
    let items: [TodayItem]
    /// As-needed meds taken most days and not yet today (`TodayItem.usual`).
    let usual: [String]
    let streak: Int
    let nudges: [ScheduleNudge]
    let store: MedicationStore
    let accept: (ScheduleNudge) -> Void

    var body: some View {
        MedicationHero(items: items, usual: usual, streak: streak)
        if !nudges.isEmpty { ScheduleNudgesCard(nudges: nudges, store: store, accept: accept) }
        TodaySections(items: items, store: store)
    }
}

/// Today at a glance in one compact card. With doses scheduled, a small ring of those settled
/// (never a ratio mixing in as-needed doses) beside what is left; with none, a quiet state that
/// still names the as-needed meds taken most days, so it never claims there is nothing to take.
private struct MedicationHero: View {
    let items: [TodayItem]
    let usual: [String]
    let streak: Int

    @ScaledMetric(relativeTo: .title3) private var size: CGFloat = 64

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
        if done { return "Todo listo por hoy" }
        return usual.isEmpty ? "Nada pendiente hoy" : "Nada programado"
    }

    /// "Levotiroxina cuando la tomes"
    private var usualLine: String? {
        guard !usual.isEmpty else { return nil }
        return "\(usual.formatted(.list(type: .and))) cuando \(usual.count == 1 ? "la" : "las") tomes"
    }

    var body: some View {
        Card {
            HStack(spacing: 16) {
                badge.frame(width: size, height: size)
                VStack(alignment: .leading, spacing: 4) {
                    Text(headline)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(done ? AnyShapeStyle(Theme.good) : AnyShapeStyle(.primary))
                        .contentTransition(.opacity)
                    if let usualLine {
                        Text(usualLine).font(.subheadline).foregroundStyle(.secondary)
                    }
                    if !taken.isEmpty {
                        Text("Tomado hoy: " + taken.map { "\($0.name) \(LocalClock.display($0.at))" }.joined(separator: " · "))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    if streak > 1 && !left.contains(where: { $0.state == .atrasada }) {
                        Label("\(streak) días seguidos sin fallar", systemImage: "flame.fill")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Theme.energy)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .accessibilityElement(children: .combine)
        .animation(.snappy, value: progress)
        .sensoryFeedback(.success, trigger: done) { _, now in now }
    }

    @ViewBuilder private var badge: some View {
        if free {
            Image(systemName: "calendar.badge.checkmark")
                .font(.title2)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.secondary.opacity(0.12), in: .circle)
        } else {
            ZStack {
                Circle().stroke((done ? Theme.good : Color.accentColor).opacity(0.15), lineWidth: 8)
                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(
                        done ? AnyShapeStyle(Theme.good.gradient) : AnyShapeStyle(AngularGradient(colors: [Color.accentColor, Theme.good], center: .center)),
                        style: StrokeStyle(lineWidth: 8, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                if left.isEmpty {
                    Image(systemName: "checkmark")
                        .font(.title2.weight(.bold))
                        .foregroundStyle(Theme.good)
                        .symbolEffect(.bounce, value: done)
                } else {
                    Text("\(left.count)")
                        .font(.title.weight(.bold))
                        .fontDesign(.rounded)
                        .contentTransition(.numericText(value: Double(left.count)))
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .accessibilityLabel("\(left.count) por tomar")
                }
            }
            .padding(4)
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

/// The person's Friday 2 Oct: Levotiroxina as needed but taken daily (last yesterday), Creatina after
/// training on a rest day, Semaglutida weekly on Thursday at any time, and the daily suggestion.
private enum MedicationSample {
    static let today = "2026-10-02"
    static let now = LocalClock.instant(date: today, time: "10:30")!

    static func med(_ name: String, _ kind: MedicationKind, _ dose: Double, _ unit: String, _ schedule: MedicationSchedule) -> Medication {
        Medication(id: name, name: name, kind: kind, dose: dose, unit: unit, instructions: nil, schedule: schedule,
                   startDate: "2026-09-01", stock: nil, lowStockThreshold: nil, lowStock: false, active: true)
    }

    static let medications = [
        med("Levotiroxina", .medicamento, 1, "comprimido", .asNeededOnly),
        med("Creatina", .suplemento, 5, "g", MedicationSchedule(asNeeded: false, times: [], days: [], training: TrainingRule(restDayTime: nil))),
        med("Semaglutida", .medicamento, 1, "mg", MedicationSchedule(asNeeded: false, times: [], days: [4], anyTime: true, reminder: "19:00")),
    ]
    static let history = (1...6).map { ago in
        let day = LocalClock.date(Calendar.current.date(byAdding: .day, value: -ago, to: now)!)
        return DoseEvent(id: "levo-\(ago)", medicationId: "Levotiroxina", date: day, scheduledTime: nil, status: .tomada,
                         takenAt: LocalClock.instant(date: day, time: "09:5\(ago)").map { $0.timeIntervalSince1970 * 1000 })
    }
    static let nudge = ScheduleNudge(medicationId: "Levotiroxina", name: "Levotiroxina", cadence: .daily,
                                     title: "Levotiroxina parece diaria. ¿Ponerle horario?", detail: "En ayunas al despertar · 09:55",
                                     schedule: MedicationSchedule(asNeeded: false, times: ["09:55"], days: []), instructions: "en ayunas")

    /// Plus a long-named supplement still to take and a missed morning dose, for the rows under pressure.
    static let busy: [Medication] = medications + [
        med("Vitamina D3 + K2 2000 UI con aceite de oliva", .suplemento, 2, "comprimidos", MedicationSchedule(asNeeded: false, times: ["21:30"], days: [])),
        med("Magnesio", .suplemento, 1, "cápsula", MedicationSchedule(asNeeded: false, times: ["08:00"], days: [])),
    ]
    static let busyDay = MedicationDay(date: today, slots: [
        DoseSlot(medicationId: "Magnesio", name: "Magnesio", kind: .suplemento, dose: 1, unit: "cápsula", date: today, slot: "08:00", time: "08:00", status: .pendiente),
        DoseSlot(medicationId: "Vitamina D3 + K2 2000 UI con aceite de oliva", name: "Vitamina D3 + K2 2000 UI con aceite de oliva", kind: .suplemento,
                 dose: 2, unit: "comprimidos", date: today, slot: "21:30", time: "21:30", status: .pendiente),
    ], asNeeded: [], next: nil)
}

/// The top of the screen as the person sees it, inside a navigation bar.
private struct MedicationSampleScreen: View {
    var width: CGFloat = 375
    var medications = MedicationSample.medications
    var day = MedicationDay(date: MedicationSample.today, slots: [], asNeeded: [], next: nil)

    var body: some View {
        let items = TodayItem.build(medications: medications, day: day, history: MedicationSample.history, now: MedicationSample.now)
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    TodayOverview(items: items,
                                  usual: TodayItem.usual(items, nudges: [MedicationSample.nudge], history: MedicationSample.history, now: MedicationSample.now),
                                  streak: 0, nudges: [MedicationSample.nudge], store: .shared) { _ in }
                }
                .padding(.horizontal)
            }
            .contentMargins(.top, 8, for: .scrollContent)
            .contentMargins(.bottom, 32, for: .scrollContent)
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Medicación")
            .navigationSubtitle("2 medicamentos · 1 suplemento")
        }
        .frame(width: width)
    }
}

#Preview("Medicación · viernes · 375 pt · XXL · oscuro") {
    MedicationSampleScreen(width: 375)
        .dynamicTypeSize(.xxLarge)
        .preferredColorScheme(.dark)
}

#Preview("Medicación · viernes · 440 pt · claro") {
    MedicationSampleScreen(width: 440)
        .preferredColorScheme(.light)
}

#Preview("Medicación · con tomas · 375 pt · XXL") {
    MedicationSampleScreen(width: 375, medications: MedicationSample.busy, day: MedicationSample.busyDay)
        .dynamicTypeSize(.xxLarge)
}
