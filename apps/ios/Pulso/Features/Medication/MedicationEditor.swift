import SwiftUI

/// Add/edit sheet. The schedule picker speaks in moments of the day and
/// weekday letters rather than raw times.
struct MedicationEditor: View {
    let store: MedicationStore
    let medication: Medication?

    @Environment(\.dismiss) private var dismiss
    @State private var draft = MedicationDraft()
    @State private var saving = false
    @State private var confirmDelete = false

    private static let forms = ["comprimido", "cápsula", "gotas", "jarabe", "polvo", "sobre", "inyección", "inhalador", "crema", "parche", "spray"]
    private static let instructionPresets = ["Con comida", "En ayunas", "Antes de dormir", "Con agua"]
    private static let moments = [("Mañana", "08:00", "sunrise"), ("Mediodía", "14:00", "sun.max"), ("Tarde", "18:00", "sun.haze"), ("Noche", "22:00", "moon.stars")]

    init(store: MedicationStore, medication: Medication?) {
        self.store = store
        self.medication = medication
        _draft = State(initialValue: medication.map(MedicationDraft.init) ?? MedicationDraft())
    }

    var body: some View {
        NavigationStack {
            Form {
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
            .navigationTitle(medication == nil ? "Nueva" : draft.name)
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
        }
    }

    private var valid: Bool {
        !draft.name.trimmingCharacters(in: .whitespaces).isEmpty && draft.dose > 0
            && !draft.unit.trimmingCharacters(in: .whitespaces).isEmpty
            && (draft.schedule.asNeeded || !draft.schedule.times.isEmpty)
    }

    // MARK: Sections

    private var basics: some View {
        Section {
            TextField("Nombre (p. ej. Vitamina D)", text: $draft.name)
                .font(.title3.weight(.semibold))
                .textInputAutocapitalization(.words)
            Picker("Tipo", selection: $draft.kind) {
                ForEach(MedicationKind.allCases) { Label($0.label, systemImage: $0.symbol).tag($0) }
            }
            .pickerStyle(.segmented)
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
                    .frame(maxWidth: 110)
                    .foregroundStyle(.secondary)
            }
            Picker("Forma", selection: optional($draft.form)) {
                Text("Sin especificar").tag("")
                ForEach(Self.forms, id: \.self) { Text($0.capitalized).tag($0) }
            }
        }
    }

    private var schedule: some View {
        Section {
            Picker("Cuándo", selection: $draft.schedule.asNeeded) {
                Text("Horario fijo").tag(false)
                Text("Cuando haga falta").tag(true)
            }
            .pickerStyle(.segmented)
            .onChange(of: draft.schedule.asNeeded) { _, asNeeded in
                if !asNeeded && draft.schedule.times.isEmpty { draft.schedule.times = ["08:00"] }
            }

            if !draft.schedule.asNeeded {
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
                            let on = draft.schedule.times.contains(moment.1)
                            Button {
                                withAnimation(.snappy) { toggleTime(moment.1) }
                            } label: {
                                Label(moment.0, systemImage: moment.2)
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
                WeekdayPicker(days: $draft.schedule.days)
            }
        } header: {
            Text("Horario")
        } footer: {
            if !draft.schedule.asNeeded { Text("Te avisamos en cada toma, con «Tomada» y «Posponer» en la notificación.") }
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
                        let on = draft.instructions == preset
                        Button(preset) { draft.instructions = on ? nil : preset }
                            .font(.subheadline)
                            .buttonStyle(.plain)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .foregroundStyle(on ? Color.white : Color.primary)
                            .background(on ? Color.accentColor : Color.secondary.opacity(0.12), in: .capsule)
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
