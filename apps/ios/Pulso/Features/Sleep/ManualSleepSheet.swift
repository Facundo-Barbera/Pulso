import SwiftUI

/// Log a night by hand (the watch was off) or edit one logged that way. Defaults
/// to last night: asleep yesterday at 23:00, awake now.
struct ManualSleepSheet: View {
    let store: SleepStore
    let model: PulsoModel
    /// A hand-logged night to edit; nil logs a new one.
    let night: SleepNight?

    @State private var start: Date
    @State private var end: Date
    @State private var note: String
    @State private var saving = false
    @State private var refusal: String?
    @State private var confirmDelete = false
    @Environment(\.dismiss) private var dismiss

    init(store: SleepStore, model: PulsoModel, night: SleepNight? = nil) {
        self.store = store
        self.model = model
        self.night = night
        let defaults = Self.defaults()
        _start = State(initialValue: night.map { Date(timeIntervalSince1970: $0.asleepStart / 1000) } ?? defaults.start)
        _end = State(initialValue: night.map { Date(timeIntervalSince1970: $0.asleepEnd / 1000) } ?? defaults.end)
        _note = State(initialValue: night?.manual?.note ?? "")
    }

    /// Awake now; asleep at 23:00 the evening before the day of waking.
    static func defaults(now: Date = .now, calendar: Calendar = .current) -> (start: Date, end: Date) {
        let wakeDay = calendar.startOfDay(for: now)
        let evening = calendar.date(byAdding: .day, value: -1, to: wakeDay) ?? wakeDay
        let start = calendar.date(bySettingHour: 23, minute: 0, second: 0, of: evening) ?? now.addingTimeInterval(-8 * 3600)
        return (start, now)
    }

    private var minutes: Double { end.timeIntervalSince(start) / 60 }

    /// Same bounds as the engine; saying so here saves a round trip.
    private var problem: String? {
        if minutes <= 0 { return "La hora de despertar tiene que ser después de la de dormir." }
        if minutes < 60 { return "Una noche dura al menos 1 h." }
        if minutes > 16 * 60 { return "Una noche dura como mucho 16 h. Revisa los días." }
        return nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    readback
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                }
                Section {
                    DatePicker(selection: $start, in: ...Date.now) {
                        Label("Me dormí", systemImage: "moon.fill")
                    }
                    DatePicker(selection: $end, in: ...Date.now) {
                        Label("Me desperté", systemImage: "sunrise.fill")
                    }
                }
                .symbolRenderingMode(.multicolor)
                Section("Nota") {
                    TextField("Nota", text: $note, prompt: Text("Sin reloj"), axis: .vertical)
                        .lineLimit(1...3)
                }
                if night != nil {
                    Section {
                        Button("Borrar noche", systemImage: "trash", role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .navigationTitle(night == nil ? "Añadir noche" : "Editar noche")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar", role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("Guardar", role: .confirm) { Task { await save() } }
                            .disabled(problem != nil)
                    }
                }
            }
            .disabled(saving)
            .onChange(of: start) { refusal = nil }
            .onChange(of: end) { refusal = nil }
            .onChange(of: note) { refusal = nil }
            .sensoryFeedback(.error, trigger: refusal) { _, new in new != nil }
            .confirmationDialog("¿Borrar esta noche?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Borrar noche", role: .destructive) { Task { await delete() } }
            } message: {
                Text("Se quita de tu sueño y de tu recuperación.")
            }
        }
        .presentationDetents([.medium, .large])
    }

    /// The hero: how long that is, and which night it counts as (or why it can't be saved).
    private var readback: some View {
        VStack(spacing: 6) {
            Text(minutes > 0 ? sleepDuration(minutes) : "–")
                .font(.system(size: 48, weight: .bold, design: .rounded))
                .contentTransition(.numericText(value: minutes))
                .foregroundStyle(problem == nil ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Group {
                if let message = refusal ?? problem {
                    Label(message, systemImage: refusal != nil ? "exclamationmark.triangle.fill" : "exclamationmark.circle")
                        .foregroundStyle(refusal != nil ? AnyShapeStyle(Theme.caution) : AnyShapeStyle(.secondary))
                } else {
                    Text("Cuenta como la noche del \(end.formatted(.dateTime.weekday(.wide).day().month(.wide)))")
                        .foregroundStyle(.secondary)
                }
            }
            .font(.subheadline)
            .multilineTextAlignment(.center)
            .contentTransition(.opacity)
        }
        .animation(.snappy, value: minutes)
        .animation(.snappy, value: refusal)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        refusal = await store.saveManual(id: night?.manual?.id, start: start, end: end, note: trimmed.isEmpty ? nil : trimmed, model: model)
        if refusal == nil { dismiss() }
    }

    private func delete() async {
        guard let id = night?.manual?.id else { return }
        saving = true
        defer { saving = false }
        refusal = await store.deleteManual(id: id, model: model)
        if refusal == nil { dismiss() }
    }
}
