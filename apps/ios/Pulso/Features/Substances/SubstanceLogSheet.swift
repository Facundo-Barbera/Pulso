import SwiftUI

/// Log or edit one use. Defaults make the common case one tap: now, the substance
/// on screen, its first form, Normal. Everything below the amount is optional.
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

    /// Active substances, plus an archived one an old entry belongs to.
    private var choices: [Substance] {
        var list = store.active
        if let own = store.substance(draft.substanceId), own.archived { list.append(own) }
        return list
    }

    private var substance: Substance? { store.substance(draft.substanceId) }

    /// The substance's forms, plus an entry's form that has since been removed.
    private var forms: [String] {
        var list = substance?.forms ?? []
        if let form = draft.form, !list.contains(form) { list.append(form) }
        return list
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SubstanceChips(items: choices.map(\.id), selection: draft.substanceId, onSelect: select) { id in
                        if let substance = store.substance(id) { SubstanceLabel(substance: substance) }
                    }
                    .listRowInsets(EdgeInsets(top: 10, leading: 0, bottom: 10, trailing: 0))
                    DatePicker("Cuándo", selection: $draft.at, in: ...Date.now)
                }
                if !forms.isEmpty {
                    Section("Forma") {
                        SubstanceChips(items: forms, selection: draft.form, onSelect: { draft.form = $0 }) { form in
                            Label {
                                Text(SubstanceText.capitalizedFirst(form))
                            } icon: {
                                SubstanceGlyphView(symbol: SubstanceText.formSymbol(form) ?? substance?.symbol)
                            }
                        }
                        .listRowInsets(EdgeInsets(top: 10, leading: 0, bottom: 10, trailing: 0))
                    }
                }
                Section("Cuánto") {
                    Picker("Cuánto", selection: $draft.amount) {
                        ForEach(SubstanceAmount.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }
                Section {
                    Stepper(value: quantityBinding, in: 0...10_000) {
                        LabeledContent(SubstanceText.unitLabel(substance?.unit ?? "veces")) {
                            TextField("—", value: $draft.quantity, format: .number)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .fontDesign(.rounded)
                                .monospacedDigit()
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
                    SubstanceChips(items: SubstanceContext.allCases, selection: draft.context, clearable: true, onSelect: { draft.context = $0 }) {
                        Text($0.label)
                    }
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
            .animation(.snappy, value: draft.showsThc)
            .animation(.snappy, value: forms)
            .sensoryFeedback(.selection, trigger: draft.substanceId)
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

    private func select(_ id: String?) {
        guard let id, let substance = store.substance(id) else { return }
        draft.switchTo(substance)
    }

    /// Steps by one; 0 is "not counted". Decimals are typed in the field.
    private var quantityBinding: Binding<Double> {
        Binding { draft.quantity ?? 0 } set: { draft.quantity = $0 <= 0 ? nil : $0 }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        if await store.save(draft, id: entry?.id) { dismiss() }
    }
}
