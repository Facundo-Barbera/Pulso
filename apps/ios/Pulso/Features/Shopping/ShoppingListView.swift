import SwiftUI

/// Dieta's toolbar entry to the list. NutritionView adds it with one line: `ShoppingListToolbarItem()`.
struct ShoppingListToolbarItem: ToolbarContent {
    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            NavigationLink { ShoppingListView() } label: { Label("Lista de compras", systemImage: "cart") }
        }
    }
}

/// Lista de compras: what is left to buy for the plan's coming days, by aisle.
/// Hero = how much is bought; then one card per aisle; tap a row to tick it.
/// «Ya tengo» puts an item aside for this list.
struct ShoppingListView: View {
    @State private var store = ShoppingStore()
    @State private var editing: Editing?
    @Environment(\.askCoach) private var askCoach

    enum Editing: Identifiable {
        case new, item(ShoppingItem)
        var id: String { if case .item(let item) = self { item.id } else { "new" } }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if let list = store.list {
                    content(list)
                } else if store.loading {
                    ProgressView().controlSize(.large).padding(.top, 120)
                } else {
                    EmptyStateView(systemImage: "cart.badge.questionmark", title: "Sin conexión con la Mac",
                                   message: "No se pudo cargar tu lista.", tint: Theme.body, actionTitle: "Reintentar") {
                        Task { await store.load() }
                    }
                    .padding(.top, 40)
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 24)
            .animation(.snappy, value: store.list)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Lista de compras")
        .toolbar { toolbar }
        .refreshable { await store.load() }
        .task { await store.load() }
        .sheet(item: $editing) { editing in
            ShoppingItemEditor(editing: editing, store: store).presentationDetents([.medium, .large])
        }
        .sensoryFeedback(.selection, trigger: store.list?.bought ?? 0)
        .sensoryFeedback(.success, trigger: store.list.map { $0.toBuy > 0 && $0.pending == 0 } ?? false) { _, done in done }
    }

    @ViewBuilder
    private func content(_ list: ShoppingList) -> some View {
        if list.items.isEmpty {
            if list.hasPlan {
                EmptyStateView(systemImage: "cart", title: "Genera tu lista desde tu plan",
                               message: "Lo que pide tu plan para los próximos días, por pasillo.", tint: Theme.body)
                RangeCard(store: store, title: "Generar lista")
            } else {
                EmptyStateView(systemImage: "cart", title: "Genera tu lista desde tu plan",
                               message: "Aún no tienes un plan de dieta activo. Pídeselo al Coach y la lista sale de ahí.",
                               tint: Theme.body, actionTitle: "Pedir un plan al Coach") {
                    askCoach("Arma mi plan de comidas")
                }
                Button("Añadir algo a mano", systemImage: "plus") { editing = .new }
                    .buttonStyle(.glass)
            }
        } else {
            ShoppingHero(list: list)
            if list.stale && list.hasPlan { staleCard }
            ForEach(list.sections) { section in
                AisleCard(category: section.category, items: section.items, store: store) { editing = .item($0) }
                    .transition(.opacity.combined(with: .scale(scale: 0.97)))
            }
            if !list.alreadyHave.isEmpty { alreadyHaveCard(list.alreadyHave) }
            if list.hasPlan { RangeCard(store: store, title: "Regenerar") }
        }
    }

    private var staleCard: some View {
        Card {
            Label("Tu plan de dieta cambió", systemImage: "arrow.triangle.2.circlepath")
                .font(.subheadline.weight(.semibold))
            Text("Actualiza la lista: lo que marcaste y lo que añadiste a mano se queda.")
                .font(.footnote).foregroundStyle(.secondary)
            Button("Actualizar lista") { Task { await store.generate() } }
                .buttonStyle(.glassProminent)
                .disabled(store.generating)
        }
    }

    private func alreadyHaveCard(_ items: [ShoppingItem]) -> some View {
        Card {
            CardTitle(text: "Ya tengo", systemImage: "house.fill")
            ForEach(items) { item in
                HStack {
                    Text(item.name).foregroundStyle(.secondary)
                    Spacer()
                    Button("Lo necesito") { Task { await store.setPantry(item, false) } }
                        .font(.footnote.weight(.medium))
                        .buttonStyle(.borderless)
                }
                .contextMenu { ShoppingItemMenu(item: item, store: store) { editing = .item(item) } }
            }
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            if let list = store.list, list.pending > 0 {
                ShareLink(item: list.text, preview: SharePreview("Lista de compras")) {
                    Label("Compartir", systemImage: "square.and.arrow.up")
                }
            }
            Button("Añadir", systemImage: "plus") { editing = .new }
                .disabled(store.list == nil)
        }
    }
}

/// x de y comprados, with a ring that fills as you shop.
private struct ShoppingHero: View {
    let list: ShoppingList

    var body: some View {
        HeroCard(title: "Comprados", systemImage: "cart.fill", value: "\(list.bought)", unit: "de \(list.toBuy)",
                 caption: caption, tint: Theme.body)
        .overlay(alignment: .topTrailing) {
            ZStack {
                Circle().stroke(Theme.body.opacity(0.15), lineWidth: 8)
                Circle()
                    .trim(from: 0, to: list.progress)
                    .stroke(Theme.body.gradient, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Image(systemName: list.pending == 0 ? "checkmark" : "basket.fill")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Theme.body)
                    .contentTransition(.symbolEffect(.replace))
            }
            .frame(width: 64, height: 64)
            .padding(Theme.padding + 4)
            .animation(.snappy, value: list.progress)
            .accessibilityHidden(true)
        }
    }

    private var caption: String {
        let what = list.pending == 0 ? "¡Todo listo!" : "Te faltan \(list.pending)"
        guard let range = list.rangeText else { return what }
        return "\(what) · \(range)"
    }
}

/// One aisle: its items, tap to tick.
private struct AisleCard: View {
    let category: ShoppingCategory
    let items: [ShoppingItem]
    let store: ShoppingStore
    let edit: (ShoppingItem) -> Void

    var body: some View {
        Card {
            HStack {
                Label(category.label, systemImage: category.symbol)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(category.tint)
                Spacer()
                Text("\(items.filter(\.checked).count)/\(items.count)")
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .contentTransition(.numericText())
            }
            VStack(spacing: 0) {
                ForEach(items) { item in
                    ShoppingRow(item: item) { Task { await store.toggle(item) } }
                        .contextMenu { ShoppingItemMenu(item: item, store: store) { edit(item) } }
                    if item.id != items.last?.id { Divider().padding(.leading, 36) }
                }
            }
        }
    }
}

private struct ShoppingRow: View {
    let item: ShoppingItem
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: 12) {
                Image(systemName: item.checked ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(item.checked ? AnyShapeStyle(Theme.body) : AnyShapeStyle(.tertiary))
                    .contentTransition(.symbolEffect(.replace))
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name)
                        .foregroundStyle(item.checked ? .secondary : .primary)
                        // A drawn line, so the strike animates left to right.
                        .overlay(alignment: .leading) {
                            Rectangle()
                                .frame(height: 1.5)
                                .foregroundStyle(.secondary)
                                .scaleEffect(x: item.checked ? 1 : 0, anchor: .leading)
                        }
                    if let note = item.note {
                        Text(note).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                if let amount = item.amount {
                    Text(amount)
                        .font(.subheadline.weight(.medium))
                        .fontDesign(.rounded)
                        .foregroundStyle(.secondary)
                        .contentTransition(.numericText())
                }
            }
            .padding(.vertical, 10)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .animation(.snappy, value: item.checked)
        .accessibilityLabel("\(item.name)\(item.amount.map { ", \($0)" } ?? "")")
        .accessibilityValue(item.checked ? "Comprado" : "Pendiente")
    }
}

private struct ShoppingItemMenu: View {
    let item: ShoppingItem
    let store: ShoppingStore
    let edit: () -> Void

    var body: some View {
        Button(item.checked ? "Desmarcar" : "Comprado", systemImage: item.checked ? "circle" : "checkmark.circle") {
            Task { await store.toggle(item) }
        }
        Button(item.pantry ? "Lo necesito" : "Ya tengo", systemImage: item.pantry ? "cart" : "house") {
            Task { await store.setPantry(item, !item.pantry) }
        }
        Button("Editar", systemImage: "pencil", action: edit)
        Button("Eliminar", systemImage: "trash", role: .destructive) { Task { await store.delete(item) } }
    }
}

/// How many days to shop for, and the button that (re)builds the list from the plan.
private struct RangeCard: View {
    @Bindable var store: ShoppingStore
    let title: String

    var body: some View {
        Card {
            CardTitle(text: "Desde tu plan", systemImage: "fork.knife")
            Picker("Días", selection: $store.days) {
                ForEach(ShoppingStore.ranges, id: \.self) { Text("\($0) días").tag($0) }
            }
            .pickerStyle(.segmented)
            Button {
                Task { await store.generate() }
            } label: {
                Label(title, systemImage: "wand.and.sparkles")
                    .frame(maxWidth: .infinity)
                    .symbolEffect(.bounce, value: store.generating)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .disabled(store.generating)
            Text("Lo que marcaste y lo que añadiste a mano se quedan.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

/// Add an item by hand, or fix one: name, amount, aisle, note, "ya tengo".
private struct ShoppingItemEditor: View {
    let editing: ShoppingListView.Editing
    let store: ShoppingStore
    @State private var draft = ShoppingItemDraft()
    @Environment(\.dismiss) private var dismiss

    private var item: ShoppingItem? { if case .item(let item) = editing { item } else { nil } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Qué", text: $draft.name)
                    TextField("Cantidad (opcional)", text: $draft.amount)
                }
                Section {
                    Picker("Pasillo", selection: $draft.category) {
                        if item == nil { Text("Automático").tag(ShoppingCategory?.none) }
                        ForEach(ShoppingCategory.allCases) { Label($0.label, systemImage: $0.symbol).tag(Optional($0)) }
                    }
                    TextField("Nota", text: $draft.note, axis: .vertical)
                    if item != nil { Toggle("Ya lo tengo", isOn: $draft.pantry) }
                }
                if let item {
                    Section {
                        Button("Eliminar", role: .destructive) {
                            Task { await store.delete(item) }
                            dismiss()
                        }
                    }
                }
            }
            .navigationTitle(item == nil ? "Añadir a la lista" : "Editar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar", role: .cancel) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar", role: .confirm) {
                        Task {
                            if let item { await store.update(item, draft) } else { await store.add(draft) }
                        }
                        dismiss()
                    }
                    .disabled(!draft.isValid)
                }
            }
            .onAppear { if let item { draft = ShoppingItemDraft(item) } }
        }
    }
}
