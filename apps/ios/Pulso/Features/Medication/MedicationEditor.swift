import SwiftUI

/// Add/edit sheet. The schedule picker speaks in moments of the day (fixed
/// times, after training, with a meal, before bed) rather than raw times.
struct MedicationEditor: View {
    let store: MedicationStore
    let medication: Medication?

    @Environment(\.dismiss) private var dismiss
    @State private var draft = MedicationDraft()
    @State private var saving = false
    @State private var confirmDelete = false
    @State private var preset: SupplementPreset.ID?

    private static let instructionPresets = ["Con comida", "En ayunas", "Antes de dormir", "Con agua"]
    private static let moments = [("Mañana", "08:00", "sunrise"), ("Mediodía", "14:00", "sun.max"), ("Tarde", "18:00", "sun.haze"), ("Noche", "22:00", "moon.stars")]
    private static let windows = [30, 45, 60, 90]

    init(store: MedicationStore, medication: Medication?, kind: MedicationKind = .medicamento) {
        self.store = store
        self.medication = medication
        var draft = medication.map(MedicationDraft.init) ?? MedicationDraft()
        if medication == nil && kind == .suplemento { draft.adopt(kind: .suplemento) }
        _draft = State(initialValue: draft)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Tipo", selection: Binding(get: { draft.kind }, set: { draft.adopt(kind: $0) })) {
                        ForEach(MedicationKind.allCases) { Label($0.label, systemImage: $0.symbol).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                if medication == nil && draft.kind == .suplemento { presets }
                basics
                schedule
                stock
                details
                if medication != nil {
                    Section {
                        Button("Eliminar", role: .destructive) { confirmDelete = true }
                    } footer: {
                        Text("Para dejar de tomarlo sin perder el historial, ponle una fecha de fin o pásalo a pausa.")
                    }
                }
            }
            .navigationTitle(medication == nil ? (draft.kind == .suplemento ? "Nuevo suplemento" : "Nuevo medicamento") : draft.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar", role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar", role: .confirm) { Task { await save() } }
                        .disabled(!valid || saving)
                }
            }
            .confirmationDialog("¿Eliminar \(draft.name) y su historial?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Eliminar", role: .destructive) {
                    guard let id = medication?.id else { return }
                    Task {
                        await store.delete(id)
                        dismiss()
                    }
                }
            }
            .sensoryFeedback(.selection, trigger: draft.schedule)
            .animation(.snappy, value: draft.schedule)
            .animation(.snappy, value: draft.kind)
        }
    }

    private var valid: Bool {
        !draft.name.trimmingCharacters(in: .whitespaces).isEmpty && draft.dose > 0
            && !draft.unit.trimmingCharacters(in: .whitespaces).isEmpty
            && (draft.schedule.asNeeded || draft.schedule.hasSlots)
    }

    // MARK: Sections

    /// One tap fills a common supplement with sensible defaults.
    private var presets: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(SupplementPreset.all) { item in
                        let on = preset == item.id
                        Button {
                            withAnimation(.snappy) {
                                preset = item.id
                                item.apply(to: &draft)
                            }
                        } label: {
                            Label(item.name, systemImage: item.symbol)
                                .font(.subheadline.weight(.medium))
                                .padding(.horizontal, 12)
                                .padding(.vertical, 7)
                                .foregroundStyle(on ? Color.white : Color.primary)
                                .background(on ? Color.accentColor : Color.secondary.opacity(0.12), in: .capsule)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .sensoryFeedback(.selection, trigger: preset)
        } header: {
            Text("Habituales")
        } footer: {
            if let item = SupplementPreset.all.first(where: { $0.id == preset }) { Text(item.summary) }
        }
    }

    private var basics: some View {
        Section {
            TextField(draft.kind == .suplemento ? "Nombre (p. ej. Creatina)" : "Nombre (p. ej. Ibuprofeno)", text: $draft.name)
                .font(.title3.weight(.semibold))
                .textInputAutocapitalization(.words)
            HStack {
                Text("Dosis")
                Spacer()
                TextField("1", value: $draft.dose, format: .number)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .fontDesign(.rounded)
                    .frame(maxWidth: 80)
                TextField("unidad", text: $draft.unit)
                    .textInputAutocapitalization(.never)
                    .frame(maxWidth: 96)
                    .foregroundStyle(.secondary)
                Menu {
                    ForEach(draft.kind.units, id: \.self) { unit in
                        Button(unit) { draft.unit = unit }
                    }
                } label: {
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel("Elegir unidad")
            }
            Picker("Forma", selection: optional($draft.form)) {
                Text("Sin especificar").tag("")
                ForEach(forms, id: \.self) { Text($0.capitalized).tag($0) }
            }
        }
    }

    /// The kind's forms, plus the current one if it came from elsewhere (Health, the Coach).
    private var forms: [String] {
        let list = draft.kind.forms
        guard let form = draft.form, !list.contains(form) else { return list }
        return list + [form]
    }

    private var schedule: some View {
        Section {
            Picker("Cuándo", selection: Binding(get: { draft.schedule.type }, set: { draft.schedule.become($0) })) {
                ForEach(ScheduleType.allCases) { Label($0.label, systemImage: $0.symbol).tag($0) }
            }

            switch draft.schedule.type {
            case .fixed: fixedTimes
            case .training: trainingRule
            case .meal: mealPicker
            case .bedtime, .asNeeded: EmptyView()
            }
            if !draft.schedule.asNeeded { WeekdayPicker(days: $draft.schedule.days) }
        } header: {
            Text("Horario")
        } footer: {
            scheduleFooter
        }
    }

    @ViewBuilder private var fixedTimes: some View {
        ForEach(draft.schedule.times.indices, id: \.self) { index in
            DatePicker(timeLabel(draft.schedule.times[index]), selection: timeBinding(index), displayedComponents: .hourAndMinute)
                .swipeActions {
                    if draft.schedule.times.count > 1 {
                        Button("Quitar", role: .destructive) { draft.schedule.times.remove(at: index) }
                    }
                }
        }
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Self.moments, id: \.1) { moment in
                    Chip(title: moment.0, systemImage: moment.2, on: draft.schedule.times.contains(moment.1)) {
                        withAnimation(.snappy) { toggleTime(moment.1) }
                    }
                }
            }
        }
    }

    @ViewBuilder private var trainingRule: some View {
        let rule = draft.schedule.training ?? TrainingRule()
        VStack(alignment: .leading, spacing: 8) {
            Text("Tomar dentro de")
            Picker("Tomar dentro de", selection: trainingBinding(\.withinMinutes)) {
                ForEach(Self.windows.contains(rule.withinMinutes) ? Self.windows : (Self.windows + [rule.withinMinutes]).sorted(), id: \.self) {
                    Text("\($0) min").tag($0)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
        }
        .padding(.vertical, 2)
        Picker("En días sin entreno", selection: Binding(
            get: { rule.restDayTime != nil },
            set: { draft.schedule.training?.restDayTime = $0 ? "09:00" : nil }
        )) {
            Text("A una hora").tag(true)
            Text("No tomar").tag(false)
        }
        if let rest = rule.restDayTime {
            DatePicker("A las", selection: Binding(
                get: { LocalClock.instant(date: LocalClock.date(.now), time: rest) ?? .now },
                set: { draft.schedule.training?.restDayTime = LocalClock.time($0) }
            ), displayedComponents: .hourAndMinute)
        }
    }

    private var mealPicker: some View {
        HStack(spacing: 8) {
            ForEach(DoseMeal.allCases) { meal in
                Chip(title: meal.label, systemImage: meal.symbol, on: draft.schedule.meals.contains(meal)) {
                    withAnimation(.snappy) { toggleMeal(meal) }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var scheduleFooter: some View {
        switch draft.schedule.type {
        case .fixed:
            Text("Te avisamos en cada toma, con «Tomada» y «Posponer» en la notificación.")
        case .training:
            Text(draft.schedule.training?.restDayTime == nil
                 ? "Te avisamos al terminar tu entreno, en Pulso o en Salud. Los días sin entreno no cuenta."
                 : "Te avisamos al terminar tu entreno, en Pulso o en Salud. Si ese día no entrenas, a la hora que elijas.")
        case .meal:
            Text("A la hora de cada comida de tu calendario.")
        case .bedtime:
            Text("Media hora antes de tu hora de dormir.")
        case .asNeeded:
            Text("Sin recordatorios: anota cada toma con «Tomé una».")
        }
        if draft.schedule.isMixed {
            Text("Este horario combina varios momentos; cambiar «Cuándo» lo reemplaza.")
        }
    }

    private var stock: some View {
        Section {
            Toggle("Llevar la cuenta de existencias", isOn: Binding(
                get: { draft.stock != nil },
                set: { on in
                    draft.stock = on ? (draft.stock ?? 30) : nil
                    draft.lowStockThreshold = on ? (draft.lowStockThreshold ?? 7) : nil
                }
            ))
            if let current = draft.stock {
                Stepper(value: Binding(get: { current }, set: { draft.stock = $0 }), in: 0...10_000) {
                    LabeledContent("Quedan", value: "\(Int(current)) dosis")
                }
                Stepper(value: Binding(get: { draft.lowStockThreshold ?? 0 }, set: { draft.lowStockThreshold = $0 }), in: 0...100) {
                    LabeledContent("Avisar con", value: "\(Int(draft.lowStockThreshold ?? 0)) o menos")
                }
            }
        } header: {
            Text("Existencias")
        } footer: {
            if draft.stock != nil { Text("Cada toma marcada como tomada descuenta una dosis.") }
        }
    }

    private var details: some View {
        Section("Detalles") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Self.instructionPresets, id: \.self) { preset in
                        Chip(title: preset, on: draft.instructions == preset) {
                            draft.instructions = draft.instructions == preset ? nil : preset
                        }
                    }
                }
            }
            TextField("Indicaciones", text: optional($draft.instructions), axis: .vertical)
            DatePicker("Desde", selection: dateBinding(\.startDate), displayedComponents: .date)
            Toggle("Hasta una fecha", isOn: Binding(
                get: { draft.endDate != nil },
                set: { draft.endDate = $0 ? LocalClock.date(Calendar.current.date(byAdding: .day, value: 30, to: .now)!) : nil }
            ))
            if draft.endDate != nil {
                DatePicker("Hasta", selection: Binding(
                    get: { draft.endDate.flatMap(LocalClock.day) ?? .now },
                    set: { draft.endDate = LocalClock.date($0) }
                ), in: (LocalClock.day(draft.startDate) ?? .distantPast)..., displayedComponents: .date)
            }
            Toggle("Activo", isOn: $draft.active)
            TextField("Notas", text: optional($draft.notes), axis: .vertical)
        }
    }

    // MARK: Helpers

    private func save() async {
        saving = true
        defer { saving = false }
        if await store.save(draft, id: medication?.id) { dismiss() }
    }

    private func toggleTime(_ time: String) {
        if let index = draft.schedule.times.firstIndex(of: time) {
            if draft.schedule.times.count > 1 { draft.schedule.times.remove(at: index) }
        } else {
            draft.schedule.times.append(time)
            draft.schedule.times.sort()
        }
    }

    /// At least one meal stays on.
    private func toggleMeal(_ meal: DoseMeal) {
        if let index = draft.schedule.meals.firstIndex(of: meal) {
            if draft.schedule.meals.count > 1 { draft.schedule.meals.remove(at: index) }
        } else {
            draft.schedule.meals = DoseMeal.allCases.filter { draft.schedule.meals.contains($0) || $0 == meal }
        }
    }

    private func timeLabel(_ time: String) -> String {
        let hour = Int(time.prefix(2)) ?? 0
        switch hour {
        case 5..<12: return "Mañana"
        case 12..<16: return "Mediodía"
        case 16..<21: return "Tarde"
        default: return "Noche"
        }
    }

    private func timeBinding(_ index: Int) -> Binding<Date> {
        Binding(
            get: {
                guard draft.schedule.times.indices.contains(index) else { return .now }
                return LocalClock.instant(date: LocalClock.date(.now), time: draft.schedule.times[index]) ?? .now
            },
            set: { newValue in
                guard draft.schedule.times.indices.contains(index) else { return }
                draft.schedule.times[index] = LocalClock.time(newValue)
            }
        )
    }

    private func trainingBinding<Value>(_ keyPath: WritableKeyPath<TrainingRule, Value>) -> Binding<Value> {
        Binding(
            get: { (draft.schedule.training ?? TrainingRule())[keyPath: keyPath] },
            set: { draft.schedule.training?[keyPath: keyPath] = $0 }
        )
    }

    private func dateBinding(_ keyPath: WritableKeyPath<MedicationDraft, String>) -> Binding<Date> {
        Binding(
            get: { LocalClock.day(draft[keyPath: keyPath]) ?? .now },
            set: { draft[keyPath: keyPath] = LocalClock.date($0) }
        )
    }

    /// Edits an optional string as plain text; empty means nil.
    private func optional(_ binding: Binding<String?>) -> Binding<String> {
        Binding(get: { binding.wrappedValue ?? "" }, set: { binding.wrappedValue = $0.isEmpty ? nil : $0 })
    }
}

/// A selectable capsule for quick picks inside a form row.
private struct Chip: View {
    let title: String
    var systemImage: String?
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if let systemImage { Label(title, systemImage: systemImage) } else { Text(title) }
            }
            .font(.subheadline.weight(.medium))
            .lineLimit(1)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .foregroundStyle(on ? Color.white : Color.primary)
            .background(on ? Color.accentColor : Color.secondary.opacity(0.12), in: .capsule)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

// MARK: - Schedule types

/// The editor's "Cuándo": which part of `MedicationSchedule` the person edits.
enum ScheduleType: String, CaseIterable, Identifiable {
    case fixed, training, meal, bedtime, asNeeded
    var id: String { rawValue }

    var label: String {
        switch self {
        case .fixed: "A horas fijas"
        case .training: "Después de entrenar"
        case .meal: "Con una comida"
        case .bedtime: "Antes de dormir"
        case .asNeeded: "Cuando haga falta"
        }
    }

    var symbol: String {
        switch self {
        case .fixed: "clock"
        case .training: "figure.strengthtraining.traditional"
        case .meal: "fork.knife"
        case .bedtime: "bed.double.fill"
        case .asNeeded: "hand.tap"
        }
    }
}

extension MedicationSchedule {
    /// The editor's view of it. A mixed schedule (from the Coach) shows its first part.
    var type: ScheduleType {
        if asNeeded { return .asNeeded }
        if training != nil { return .training }
        if !meals.isEmpty { return .meal }
        if bedtime { return .bedtime }
        return .fixed
    }

    /// More than one kind of slot, which the editor shows only one of.
    var isMixed: Bool {
        !asNeeded && [!times.isEmpty, training != nil, !meals.isEmpty, bedtime].count { $0 } > 1
    }

    /// Switches to `type`, keeping weekdays and starting it with a sensible default.
    mutating func become(_ type: ScheduleType) {
        guard type != self.type || isMixed else { return }
        let keep = (training, meals, times)
        self = MedicationSchedule(asNeeded: type == .asNeeded, times: [], days: type == .asNeeded ? [] : days)
        switch type {
        case .fixed: times = keep.2.isEmpty ? ["08:00"] : keep.2
        case .training: training = keep.0 ?? TrainingRule()
        case .meal: meals = keep.1.isEmpty ? [.desayuno] : keep.1
        case .bedtime: bedtime = true
        case .asNeeded: break
        }
    }
}

// MARK: - Kinds and presets

extension MedicationKind {
    /// Suggested units for the dose.
    var units: [String] {
        switch self {
        case .medicamento: ["comprimido", "cápsula", "mg", "ml", "gotas", "UI", "inhalación", "sobre"]
        case .suplemento: ["cápsula", "g", "cazo", "gomita", "comprimido", "mg", "UI", "ml"]
        }
    }

    var forms: [String] {
        switch self {
        case .medicamento: ["comprimido", "cápsula", "gotas", "jarabe", "polvo", "sobre", "inyección", "inhalador", "crema", "parche", "spray"]
        case .suplemento: ["polvo", "cápsula", "comprimido", "gomita", "líquido", "sobre", "barrita"]
        }
    }
}

extension MedicationDraft {
    /// Switching kind swaps in a unit that fits it, unless the person typed their own.
    mutating func adopt(kind: MedicationKind) {
        let suggested = self.kind.units.contains(unit)
        self.kind = kind
        if name.isEmpty || (suggested && !kind.units.contains(unit)) { unit = kind.units[0] }
    }
}

/// Common supplements with the schedule they're usually taken on.
struct SupplementPreset: Identifiable {
    var id: String { name }
    var name: String
    var symbol: String
    var dose: Double
    var unit: String
    var form: String
    var schedule: MedicationSchedule
    var instructions: String?

    var summary: String {
        let when: String = switch schedule.type {
        case .training:
            "después de entrenar" + (schedule.training?.restDayTime.map { "; los días sin entreno, a las \(LocalClock.display($0))" } ?? "; los días sin entreno, no")
        case .meal: schedule.meals.map(\.phrase).formatted(.list(type: .and))
        case .bedtime: "antes de dormir"
        default: schedule.times.map(LocalClock.display).formatted(.list(type: .and))
        }
        return "\(name): \(dose.formatted()) \(unit), \(when)."
    }

    func apply(to draft: inout MedicationDraft) {
        draft.kind = .suplemento
        draft.name = name
        draft.dose = dose
        draft.unit = unit
        draft.form = form
        draft.instructions = instructions
        draft.schedule = MedicationSchedule(asNeeded: false, times: schedule.times, days: draft.schedule.days,
                                            training: schedule.training, meals: schedule.meals, bedtime: schedule.bedtime)
    }

    static let all = [
        SupplementPreset(name: "Creatina", symbol: "bolt.fill", dose: 5, unit: "g", form: "polvo",
                         schedule: MedicationSchedule(asNeeded: false, times: [], days: [], training: TrainingRule(withinMinutes: 60, restDayTime: "09:00"))),
        SupplementPreset(name: "Proteína whey", symbol: "dumbbell.fill", dose: 1, unit: "cazo", form: "polvo",
                         schedule: MedicationSchedule(asNeeded: false, times: [], days: [], training: TrainingRule(withinMinutes: 60, restDayTime: nil))),
        SupplementPreset(name: "Vitamina D", symbol: "sun.max.fill", dose: 1000, unit: "UI", form: "cápsula",
                         schedule: MedicationSchedule(asNeeded: false, times: [], days: [], meals: [.desayuno])),
        SupplementPreset(name: "Omega 3", symbol: "drop.fill", dose: 1, unit: "cápsula", form: "cápsula",
                         schedule: MedicationSchedule(asNeeded: false, times: [], days: [], meals: [.comida])),
        SupplementPreset(name: "Magnesio", symbol: "moon.stars.fill", dose: 300, unit: "mg", form: "comprimido",
                         schedule: MedicationSchedule(asNeeded: false, times: [], days: [], bedtime: true)),
    ]
}

/// L M X J V S D toggles; none selected means every day.
private struct WeekdayPicker: View {
    @Binding var days: [Int]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                ForEach(1...7, id: \.self) { day in
                    let on = days.isEmpty || days.contains(day)
                    Button {
                        withAnimation(.snappy) { toggle(day) }
                    } label: {
                        Text(WeekdayNames.letters[day - 1])
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 36)
                            .foregroundStyle(on ? Color.white : Color.secondary)
                            .background(on ? Color.accentColor : Color.secondary.opacity(0.12), in: .circle)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(WeekdayNames.names[day - 1])
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            Text(days.isEmpty ? "Todos los días" : WeekdayNames.short(days))
                .font(.caption)
                .foregroundStyle(.secondary)
                .contentTransition(.opacity)
        }
        .padding(.vertical, 4)
    }

    private func toggle(_ day: Int) {
        var set = Set(days.isEmpty ? Array(1...7) : days)
        if set.contains(day) {
            guard set.count > 1 else { return }
            set.remove(day)
        } else {
            set.insert(day)
        }
        days = set.count == 7 ? [] : set.sorted()
    }
}
