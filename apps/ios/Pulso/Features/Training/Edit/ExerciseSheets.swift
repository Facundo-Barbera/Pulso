import SwiftUI

// The live session calls these two sheets too: keep their signatures.

/// Search the library by name, muscle or equipment and pick one exercise (strength or cardio).
/// The person's preferred equipment comes first in the results.
struct ExercisePickerSheet: View {
    var title: String = "Añadir ejercicio"
    /// The muscle chip selected on open ("cardio" for "Añadir cardio").
    var initialMuscle: String? = nil
    let onPick: (LibraryExercise) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var phase: LoadPhase<[LibraryExercise]> = .loading
    @State private var query = ""
    @State private var muscle: String?
    @State private var equipment: Set<String> = []

    private var filtering: Bool { muscle != nil || !equipment.isEmpty }

    private var results: [LibraryExercise] {
        guard case let .loaded(all) = phase else { return [] }
        let text = query.trimmingCharacters(in: .whitespaces)
        return all
            .filter { exercise in
                (text.isEmpty || exercise.name.localizedStandardContains(text))
                    && (muscle == nil || exercise.muscle == muscle)
                    && (equipment.isEmpty || equipment.contains(exercise.equipment))
            }
            .sorted { a, b in
                let (ra, rb) = (equipmentRank(a.equipment), equipmentRank(b.equipment))
                return ra != rb ? ra < rb : a.name.localizedStandardCompare(b.name) == .orderedAscending
            }
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Buscar ejercicio")
                .safeAreaBar(edge: .top, spacing: 0) { filters }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancelar", systemImage: "xmark") { dismiss() }
                    }
                }
                .sensoryFeedback(.selection, trigger: muscle)
                .sensoryFeedback(.selection, trigger: equipment)
                .animation(.snappy, value: results)
        }
        .task {
            if muscle == nil, let initialMuscle { muscle = initialMuscle }
            if case .loading = phase { await load() }
        }
    }

    @ViewBuilder private var content: some View {
        switch phase {
        case .loading:
            ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
        case let .failed(message):
            ScrollView {
                EmptyStateView(systemImage: "wifi.exclamationmark", title: "No pude cargar los ejercicios", message: message, tint: Theme.training, actionTitle: "Reintentar") {
                    phase = .loading
                    Task { await load() }
                }
            }
        case .loaded where results.isEmpty:
            ScrollView {
                EmptyStateView(
                    systemImage: "magnifyingglass",
                    title: "Sin resultados",
                    message: filtering ? "Prueba con otro nombre o quita los filtros." : "Prueba con otro nombre.",
                    tint: Theme.training,
                    actionTitle: filtering ? "Quitar filtros" : nil
                ) {
                    muscle = nil
                    equipment = []
                }
            }
        case .loaded:
            List(results) { exercise in
                Button {
                    onPick(exercise)
                    dismiss()
                } label: {
                    LibraryRow(name: exercise.name, equipment: exercise.equipment, thumbnail: exercise.thumbnail ?? cachedThumbnail(exercise.id), caption: MuscleGroup.label(exercise.muscle))
                }
                .buttonStyle(.plain)
            }
            .listStyle(.plain)
        }
    }

    private var filters: some View {
        VStack(spacing: 8) {
            ChipRow {
                ForEach(MuscleGroup.all, id: \.self) { id in
                    FilterChip(title: MuscleGroup.label(id), selected: muscle == id) {
                        withAnimation(.snappy) { muscle = muscle == id ? nil : id }
                    }
                }
            }
            ChipRow {
                ForEach(Equipment.all, id: \.self) { id in
                    FilterChip(title: Equipment.label(id), systemImage: Equipment.symbol(id), selected: equipment.contains(id)) {
                        withAnimation(.snappy) { equipment.formSymmetricDifference([id]) }
                    }
                }
            }
        }
        .padding(.vertical, 8)
    }

    private func load() async {
        guard let api = PulsoModel.shared.api else { return }
        do {
            phase = .loaded(try await ExerciseLibrary.load(api))
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }
}

/// "Cambiar ejercicio": alternatives to `exerciseId` ranked by similarity and the
/// person's equipment preference, with equipment filter chips. `scopes` lists the
/// choices offered (one hides the picker); the pick comes back with the chosen scope.
struct SwapExerciseSheet: View {
    let exerciseId: String
    let name: String
    var scopes: [EditScope] = EditScope.allCases
    var initialScope: EditScope = .today
    let onPick: (LibraryExercise, EditScope) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var phase: LoadPhase<[SimilarExercise]> = .loading
    @State private var equipment: Set<String> = []
    @State private var chosenScope: EditScope?
    @State private var showPreferences = false
    @State private var showLibrary = false
    @State private var libraryPick: LibraryExercise?
    /// Bumped to fetch again (the preferences changed the ranking).
    @State private var reloads = 0
    /// Previews hand in their alternatives and never fetch.
    @State private var fixture = false

    private var scope: EditScope { chosenScope ?? (scopes.contains(initialScope) ? initialScope : scopes.first ?? .today) }

    private struct Query: Equatable {
        var equipment: [String]
        var reloads: Int
    }

    private var query: Query { Query(equipment: Equipment.all.filter(equipment.contains), reloads: reloads) }

    var body: some View {
        NavigationStack {
            content
                .safeAreaBar(edge: .top, spacing: 0) { controls }
                .navigationTitle("Cambiar ejercicio")
                .navigationSubtitle("En lugar de \(name)")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancelar", systemImage: "xmark") { dismiss() }
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Button("Preferencias", systemImage: "slider.horizontal.3") { showPreferences = true }
                    }
                }
                .sensoryFeedback(.selection, trigger: equipment)
                .sensoryFeedback(.selection, trigger: chosenScope)
        }
        .task(id: query) { await load() }
        .sheet(isPresented: $showPreferences, onDismiss: { reloads += 1 }) { TrainingPreferencesView() }
        // The pick lands once the library is gone, so two sheets never close at once.
        .sheet(isPresented: $showLibrary, onDismiss: { if let libraryPick { pick(libraryPick) } }) {
            ExercisePickerSheet(title: "Elegir ejercicio") { libraryPick = $0 }
        }
    }

    @ViewBuilder private var content: some View {
        switch phase {
        case .loading:
            ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
        case let .failed(message):
            ScrollView {
                EmptyStateView(systemImage: "wifi.exclamationmark", title: "No pude buscar alternativas", message: message, tint: Theme.training, actionTitle: "Reintentar") {
                    phase = .loading
                    reloads += 1
                }
            }
        case let .loaded(alternatives) where alternatives.isEmpty:
            ScrollView {
                if equipment.isEmpty {
                    EmptyStateView(systemImage: "arrow.triangle.2.circlepath", title: "Sin alternativas parecidas", message: "Busca otro en la biblioteca completa.", tint: Theme.training, actionTitle: "Ver biblioteca") {
                        showLibrary = true
                    }
                } else {
                    EmptyStateView(systemImage: "line.3.horizontal.decrease.circle", title: "Nada con ese equipo", message: "Prueba con otro equipo o quita el filtro.", tint: Theme.training, actionTitle: "Quitar filtro") {
                        withAnimation(.snappy) { equipment = [] }
                    }
                }
            }
        case let .loaded(alternatives):
            List {
                ForEach(alternatives) { alternative in
                    Button { pick(alternative.library) } label: { AlternativeRow(alternative: alternative) }
                        .buttonStyle(.plain)
                }
                Button { showLibrary = true } label: {
                    Label("Buscar otro en la biblioteca", systemImage: "magnifyingglass")
                        .font(.body.weight(.medium))
                        .foregroundStyle(Theme.training)
                        .padding(.vertical, 6)
                }
            }
            .listStyle(.plain)
            .animation(.snappy, value: alternatives)
        }
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 10) {
            if scopes.count > 1 {
                VStack(alignment: .leading, spacing: 6) {
                    Picker("Aplicar", selection: Binding(get: { scope }, set: { chosenScope = $0 })) {
                        ForEach(scopes, id: \.self) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    Text(scope.explanation)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .contentTransition(.opacity)
                }
                .padding(.horizontal, Theme.padding)
            }
            ChipRow {
                ForEach(Equipment.all, id: \.self) { id in
                    FilterChip(title: Equipment.label(id), systemImage: Equipment.symbol(id), selected: equipment.contains(id)) {
                        withAnimation(.snappy) { equipment.formSymmetricDifference([id]) }
                    }
                }
            }
        }
        .padding(.vertical, 8)
        .animation(.snappy, value: scope)
    }

    private func pick(_ exercise: LibraryExercise) {
        onPick(exercise, scope)
        dismiss()
    }

    private func load() async {
        guard !fixture, let api = PulsoModel.shared.api else { return }
        do {
            let alternatives = try await api.similarExercises(exerciseId, equipment: query.equipment, limit: 30)
            withAnimation(.snappy) { phase = .loaded(alternatives) }
        } catch {
            // A newer filter cancelled this request: not a failure to show.
            guard !Task.isCancelled else { return }
            phase = .failed(error.localizedDescription)
        }
    }
}

#if DEBUG
extension SwapExerciseSheet {
    /// Shows `alternatives` without fetching.
    init(preview alternatives: [SimilarExercise], name: String, scopes: [EditScope] = EditScope.allCases) {
        self.init(exerciseId: "preview", name: name, scopes: scopes) { _, _ in }
        _phase = State(initialValue: .loaded(alternatives))
        _fixture = State(initialValue: true)
    }
}

extension ExercisePickerSheet {
    /// Shows `library` without fetching.
    init(preview library: [LibraryExercise]) {
        self.init { _ in }
        _phase = State(initialValue: .loaded(library))
    }
}
#endif

/// One alternative: still, name, equipment, why it fits and whether its equipment is preferred.
private struct AlternativeRow: View {
    let alternative: SimilarExercise

    /// The equipment already shows on the row; don't repeat it as a reason.
    private var reasons: [String] {
        Array(alternative.reasons.filter { $0 != Equipment.label(alternative.equipment) }.prefix(2))
    }

    var body: some View {
        LibraryRow(name: alternative.name, equipment: alternative.equipment, thumbnail: alternative.thumbnail ?? cachedThumbnail(alternative.id)) {
            if !reasons.isEmpty || alternative.preferred {
                ViewThatFits(in: .horizontal) {
                    tags(reasons)
                    tags(Array(reasons.prefix(1)))
                    tags([])
                }
                .padding(.top, 2)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint(alternative.preferred ? "Equipo preferido" : "")
    }

    private func tags(_ shown: [String]) -> some View {
        HStack(spacing: 6) {
            if alternative.preferred {
                Image(systemName: "star.fill")
                    .font(.caption2)
                    .foregroundStyle(Theme.carbs)
                    .accessibilityLabel("Preferido")
            }
            ForEach(shown, id: \.self) { ReasonTag(text: $0) }
        }
    }
}

extension EditScope {
    /// One line under the scope picker.
    var explanation: String {
        switch self {
        case .today: "Solo la sesión de hoy; tu programa no cambia."
        case .always: "Cambia el programa desde ahora."
        }
    }
}

#if DEBUG
#Preview("Cambiar · 375 pt", traits: .fixedLayout(width: 375, height: 760)) {
    SwapExerciseSheet(preview: SimilarExercise.previews, name: "Press de banca")
}

#Preview("Cambiar · 440 pt, claro", traits: .fixedLayout(width: 440, height: 900)) {
    SwapExerciseSheet(preview: SimilarExercise.previews, name: "Press de banca", scopes: [.today])
        .preferredColorScheme(.light)
}

#Preview("Cambiar · XXL", traits: .fixedLayout(width: 375, height: 760)) {
    SwapExerciseSheet(preview: SimilarExercise.previews, name: "Press inclinado con mancuernas en banco a 30 grados")
        .dynamicTypeSize(.xxLarge)
}

#Preview("Cambiar · vacío", traits: .fixedLayout(width: 375, height: 700)) {
    SwapExerciseSheet(preview: [], name: "Press de banca")
}

#Preview("Biblioteca · 375 pt", traits: .fixedLayout(width: 375, height: 760)) {
    ExercisePickerSheet(preview: LibraryExercise.previews)
}

#Preview("Biblioteca · 440 pt, claro", traits: .fixedLayout(width: 440, height: 900)) {
    ExercisePickerSheet(preview: LibraryExercise.previews).preferredColorScheme(.light)
}

#Preview("Biblioteca · XXL", traits: .fixedLayout(width: 375, height: 760)) {
    ExercisePickerSheet(preview: LibraryExercise.previews).dynamicTypeSize(.xxLarge)
}
#endif
