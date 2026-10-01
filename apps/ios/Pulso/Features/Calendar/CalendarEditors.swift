import SwiftUI

/// Add/edit a busy block: a meeting, a shift, a trip. Saving re-plans training around it.
struct BusyBlockEditor: View {
    let store: CalendarStore
    let block: BusyBlock?

    @Environment(\.dismiss) private var dismiss
    @State private var draft: BusyBlockDraft
    @State private var severalDays: Bool
    @State private var repeats: Bool
    @State private var saving = false
    @State private var confirmDelete = false

    init(store: CalendarStore, block: BusyBlock?, date: Date = .now) {
        self.store = store
        self.block = block
        var draft = block.map(BusyBlockDraft.init) ?? BusyBlockDraft()
        if block == nil { draft.date = LocalClock.date(date) }
        _draft = State(initialValue: draft)
        _severalDays = State(initialValue: block?.endDate != nil)
        _repeats = State(initialValue: !(block?.weekdays.isEmpty ?? true))
    }

    private var readOnly: Bool { block?.source == "apple_calendar" }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Qué es (p. ej. Reunión, Viaje)", text: $draft.title)
                        .font(.title3.weight(.semibold))
                    Toggle("Todo el día", isOn: $draft.allDay.animation(.snappy))
                } footer: {
                    if readOnly { Text("Viene de tu Calendario de Apple: cámbialo allí.") }
                }
                Section("Cuándo") {
                    DatePicker(draft.allDay && severalDays ? "Desde" : "Día", selection: dateBinding(\.date), displayedComponents: .date)
                    if draft.allDay && !repeats {
                        Toggle("Varios días", isOn: $severalDays.animation(.snappy))
                        if severalDays {
                            DatePicker("Hasta", selection: optionalDate(\.endDate, fallback: draft.date), in: (LocalClock.day(draft.date) ?? .now)..., displayedComponents: .date)
                        }
                    }
                    if !draft.allDay {
                        DatePicker("Empieza", selection: timeBinding(\.start, fallback: "09:00"), displayedComponents: .hourAndMinute)
                        DatePicker("Termina", selection: timeBinding(\.end, fallback: "10:00"), displayedComponents: .hourAndMinute)
                    }
                }
                Section {
                    Toggle("Se repite cada semana", isOn: $repeats.animation(.snappy))
                    if repeats {
                        WeekdayPicker(selection: $draft.weekdays)
                        Toggle("Hasta una fecha", isOn: Binding(get: { draft.until != nil }, set: { draft.until = $0 ? draft.date : nil }).animation(.snappy))
                        if draft.until != nil {
                            DatePicker("Último día", selection: optionalDate(\.until, fallback: draft.date), in: (LocalClock.day(draft.date) ?? .now)..., displayedComponents: .date)
                        }
                    }
                }
                Section("Notas") {
                    TextField("Opcional", text: Binding(get: { draft.notes ?? "" }, set: { draft.notes = $0.isEmpty ? nil : $0 }), axis: .vertical)
                }
                if block != nil {
                    Section {
                        Button("Eliminar", role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .disabled(readOnly)
            .navigationTitle(block == nil ? "Ocupado" : draft.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar", role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar", role: .confirm) { Task { await save() } }
                        .disabled(!valid || saving || readOnly)
                }
            }
            .confirmationDialog("¿Eliminar \(draft.title)?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Eliminar", role: .destructive) {
                    guard let id = block?.id else { return }
                    Task {
                        await store.deleteBusy(id: id)
                        dismiss()
                    }
                }
            }
            .sensoryFeedback(.selection, trigger: draft.weekdays)
        }
    }

    private var valid: Bool {
        !draft.title.trimmingCharacters(in: .whitespaces).isEmpty
            && (draft.allDay || (draft.end ?? "") > (draft.start ?? ""))
            && (!repeats || !draft.weekdays.isEmpty)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        var out = draft
        if !repeats { out.weekdays = [] }
        if !severalDays || !out.allDay { out.endDate = nil }
        if await store.saveBusy(out, id: block?.id) { dismiss() }
    }

    // MARK: Bindings over local strings

    private func dateBinding(_ key: WritableKeyPath<BusyBlockDraft, String>) -> Binding<Date> {
        Binding(get: { LocalClock.day(draft[keyPath: key]) ?? .now }, set: { draft[keyPath: key] = LocalClock.date($0) })
    }

    private func optionalDate(_ key: WritableKeyPath<BusyBlockDraft, String?>, fallback: String) -> Binding<Date> {
        Binding(get: { LocalClock.day(draft[keyPath: key] ?? fallback) ?? .now }, set: { draft[keyPath: key] = LocalClock.date($0) })
    }

    private func timeBinding(_ key: WritableKeyPath<BusyBlockDraft, String?>, fallback: String) -> Binding<Date> {
        Binding(
            get: { LocalClock.instant(date: draft.date, time: draft[keyPath: key] ?? fallback) ?? .now },
            set: { draft[keyPath: key] = LocalClock.time($0) }
        )
    }
}

/// L M X J V S D toggles, ISO weekdays.
private struct WeekdayPicker: View {
    @Binding var selection: [Int]
    private static let letters = ["L", "M", "X", "J", "V", "S", "D"]

    var body: some View {
        HStack(spacing: 6) {
            ForEach(1...7, id: \.self) { day in
                let on = selection.contains(day)
                Button {
                    if on { selection.removeAll { $0 == day } } else { selection = (selection + [day]).sorted() }
                } label: {
                    Text(Self.letters[day - 1])
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 34)
                        .foregroundStyle(on ? Color.white : .primary)
                        .background(on ? AnyShapeStyle(Color.accentColor.gradient) : AnyShapeStyle(.quaternary), in: .circle)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 2)
    }
}

/// Add/edit an injury, illness, symptom or surgery. The Coach trains around active ones.
struct HealthEventEditor: View {
    let store: CalendarStore
    let event: HealthEvent?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.askCoach) private var askCoach
    @State private var draft: HealthEventDraft
    @State private var saving = false
    @State private var confirmDelete = false

    init(store: CalendarStore, event: HealthEvent?) {
        self.store = store
        self.event = event
        _draft = State(initialValue: event.map(HealthEventDraft.init) ?? HealthEventDraft())
    }

    private static let severityWords = ["", "Leve", "Molesta", "Moderada", "Fuerte", "Grave"]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Tipo", selection: $draft.kind) {
                        ForEach(HealthEventKind.allCases) { Label($0.label, systemImage: $0.symbol).tag($0) }
                    }
                    TextField(draft.kind == .enfermedad ? "Qué tienes (p. ej. Gripe)" : "Qué te pasa (p. ej. Esguince)", text: $draft.title)
                        .font(.title3.weight(.semibold))
                    Picker("Zona", selection: $draft.bodyArea) {
                        Text("Sin zona").tag(String?.none)
                        Text("Todo el cuerpo").tag(String?.some("general"))
                        Section("Articulaciones") {
                            ForEach(BodyArea.joints, id: \.0) { Text($0.1).tag(String?.some($0.0)) }
                        }
                        Section("Músculos") {
                            ForEach(BodyArea.muscles, id: \.0) { Text($0.1).tag(String?.some($0.0)) }
                        }
                    }
                }
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Intensidad")
                            Spacer()
                            Text("\(Self.severityWords[draft.severity]) · \(draft.severity)/5")
                                .foregroundStyle(.secondary)
                                .contentTransition(.numericText())
                        }
                        Slider(value: Binding(get: { Double(draft.severity) }, set: { draft.severity = Int($0.rounded()) }), in: 1...5, step: 1)
                            .tint(draft.status.tint)
                    }
                    Picker("Estado", selection: $draft.status.animation(.snappy)) {
                        ForEach(HealthEventStatus.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }
                Section("Fechas") {
                    DatePicker("Empezó", selection: Binding(get: { LocalClock.day(draft.startDate) ?? .now }, set: { draft.startDate = LocalClock.date($0) }), in: ...Date.now, displayedComponents: .date)
                    Toggle("Sigue en curso", isOn: Binding(get: { draft.endDate == nil }, set: { draft.endDate = $0 ? nil : LocalClock.date(.now) }).animation(.snappy))
                    if let end = draft.endDate {
                        DatePicker(
                            "Terminó",
                            selection: Binding(get: { LocalClock.day(end) ?? .now }, set: { draft.endDate = LocalClock.date($0) }),
                            in: (LocalClock.day(draft.startDate) ?? .now)...,
                            displayedComponents: .date
                        )
                    }
                }
                Section {
                    TextField("Qué evitar al entrenar (p. ej. sentadilla)", text: optional(\.affectedTraining), axis: .vertical)
                    TextField("Notas", text: optional(\.notes), axis: .vertical)
                } footer: {
                    Text("Pulso no diagnostica. Si el dolor es fuerte, empeora o viene de un golpe, consulta a un profesional.")
                }
                if let event {
                    Section {
                        Button("Preguntar al Coach cómo entrenar", systemImage: "sparkles") {
                            dismiss()
                            askCoach("Tengo \(event.title.lowercased()) (\(event.kind.label.lowercased()), \(event.severity)/5). ¿Cómo adapto mi entreno esta semana?")
                        }
                        Button("Eliminar", role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .navigationTitle(event == nil ? "Lesión o enfermedad" : draft.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar", role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar", role: .confirm) { Task { await save() } }
                        .disabled(draft.title.trimmingCharacters(in: .whitespaces).isEmpty || saving)
                }
            }
            .confirmationDialog("¿Eliminar \(draft.title) del historial?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Eliminar", role: .destructive) {
                    guard let id = event?.id else { return }
                    Task {
                        await store.deleteHealth(id: id)
                        dismiss()
                    }
                }
            }
            .sensoryFeedback(.selection, trigger: draft.severity)
        }
    }

    private func optional(_ key: WritableKeyPath<HealthEventDraft, String?>) -> Binding<String> {
        Binding(get: { draft[keyPath: key] ?? "" }, set: { draft[keyPath: key] = $0.isEmpty ? nil : $0 })
    }

    private func save() async {
        saving = true
        defer { saving = false }
        if await store.saveHealth(draft, id: event?.id) { dismiss() }
    }
}
