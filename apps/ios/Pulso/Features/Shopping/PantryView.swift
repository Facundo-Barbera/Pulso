import SwiftUI

/// Despensa: what is at home, by aisle. Ticking the list stocks it; it is
/// subtracted from what is left to buy. Tap a row to fix it, long-press for
/// "Se acabó" or to remove it.
struct PantryContent: View {
    let store: ShoppingStore
    let edit: (ShoppingListView.PantryEditing) -> Void

    var body: some View {
        if let items = store.pantry {
            if items.isEmpty {
                Card {
                    EmptyStateView(systemImage: "house", title: "Tu despensa está vacía",
                                   message: "Lo que marcas en la lista aparece aquí y deja de pedirse.",
                                   tint: Theme.body, actionTitle: "Añadir algo") { edit(.new) }
                }
            } else {
                HeroCard(title: "En casa", systemImage: "house.fill", value: "\(items.count)",
                         unit: items.count == 1 ? "cosa" : "cosas", caption: "Se descuenta de tu lista de compras", tint: Theme.body)
                ForEach(pantrySections(items)) { section in
                    PantryAisleCard(category: section.category, items: section.items, store: store, edit: edit)
                }
            }
        } else if store.loading {
            ProgressView().controlSize(.large).padding(.top, 80)
        } else {
            Card {
                EmptyStateView(systemImage: "house.badge.exclamationmark", title: "Despensa no disponible",
                               message: "Actualiza Pulso en la Mac para ver lo que tienes en casa.", tint: Theme.body)
            }
        }
    }
}

private struct PantryAisleCard: View {
    let category: ShoppingCategory
    let items: [PantryItem]
    let store: ShoppingStore
    let edit: (ShoppingListView.PantryEditing) -> Void

    var body: some View {
        Card {
            Label(category.label, systemImage: category.symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(category.tint)
            VStack(spacing: 0) {
                ForEach(items) { item in
                    Button { edit(.item(item)) } label: { PantryRow(item: item) }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button("Editar", systemImage: "pencil") { edit(.item(item)) }
                            if item.quantity != 0 {
                                Button("Se acabó", systemImage: "circle.slash") {
                                    var draft = PantryDraft(item)
                                    draft.quantity = 0
                                    Task { await store.updatePantry(item, draft) }
                                }
                            }
                            Button("Quitar", systemImage: "trash", role: .destructive) { Task { await store.deletePantry(item) } }
                        }
                    if item.id != items.last?.id { Divider() }
                }
            }
        }
    }
}

private struct PantryRow: View {
    let item: PantryItem

    private var amount: String { item.quantity == 0 ? "Se acabó" : item.amount ?? "Algo" }

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.name).foregroundStyle(item.quantity == 0 ? .secondary : .primary)
                if item.fromList {
                    Text("De la lista").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            Text(amount)
                .font(.subheadline.weight(.medium)).fontDesign(.rounded)
                .foregroundStyle(.secondary)
                .contentTransition(.numericText())
        }
        .padding(.vertical, 10)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Edita la cantidad")
    }
}

/// Add something that is at home, or fix how much is left. A blank amount means "some".
struct PantryEditor: View {
    let editing: ShoppingListView.PantryEditing
    let store: ShoppingStore
    @State private var draft = PantryDraft()
    @State private var quantity = ""
    @Environment(\.dismiss) private var dismiss

    private var item: PantryItem? { if case .item(let item) = editing { item } else { nil } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Qué", text: $draft.name)
                } footer: {
                    Text("Lo que tienes en casa no se pide en la lista.")
                }
                Section {
                    TextField("Cantidad (opcional)", text: $quantity).keyboardType(.decimalPad)
                    TextField("Unidad: g, ml, ud…", text: Binding { draft.unit ?? "" } set: { draft.unit = $0 })
                        .textInputAutocapitalization(.never)
                } footer: {
                    Text("Sin cantidad cuenta como «algo», suficiente para lo que pida el plan.")
                }
                if let item {
                    Section {
                        Button("Quitar de la despensa", role: .destructive) {
                            Task { await store.deletePantry(item) }
                            dismiss()
                        }
                    }
                }
            }
            .navigationTitle(item == nil ? "Añadir a la despensa" : "Editar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar", role: .cancel) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar", role: .confirm) {
                        var draft = draft
                        draft.quantity = Double(quantity.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces))
                        // 0 means "ran out" on an existing row; a new one with nothing is just "some".
                        if item == nil, draft.quantity ?? 1 <= 0 { draft.quantity = nil }
                        Task {
                            if let item { await store.updatePantry(item, draft) } else { await store.addPantry(draft) }
                        }
                        dismiss()
                    }
                    .disabled(!draft.isValid)
                }
            }
            .onAppear {
                guard let item else { return }
                draft = PantryDraft(item)
                quantity = item.quantity.map { $0.formatted(.number.precision(.fractionLength(0...1)).grouping(.never)) } ?? ""
            }
        }
    }
}

// MARK: - Previews

private let previewPantry = [
    PantryItem(id: "1", name: "Arroz", quantity: 600, unit: "g", amount: "600 g", category: .panaderiaCereales, source: "list"),
    PantryItem(id: "2", name: "Huevos", quantity: 6, unit: "ud", amount: "6", category: .lacteosHuevos, source: "manual"),
    PantryItem(id: "3", name: "Aceite de oliva", category: .despensa, source: "manual"),
    PantryItem(id: "4", name: "Pechugas de pollo", quantity: 0, unit: "g", amount: "0 g", category: .carnesPescados, source: "list"),
]

#Preview("Despensa · filas · 375 pt · XXL") {
    NarrowPreview(dynamicType: .xxLarge) {
        HeroCard(title: "En casa", systemImage: "house.fill", value: "4", unit: "cosas", caption: "Se descuenta de tu lista de compras", tint: Theme.body)
        Card { ForEach(previewPantry) { PantryRow(item: $0) } }
    }
}

#Preview("Despensa · vacía · claro") {
    NarrowPreview {
        Card {
            EmptyStateView(systemImage: "house", title: "Tu despensa está vacía",
                           message: "Lo que marcas en la lista aparece aquí y deja de pedirse.", tint: Theme.body, actionTitle: "Añadir algo") {}
        }
    }
    .preferredColorScheme(.light)
}
