import SwiftUI

/// Log or edit one use. Defaults make the common case one tap: now, Cannabis,
/// Fumado, Normal. Everything below the amount is optional.
struct SubstanceLogSheet: View {
    let store: SubstanceStore
    let entry: SubstanceEntry?
    @State private var draft: SubstanceDraft
    @State private var saving = false
    @State private var confirmDelete = false
    @Environment(\.dismiss) private var dismiss

    init(store: SubstanceStore, entry: SubstanceEntry?, substance: Substance) {
        self.store = store
        self.entry = entry
        _draft = State(initialValue: entry.map(SubstanceDraft.init) ?? SubstanceDraft(substance: substance))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Sustancia", selection: $draft.substance) {
                        ForEach(Substance.allCases) { Text($0.shortLabel).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    DatePicker("Cuándo", selection: $draft.at, in: ...Date.now)
                }
                if draft.substance == .cannabis {
                    Section("Forma") {
                        Picker("Forma", selection: formBinding) {
                            ForEach(SubstanceForm.allCases) { Text($0.label).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()
                    }
                }
                Section("Cantidad") {
                    Picker("Cantidad", selection: $draft.amount) {
                        ForEach(SubstanceAmount.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }
                Section {
                    Stepper(value: countBinding, in: 0...100) {
                        LabeledContent(draft.substance.countLabel) {
                            Text(draft.count.map(String.init) ?? "—")
                                .fontDesign(.rounded)
                                .monospacedDigit()
                                .contentTransition(.numericText(value: Double(draft.count ?? 0)))
                        }
                    }
                    if draft.showsThc {
                        LabeledContent("mg de THC") {
                            TextField("—", value: $draft.thcMg, format: .number)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .fontDesign(.rounded)
                        }
                    }
                    ContextChips(selection: $draft.context)
                        .listRowInsets(EdgeInsets(top: 10, leading: 0, bottom: 10, trailing: 0))
                    TextField("Nota", text: $draft.note, axis: .vertical)
                        .lineLimit(1...4)
                } header: {
                    Text("Opcional")
                }
                if entry != nil {
                    Section {
                        Button("Eliminar registro", systemImage: "trash", role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .navigationTitle(entry == nil ? "Registrar" : "Editar registro")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar", systemImage: "xmark") { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    Task { await save() }
                } label: {
                    Group {
                        if saving { ProgressView() } else { Text(entry == nil ? "Registrar" : "Guardar") }
                    }
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .disabled(saving)
                .padding(.horizontal)
                .padding(.bottom, 8)
            }
            .onChange(of: draft.substance) { _, substance in
                withAnimation(.snappy) { draft.form = substance == .cannabis ? (draft.form ?? .fumado) : nil }
            }
            .animation(.snappy, value: draft.showsThc)
            .sensoryFeedback(.selection, trigger: draft.substance)
            .sensoryFeedback(.selection, trigger: draft.form)
            .sensoryFeedback(.selection, trigger: draft.amount)
            .sensoryFeedback(.selection, trigger: draft.context)
            .confirmationDialog("¿Eliminar este registro?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Eliminar", role: .destructive) {
                    guard let entry else { return }
                    Task {
                        await store.delete(entry)
                        dismiss()
                    }
                }
            }
        }
    }

    private var formBinding: Binding<SubstanceForm> {
        Binding { draft.form ?? .fumado } set: { draft.form = $0 }
    }

    /// 0 on the stepper is "not counted".
    private var countBinding: Binding<Int> {
        Binding { draft.count ?? 0 } set: { draft.count = $0 == 0 ? nil : $0 }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        if await store.save(draft, id: entry?.id) { dismiss() }
    }
}

/// Optional context as glass chips; tapping the selected one clears it.
private struct ContextChips: View {
    @Binding var selection: SubstanceContext?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    ForEach(SubstanceContext.allCases) { context in
                        let on = selection == context
                        Button {
                            withAnimation(.snappy) { selection = on ? nil : context }
                        } label: {
                            Text(context.label)
                                .font(.subheadline.weight(on ? .semibold : .regular))
                                .foregroundStyle(on ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                        }
                        .buttonStyle(.plain)
                        .glassEffect(on ? .regular.tint(SubstanceStyle.tint).interactive() : .regular.interactive(), in: .capsule)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }
}
