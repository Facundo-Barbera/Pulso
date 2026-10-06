import SwiftUI

// "Personalizar lista" and "Personalizar ejercicio", shared by the program day
// (Editar) and the live session (the list button). Each side brings a draft;
// nothing is written until "Guardar".

/// A row of "Personalizar lista".
struct ListItem: Identifiable, Hashable {
    var id: String
    var exerciseId: String
    var name: String
    /// "4 series de 6 a 8", or the cardio target.
    var detail: String
    var isCardio: Bool
    var thumbnail: String?
    var supersetId: String?
    /// Has logged work: it can be skipped, not removed.
    var locked = false
    /// Passed over today (live session only): struck through, with "Retomar".
    var skipped = false
    var status: String? = nil
}

/// What "Personalizar ejercicio" changes.
struct ExerciseCustomization: Hashable {
    /// The library id: the load reads and steps in its unit.
    var exerciseId: String
    var sets: Int
    var repMin: Int
    var repMax: Int
    /// Nil: the suggested load.
    var weightKg: Double?
    var suggestedKg: Double?
    /// The load can go back to "sugerido" (the program's; a live set always has one).
    var suggestible = false
    var restSeconds: Int
    var minSets = 1
    var isCardio = false
    var needsLoad = true
    /// Cardio blocks: minutes instead of sets and repetitions.
    var durationMinutes: Double? = nil
}

/// One side's list being edited.
@MainActor
protocol ListDraft: AnyObject, Observable {
    var title: String { get }
    var items: [ListItem] { get }
    /// The exercise in progress, shown on its own (live session only).
    var current: Int? { get }
    var scope: EditScope { get set }
    var changed: Bool { get }
    func move(fromOffsets source: IndexSet, toOffset destination: Int)
    func remove(_ id: String)
    func add(_ library: LibraryExercise)
    /// Returns the id the exercise has after the swap.
    @discardableResult func swap(_ id: String, to library: LibraryExercise) -> String?
    func setSupersets(_ ids: [String?])
    /// Takes a skipped exercise back into the session.
    func resume(_ id: String)
    func customization(_ id: String) -> ExerciseCustomization?
    /// Applies what differs between `old` and `new`, so settings changed elsewhere stay.
    func apply(_ new: ExerciseCustomization, was old: ExerciseCustomization, to id: String)
    /// Rest, effort, notes and cardio details, where the side has a fuller editor.
    func moreSettings(_ id: String) -> AnyView?
    func save() async throws
}

extension ListDraft {
    func moreSettings(_ id: String) -> AnyView? { nil }
    func resume(_ id: String) {}
}

extension EditScope {
    /// The wording of "Aplicar cambios a:".
    var applyLabel: String { self == .always ? "Todo el plan" : "Solo este entreno" }
}

// MARK: - Personalizar lista

struct CustomizeListSheet<Draft: ListDraft>: View {
    @Bindable var draft: Draft
    @Environment(\.dismiss) private var dismiss
    @State private var adding: AddKind?
    @State private var customizing: Customizing?
    @State private var pairing: [String]?
    @State private var pairError = false
    @State private var confirmDiscard = false
    @State private var confirmSwapAll = false
    @State private var swappingAll = false
    @State private var saving = false
    @State private var error: String?

    private enum AddKind: String, Identifiable {
        case exercise, cardio
        var id: String { rawValue }
    }

    private struct Customizing: Identifiable {
        var id: String
    }

    private var items: [ListItem] { draft.items }
    private var labels: [String: Int] { Superset.labels(items.map(\.supersetId)) }

    var body: some View {
        NavigationStack {
            List {
                if items.isEmpty {
                    EmptyStateView(systemImage: "figure.cooldown", title: "Sin ejercicios", message: "Añade el primero desde la biblioteca.", tint: Theme.training, actionTitle: "Añadir ejercicio") {
                        adding = .exercise
                    }
                    .listRowBackground(Color.clear)
                } else if let current = draft.current, items.indices.contains(current) {
                    // The screen on now: a superset whole.
                    let block = Superset.group(of: current, in: items.map(\.supersetId)) ?? current..<(current + 1)
                    if block.lowerBound > 0 {
                        Section("Anteriores") { rows(0..<block.lowerBound, movable: false) }
                    }
                    Section(block.count > 1 ? "Superserie actual" : "Ejercicio actual") { rows(block, movable: false) }
                    if block.upperBound < items.count {
                        Section("Siguientes") { rows(block.upperBound..<items.count, movable: true) }
                    }
                } else {
                    Section { rows(0..<items.count, movable: true) } header: {
                        Text("\(items.count) \(items.count == 1 ? "ejercicio" : "ejercicios")")
                    }
                }

                if !items.isEmpty {
                    Section {
                        Picker("Aplicar cambios a", selection: $draft.scope) {
                            ForEach([EditScope.today, .always], id: \.self) { Text($0.applyLabel).tag($0) }
                        }
                    } footer: {
                        if let error {
                            Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                        } else {
                            Text("Mantén pulsado y arrastra para reordenar; toca un ejercicio para cambiar sus series.")
                        }
                    }
                }
            }
            .environment(\.editMode, .constant(pairing == nil && !items.isEmpty ? .active : .inactive))
            .animation(.snappy, value: items)
            .sensoryFeedback(.impact(weight: .light), trigger: items.map(\.id))
            .sensoryFeedback(.error, trigger: pairError)
            .safeAreaBar(edge: .bottom, spacing: 0) { bottomBar }
            .navigationTitle("Personalizar lista")
            .navigationSubtitle(draft.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .overlay {
                if swappingAll {
                    ProgressView("Buscando alternativas…")
                        .padding(20)
                        .glassEffect(.regular, in: .rect(cornerRadius: 20))
                }
            }
        }
        .interactiveDismissDisabled(draft.changed || saving)
        .sheet(item: $adding) { kind in
            ExercisePickerSheet(title: kind == .cardio ? "Añadir cardio" : "Añadir ejercicio", initialMuscle: kind == .cardio ? "cardio" : nil) { picked in
                withAnimation(.snappy) { draft.add(picked) }
            }
        }
        .sheet(item: $customizing) { target in
            CustomizeExerciseSheet(draft: draft, id: target.id)
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button("Descartar") {
                if draft.changed { confirmDiscard = true } else { dismiss() }
            }
            .confirmationDialog("¿Descartar los cambios?", isPresented: $confirmDiscard, titleVisibility: .visible) {
                Button("Descartar cambios", role: .destructive) { dismiss() }
                Button("Seguir editando", role: .cancel) {}
            }
        }
        ToolbarItem(placement: .primaryAction) {
            Button("Cambiar todos", systemImage: "arrow.triangle.2.circlepath") { confirmSwapAll = true }
                .disabled(swappingAll || items.allSatisfy { $0.locked || $0.isCardio })
                .confirmationDialog("¿Cambiar todos los ejercicios?", isPresented: $confirmSwapAll, titleVisibility: .visible) {
                    Button("Cambiar todos") { Task { await swapAll() } }
                    Button("Cancelar", role: .cancel) {}
                } message: {
                    Text("Cada uno por el más parecido con tu material preferido. Los que ya tienen series hechas se quedan.")
                }
        }
        ToolbarSpacer(.fixed, placement: .primaryAction)
        ToolbarItem(placement: .confirmationAction) {
            Button(action: save) {
                if saving { ProgressView() } else { Text("Guardar") }
            }
            .buttonStyle(.glassProminent)
            .tint(Theme.training)
            .disabled(saving || !draft.changed)
        }
    }

    /// One list row per exercise, or per superset (its members together, moved as one).
    private struct Block: Identifiable {
        let range: Range<Int>
        let id: String
    }

    private func blocks(_ range: Range<Int>) -> [Block] {
        let ids = items.map(\.supersetId)
        var out: [Block] = []
        var i = range.lowerBound
        while i < range.upperBound {
            let group = Superset.group(of: i, in: ids).map { max($0.lowerBound, range.lowerBound)..<min($0.upperBound, range.upperBound) } ?? i..<(i + 1)
            out.append(Block(range: group, id: items[group.lowerBound].id))
            i = group.upperBound
        }
        return out
    }

    private func rows(_ range: Range<Int>, movable: Bool) -> some View {
        let blocks = blocks(range)
        let move: ((IndexSet, Int) -> Void)? = movable ? { source, destination in
            let from = IndexSet(source.flatMap { Array(blocks[$0].range) })
            let to = destination < blocks.count ? blocks[destination].range.lowerBound : range.upperBound
            withAnimation(.snappy) { draft.move(fromOffsets: from, toOffset: to) }
        } : nil
        return ForEach(blocks) { block in
            if block.range.count > 1, let first = items[block.range.lowerBound].supersetId {
                SupersetGroup(number: labels[first]) {
                    ForEach(Array(block.range), id: \.self) { i in
                        if i > block.range.lowerBound { Divider() }
                        row(items[i], grouped: true)
                    }
                }
            } else {
                row(items[block.range.lowerBound])
            }
        }
        .onMove(perform: move)
        .deleteDisabled(true)
    }

    /// `grouped`: inside its superset's row, which names it once.
    private func row(_ item: ListItem, grouped: Bool = false) -> some View {
        Button {
            if pairing != nil { select(item) } else { customizing = Customizing(id: item.id) }
        } label: {
            ItemRow(
                item: item,
                superset: grouped ? nil : item.supersetId.flatMap { labels[$0] },
                selection: pairing.map { $0.contains(item.id) },
                remove: item.locked ? nil : { withAnimation(.snappy) { draft.remove(item.id) } },
                resume: { withAnimation(.snappy) { draft.resume(item.id) } }
            )
        }
        .buttonStyle(.plain)
        .contextMenu {
            if item.skipped {
                Button("Retomar", systemImage: "arrow.uturn.backward") { withAnimation(.snappy) { draft.resume(item.id) } }
            }
            if item.supersetId != nil {
                Button("Separar de la superserie", systemImage: "link.badge.plus") { unpair(item) }
            }
            if !item.locked {
                Button("Quitar", systemImage: "trash", role: .destructive) { withAnimation(.snappy) { draft.remove(item.id) } }
            }
        }
    }

    // MARK: Bottom bar

    private var bottomBar: some View {
        Group {
            if let pairing {
                VStack(spacing: 10) {
                    Text(pairError ? "Elige dos ejercicios de fuerza seguidos." : pairing.isEmpty ? "Toca dos ejercicios seguidos para hacerlos en superserie." : "Ahora el de justo antes o después.")
                        .font(.subheadline)
                        .foregroundStyle(pairError ? AnyShapeStyle(.orange) : AnyShapeStyle(.secondary))
                        .multilineTextAlignment(.center)
                        .contentTransition(.opacity)
                    Button("Cancelar") { withAnimation(.snappy) { self.pairing = nil } }
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .buttonStyle(.glass)
                }
            } else {
                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        barButton("Añadir ejercicio", "plus") { adding = .exercise }
                        barButton("Añadir superserie", "link") {
                            withAnimation(.snappy) {
                                pairError = false
                                pairing = []
                            }
                        }
                        .disabled(items.count(where: { !$0.isCardio }) < 2)
                        barButton("Añadir cardio", "figure.run") { adding = .cardio }
                    }
                }
            }
        }
        .padding(.horizontal, Theme.padding)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .animation(.snappy, value: pairing)
    }

    private func barButton(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: symbol).font(.title3)
                Text(title)
                    .font(.caption.weight(.semibold))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, minHeight: 56)
        }
        .buttonStyle(.glass)
    }

    // MARK: Supersets

    private func select(_ item: ListItem) {
        guard var chosen = pairing else { return }
        pairError = false
        if let at = chosen.firstIndex(of: item.id) {
            chosen.remove(at: at)
            pairing = chosen
            return
        }
        chosen.append(item.id)
        guard chosen.count == 2 else { return pairing = chosen }
        let ids = items.map(\.supersetId)
        let cardio = items.map(\.isCardio)
        guard let a = items.firstIndex(where: { $0.id == chosen[0] }), let b = items.firstIndex(where: { $0.id == chosen[1] }),
              let paired = Superset.pair(a, b, in: ids, cardio: cardio) else {
            pairError = true
            pairing = []
            return
        }
        withAnimation(.snappy) {
            draft.setSupersets(paired)
            pairing = nil
        }
    }

    private func unpair(_ item: ListItem) {
        guard let index = items.firstIndex(of: item) else { return }
        withAnimation(.snappy) { draft.setSupersets(Superset.unpair(index, in: items.map(\.supersetId), cardio: items.map(\.isCardio))) }
    }

    // MARK: Saving

    /// Each exercise without logged work for its closest alternative, preferred equipment first.
    private func swapAll() async {
        guard let api = PulsoModel.shared.api else { return }
        swappingAll = true
        defer { swappingAll = false }
        for item in items where !item.locked && !item.isCardio {
            guard let best = try? await api.similarExercises(item.exerciseId, limit: 1).first else { continue }
            withAnimation(.snappy) { _ = draft.swap(item.id, to: best.library) }
        }
    }

    private func save() {
        saving = true
        error = nil
        Task {
            defer { saving = false }
            do {
                try await draft.save()
                dismiss()
            } catch let failure {
                error = failure.localizedDescription
            }
        }
    }
}

/// A superset's members in one row: "Superserie 1" once, the accent bar down
/// the side, the exercises stacked.
private struct SupersetGroup<Members: View>: View {
    let number: Int?
    @ViewBuilder let members: Members

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(number.map { "Superserie \($0)" } ?? "Superserie", systemImage: "link")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.training)
            members
        }
        .padding(.vertical, 4)
        .overlay(alignment: .leading) {
            Capsule().fill(Theme.training).frame(width: 3).padding(.vertical, 2).offset(x: -10)
        }
    }
}

/// Thumbnail with a red remove badge, name, target, superset and the worked muscles.
private struct ItemRow: View {
    let item: ListItem
    let superset: Int?
    /// While pairing: whether it is chosen.
    let selection: Bool?
    let remove: (() -> Void)?
    let resume: () -> Void

    private var muscles: [Muscle] { ExerciseCatalog.shared.details[item.exerciseId]?.primaryMuscles ?? [] }

    var body: some View {
        HStack(spacing: 12) {
            if let selection {
                Image(systemName: selection ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(selection ? Theme.training : .secondary)
                    .contentTransition(.symbolEffect(.replace))
            }
            ExerciseMediaView(path: item.thumbnail, cornerRadius: 12)
                .frame(width: 56, height: 56)
                .saturation(item.skipped ? 0 : 1)
                .opacity(item.skipped ? 0.6 : 1)
                .overlay(alignment: .topLeading) {
                    if let remove, selection == nil {
                        Button(action: remove) {
                            Image(systemName: "minus.circle.fill")
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, .red)
                                .font(.title3)
                                .frame(width: 32, height: 32)
                                .contentShape(Circle())
                        }
                        .buttonStyle(.plain)
                        .offset(x: -12, y: -12)
                        .accessibilityLabel("Quitar \(item.name)")
                    }
                }
            VStack(alignment: .leading, spacing: 3) {
                Text(item.name)
                    .font(.body.weight(.semibold))
                    .strikethrough(item.skipped, color: .secondary)
                    .foregroundStyle(item.skipped ? .secondary : .primary)
                    .lineLimit(2)
                Text(item.detail)
                    .font(.subheadline)
                    .fontDesign(.rounded)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                if superset != nil || item.status != nil {
                    HStack(spacing: 6) {
                        if let superset { ReasonTag(text: "Superserie \(superset)") }
                        if let status = item.status { ReasonTag(text: status, tint: item.skipped ? .orange : .secondary) }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if item.skipped, selection == nil {
                Button("Retomar", action: resume)
                    .font(.subheadline.weight(.semibold))
                    .buttonStyle(.glass)
                    .tint(Theme.training)
            } else if !muscles.isEmpty {
                MuscleBadge(primary: muscles)
                    .accessibilityLabel(muscles.map(\.label).joined(separator: ", "))
            }
        }
        .padding(.vertical, 4)
        .overlay(alignment: .leading) {
            if superset != nil {
                Capsule().fill(Theme.training).frame(width: 3).padding(.vertical, 2).offset(x: -10)
            }
        }
        .contentShape(.rect)
    }
}

// MARK: - Personalizar ejercicio

/// One exercise's sets, repetitions (as a range that moves whole), load and
/// rest, its swap, and where the changes apply. A half sheet.
struct CustomizeExerciseSheet<Draft: ListDraft>: View {
    @Bindable var draft: Draft
    @State var id: String
    @Environment(\.dismiss) private var dismiss
    @State private var initial: ExerciseCustomization?
    @State private var value: ExerciseCustomization?
    @State private var swapping = false
    @State private var more = false

    private var item: ListItem? { draft.items.first { $0.id == id } }

    var body: some View {
        NavigationStack {
            ScrollView {
                if let item, let value {
                    VStack(alignment: .leading, spacing: 14) {
                        header(item)
                        if value.isCardio { cardio(value) } else { strength(value) }
                        scope
                        if draft.moreSettings(id) != nil {
                            Button { more = true } label: {
                                Label("Descanso, esfuerzo y notas", systemImage: "slider.horizontal.3")
                                    .frame(maxWidth: .infinity, minHeight: 44)
                            }
                            .buttonStyle(.glass)
                        }
                    }
                    .padding(Theme.padding)
                    .animation(.snappy, value: value)
                }
            }
            .navigationTitle("Personalizar ejercicio")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Descartar") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Listo") {
                        if let initial, let value, value != initial { draft.apply(value, was: initial, to: id) }
                        dismiss()
                    }
                    .buttonStyle(.glassProminent)
                    .tint(Theme.training)
                }
            }
            .navigationDestination(isPresented: $more) {
                if let view = draft.moreSettings(id) { view }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .sensoryFeedback(.selection, trigger: value)
        .onAppear(perform: load)
        .onChange(of: more) { _, open in
            // Back from the fuller editor: start from what it saved.
            if !open { load() }
        }
        .sheet(isPresented: $swapping) {
            if let item {
                SwapExerciseSheet(exerciseId: item.exerciseId, name: item.name, scopes: [draft.scope], initialScope: draft.scope) { picked, _ in
                    if let new = draft.swap(id, to: picked) {
                        id = new
                        load()
                    }
                }
            }
        }
    }

    private func load() {
        let fresh = draft.customization(id)
        // Keep pending edits to fields the reload didn't touch.
        if let value, let initial, let fresh, value != initial {
            var merged = fresh
            if value.sets != initial.sets { merged.sets = value.sets }
            if value.repMin != initial.repMin || value.repMax != initial.repMax { (merged.repMin, merged.repMax) = (value.repMin, value.repMax) }
            if value.weightKg != initial.weightKg { merged.weightKg = value.weightKg }
            if value.restSeconds != initial.restSeconds { merged.restSeconds = value.restSeconds }
            if value.durationMinutes != initial.durationMinutes { merged.durationMinutes = value.durationMinutes }
            self.value = merged
        } else {
            value = fresh
        }
        initial = fresh
    }

    private func header(_ item: ListItem) -> some View {
        HStack(spacing: 12) {
            ExerciseMediaView(path: item.thumbnail, cornerRadius: 12)
                .frame(width: 56, height: 56)
            Text(item.name)
                .font(.headline)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button { swapping = true } label: {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.title3)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .tint(Theme.training)
            .accessibilityLabel("Cambiar ejercicio")
        }
        .padding(12)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
    }

    private func change(_ edit: (inout ExerciseCustomization) -> Void) {
        guard var next = value else { return }
        edit(&next)
        value = next
    }

    @ViewBuilder
    private func strength(_ v: ExerciseCustomization) -> some View {
        BigStepper(title: "Series", value: "\(v.sets)", canMinus: v.sets > max(1, v.minSets), canPlus: v.sets < 20) {
            change { $0.sets -= 1 }
        } plus: {
            change { $0.sets += 1 }
        }
        BigStepper(title: "Repeticiones", value: v.repMin == v.repMax ? "\(v.repMin)" : "\(v.repMin)–\(v.repMax)", canMinus: v.repMin > 1, canPlus: v.repMax < 50) {
            change { $0.repMin -= 1; $0.repMax -= 1 }
        } plus: {
            change { $0.repMin += 1; $0.repMax += 1 }
        }
        .accessibilityValue(TrainingText.reps(v.repMin, v.repMax))
        if v.needsLoad {
            let unit = TrainingStore.shared.unit(for: v.exerciseId)
            let kg = (v.weightKg ?? v.suggestedKg).map(unit.snapKg)
            let value = kg.map(unit.snap) ?? 0
            BigStepper(title: v.weightKg == nil ? "Peso sugerido" : "Peso", value: kg.map(unit.format) ?? "Sin peso", detail: kg.flatMap { $0 > 0 ? unit.other.format($0) : nil },
                       canMinus: value > 0, canPlus: true) {
                change { $0.weightKg = unit.fromUnit(unit.stepDown(value)) }
            } plus: {
                change { $0.weightKg = unit.fromUnit(unit.stepUp(value)) }
            }
            HStack {
                Text("Unidad de esta máquina")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 8)
                UnitPicker(exerciseId: v.exerciseId)
            }
            .padding(.horizontal, 4)
            if v.suggestible, v.weightKg != nil {
                Button("Usar el peso sugerido") { change { $0.weightKg = nil } }
                    .font(.subheadline)
                    .frame(maxWidth: .infinity)
            }
        }
        BigStepper(title: "Descanso", value: TrainingText.rest(v.restSeconds), canMinus: v.restSeconds > 0, canPlus: v.restSeconds < 600) {
            change { $0.restSeconds = max(0, $0.restSeconds - 15) }
        } plus: {
            change { $0.restSeconds += 15 }
        }
    }

    @ViewBuilder
    private func cardio(_ v: ExerciseCustomization) -> some View {
        let minutes = v.durationMinutes ?? 0
        BigStepper(title: "Duración", value: minutes > 0 ? "\(minutes.formatted()) min" : "Libre", canMinus: minutes > 0, canPlus: minutes < 240) {
            change { $0.durationMinutes = minutes > 5 ? minutes - 5 : nil }
        } plus: {
            change { $0.durationMinutes = minutes + 5 }
        }
    }

    private var scope: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Aplicar cambios a:")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            VStack(spacing: 0) {
                ForEach([EditScope.today, .always], id: \.self) { option in
                    Button { draft.scope = option } label: {
                        HStack(spacing: 12) {
                            Image(systemName: draft.scope == option ? "largecircle.fill.circle" : "circle")
                                .font(.title3)
                                .foregroundStyle(draft.scope == option ? Theme.training : .secondary)
                                .contentTransition(.symbolEffect(.replace))
                            VStack(alignment: .leading, spacing: 1) {
                                Text(option.applyLabel).font(.body.weight(.medium))
                                Text(option.explanation).font(.caption).foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(.horizontal, 12)
                        .frame(minHeight: 56)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(draft.scope == option ? .isSelected : [])
                    if option == .today { Divider().padding(.leading, 48) }
                }
            }
            .background(.background.secondary, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
        }
        .sensoryFeedback(.selection, trigger: draft.scope)
    }
}

/// −  3  +  with a caption (and an optional line under the value), on a card.
private struct BigStepper: View {
    let title: String
    let value: String
    var detail: String? = nil
    var canMinus = true
    var canPlus = true
    let minus: () -> Void
    let plus: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            RoundStepButton(systemImage: "minus", action: minus)
                .disabled(!canMinus)
                .accessibilityLabel("Menos")
            VStack(spacing: 0) {
                Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Text(value)
                    .font(.system(.title, design: .rounded, weight: .bold))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let detail {
                    Text(detail)
                        .font(.caption)
                        .fontDesign(.rounded)
                        .foregroundStyle(.secondary)
                        .contentTransition(.numericText())
                }
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)
            RoundStepButton(systemImage: "plus", action: plus)
                .disabled(!canPlus)
                .accessibilityLabel("Más")
        }
        .padding(10)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
    }
}
