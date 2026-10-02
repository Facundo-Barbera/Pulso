import SwiftUI

/// "Gestionar sustancias": drag to reorder, tap to edit, swipe to archive. Archived
/// ones keep their history and come back from their own section.
struct SubstanceManageView: View {
    let store: SubstanceStore
    @State private var editing: EditTarget?

    private enum EditTarget: Identifiable {
        case new
        case existing(Substance)
        var id: String {
            switch self {
            case .new: "new"
            case let .existing(substance): substance.id
            }
        }
    }

    var body: some View {
        List {
            Section {
                ForEach(store.active) { substance in
                    row(substance)
                        .swipeActions(edge: .trailing) {
                            Button("Archivar", systemImage: "archivebox") {
                                Task { await store.setArchived(true, substance.id) }
                            }
                            .tint(.gray)
                        }
                }
                .onMove { store.moveActive(from: $0, to: $1) }
                Button("Nueva sustancia", systemImage: "plus") { editing = .new }
            } header: {
                Text("Activas")
            } footer: {
                Text("Mantén pulsada una fila y arrástrala para cambiar el orden. Archivar oculta una sustancia sin borrar su historial.")
            }
            if !store.archived.isEmpty {
                Section("Archivadas") {
                    ForEach(store.archived) { substance in
                        row(substance)
                            .swipeActions(edge: .trailing) {
                                Button("Restaurar", systemImage: "arrow.uturn.backward") {
                                    Task { await store.setArchived(false, substance.id) }
                                }
                                .tint(SubstanceStyle.tint)
                            }
                    }
                }
            }
        }
        .navigationTitle("Gestionar sustancias")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Nueva sustancia", systemImage: "plus") { editing = .new }
            }
        }
        .animation(.snappy, value: store.substances)
        .sensoryFeedback(.selection, trigger: store.active.map(\.id))
        .sheet(item: $editing) { target in
            switch target {
            case .new: SubstanceEditorSheet(store: store, substance: nil)
            case let .existing(substance): SubstanceEditorSheet(store: store, substance: substance)
            }
        }
    }

    private func row(_ substance: Substance) -> some View {
        Button { editing = .existing(substance) } label: {
            HStack(spacing: 12) {
                SubstanceGlyphView(symbol: substance.symbol)
                    .font(.body.weight(.medium))
                    .foregroundStyle(SubstanceStyle.tint)
                    .frame(width: 36, height: 36)
                    .background(SubstanceStyle.tint.opacity(0.12), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(substance.name).font(.body.weight(.medium))
                    Text(detail(substance)).font(.caption).foregroundStyle(.secondary)
                }
                .lineLimit(1)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .opacity(substance.archived ? 0.6 : 1)
        }
        .tint(.primary)
        .accessibilityHint("Editar")
    }

    /// "Tragos · Fumado, Vapeado · Máx. 2 días/sem".
    private func detail(_ substance: Substance) -> String {
        var parts = [SubstanceText.unitLabel(substance.unit)]
        if !substance.forms.isEmpty { parts.append(substance.forms.map(SubstanceText.capitalizedFirst).joined(separator: ", ")) }
        if let max = substance.maxDaysPerWeek { parts.append("Máx. \(max) \(SubstanceText.days(max))/sem") }
        return parts.joined(separator: " · ")
    }
}

/// "Nueva sustancia" or editing one: name, symbol, unit, forms and an optional weekly maximum.
struct SubstanceEditorSheet: View {
    let store: SubstanceStore
    let substance: Substance?
    @State private var definition: SubstanceDefinition
    @State private var newForm = ""
    @State private var saving = false
    @FocusState private var addingForm: Bool
    @Environment(\.dismiss) private var dismiss

    private static let symbolSuggestions = ["🌿", "🍷", "🍺", "☕️", "🚬", "💊", "leaf", "wineglass", "cup.and.saucer", "pills", "smoke", "drop"]

    init(store: SubstanceStore, substance: Substance?) {
        self.store = store
        self.substance = substance
        _definition = State(initialValue: substance.map(SubstanceDefinition.init) ?? SubstanceDefinition())
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    preview
                        .listRowBackground(Color.clear)
                    TextField("Nombre", text: $definition.name)
                        .textInputAutocapitalization(.sentences)
                }
                Section {
                    TextField("Emoji o nombre de SF Symbol", text: $definition.symbol)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SubstanceChips(items: Self.symbolSuggestions, selection: definition.symbol, clearable: true, onSelect: { definition.symbol = $0 ?? "" }) {
                        SubstanceGlyphView(symbol: $0).frame(minWidth: 20)
                    }
                    .listRowInsets(EdgeInsets(top: 10, leading: 0, bottom: 10, trailing: 0))
                } header: {
                    Text("Símbolo")
                } footer: {
                    Text("Opcional. Sin símbolo se usa uno neutro.")
                }
                Section {
                    TextField("veces", text: $definition.unit)
                        .textInputAutocapitalization(.never)
                    SubstanceChips(items: SubstanceText.unitSuggestions, selection: definition.unit, onSelect: { definition.unit = $0 ?? "" }) {
                        Text($0)
                    }
                    .listRowInsets(EdgeInsets(top: 10, leading: 0, bottom: 10, trailing: 0))
                } header: {
                    Text("Unidad")
                } footer: {
                    Text("En qué cuentas la cantidad al registrar.")
                }
                Section {
                    ForEach(definition.forms, id: \.self) { form in
                        Text(SubstanceText.capitalizedFirst(form))
                    }
                    .onMove { definition.forms.move(fromOffsets: $0, toOffset: $1) }
                    .onDelete { definition.forms.remove(atOffsets: $0) }
                    HStack {
                        TextField("Añadir forma (p. ej. fumado)", text: $newForm)
                            .textInputAutocapitalization(.never)
                            .focused($addingForm)
                            .submitLabel(.done)
                            .onSubmit {
                                commitNewForm()
                                addingForm = true
                            }
                        if !newForm.trimmingCharacters(in: .whitespaces).isEmpty {
                            Button("Añadir", systemImage: "plus.circle.fill", action: commitNewForm)
                                .labelStyle(.iconOnly)
                                .foregroundStyle(SubstanceStyle.tint)
                                .buttonStyle(.borderless)
                        }
                    }
                } header: {
                    Text("Formas")
                } footer: {
                    Text("Opcional. La primera se elige por defecto al registrar; arrastra para cambiar el orden.")
                }
                Section {
                    Toggle("Máximo de días por semana", isOn: goalOn)
                    if let max = definition.maxDaysPerWeek {
                        Stepper(value: goalValue, in: 0...7) {
                            Text("Máximo \(max) \(SubstanceText.days(max)) por semana")
                                .contentTransition(.numericText(value: Double(max)))
                        }
                    }
                } header: {
                    Text("Tu máximo")
                } footer: {
                    Text("Opcional y solo para ti: una referencia, no un juicio.")
                }
                if let substance {
                    Section {
                        Button(substance.archived ? "Restaurar" : "Archivar", systemImage: substance.archived ? "arrow.uturn.backward" : "archivebox") {
                            Task {
                                await store.setArchived(!substance.archived, substance.id)
                                dismiss()
                            }
                        }
                    } footer: {
                        Text(substance.archived ? "Vuelve a aparecer al registrar y en los resúmenes." : "Deja de aparecer al registrar; su historial se conserva.")
                    }
                }
            }
            .navigationTitle(substance == nil ? "Nueva sustancia" : "Editar sustancia")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar", systemImage: "xmark") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar", systemImage: "checkmark") { Task { await save() } }
                        .buttonStyle(.glassProminent)
                        .disabled(!definition.isValid || saving)
                }
            }
            .animation(.snappy, value: definition.maxDaysPerWeek != nil)
            .animation(.snappy, value: definition.forms)
            .sensoryFeedback(.selection, trigger: definition.symbol)
            .sensoryFeedback(.selection, trigger: definition.unit)
        }
    }

    private var preview: some View {
        let name = definition.name.trimmingCharacters(in: .whitespaces)
        return VStack(spacing: 10) {
            SubstanceGlyphView(symbol: definition.symbol)
                .font(.system(size: 36, weight: .medium))
                .foregroundStyle(SubstanceStyle.tint.gradient)
                .frame(width: 76, height: 76)
                .background(SubstanceStyle.tint.opacity(0.12), in: Circle())
                .contentTransition(.symbolEffect(.replace))
            Text(name.isEmpty ? "Sin nombre" : name)
                .font(.headline)
                .foregroundStyle(name.isEmpty ? .tertiary : .primary)
        }
        .frame(maxWidth: .infinity)
        .animation(.snappy, value: definition.symbol)
        .accessibilityHidden(true)
    }

    private var goalOn: Binding<Bool> {
        Binding { definition.maxDaysPerWeek != nil } set: { definition.maxDaysPerWeek = $0 ? (substance?.maxDaysPerWeek ?? 3) : nil }
    }

    private var goalValue: Binding<Int> {
        Binding { definition.maxDaysPerWeek ?? 3 } set: { definition.maxDaysPerWeek = $0 }
    }

    private func commitNewForm() {
        let form = newForm.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !form.isEmpty else { return }
        if !definition.forms.contains(where: { $0.caseInsensitiveCompare(form) == .orderedSame }) {
            definition.forms.append(form)
        }
        newForm = ""
    }

    private func save() async {
        commitNewForm()
        saving = true
        defer { saving = false }
        let saved = if let substance {
            await store.update(substance.id, definition.patch)
        } else {
            await store.create(definition) != nil
        }
        if saved { dismiss() }
    }
}
