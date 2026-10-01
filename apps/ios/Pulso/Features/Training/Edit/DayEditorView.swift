import SwiftUI

/// Rewrites a program day by hand: reorder, add, remove, swap and set each target,
/// then save it for today only or for good. The whole list goes in one write.
struct DayEditorView: View {
    let day: ProgramDay
    var suggestions: [String: LoadSuggestion] = [:]
    var hrZones: [HrZoneRange]?

    @Environment(\.dismiss) private var dismiss
    @State private var exercises: [ProgramExercise]
    @State private var scope: EditScope
    /// Stills for exercises added here, by exercise id (the catalog has the rest).
    @State private var thumbnails: [String: String] = [:]
    @State private var path: [String] = []
    @State private var editMode: EditMode = .inactive
    @State private var adding = false
    @State private var swapping: ProgramExercise?
    @State private var saving = false
    @State private var error: String?
    @State private var confirmDiscard = false

    init(day: ProgramDay, suggestions: [String: LoadSuggestion] = [:], hrZones: [HrZoneRange]? = nil) {
        self.day = day
        self.suggestions = suggestions
        self.hrZones = hrZones
        _exercises = State(initialValue: day.exercises)
        // A day already changed for today keeps being edited for today.
        _scope = State(initialValue: day.overridden == true ? .today : .always)
    }

    private var changed: Bool { exercises != day.exercises }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    if exercises.isEmpty {
                        EmptyStateView(systemImage: "figure.cooldown", title: "Día sin ejercicios", message: "Añade el primero desde la biblioteca.", tint: Theme.training, actionTitle: "Añadir ejercicio") {
                            adding = true
                        }
                        .listRowBackground(Color.clear)
                    }
                    ForEach(exercises) { exercise in
                        Button { path.append(exercise.id) } label: {
                            EditorRow(exercise: exercise, suggestion: suggestions[exercise.id], thumbnail: thumbnail(exercise), editing: editMode.isEditing)
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing) {
                            Button("Quitar", systemImage: "trash", role: .destructive) { remove(exercise) }
                        }
                        .swipeActions(edge: .leading) {
                            Button("Cambiar", systemImage: "arrow.triangle.2.circlepath") { swapping = exercise }
                                .tint(Theme.training)
                        }
                        .contextMenu {
                            Button("Cambiar ejercicio", systemImage: "arrow.triangle.2.circlepath") { swapping = exercise }
                            Button("Quitar", systemImage: "trash", role: .destructive) { remove(exercise) }
                        }
                    }
                    .onMove { exercises.move(fromOffsets: $0, toOffset: $1) }
                    .onDelete { exercises.remove(atOffsets: $0) }
                } header: {
                    header
                } footer: {
                    if exercises.count > 1 { Text("Mantén pulsado para reordenar; desliza para cambiar o quitar.") }
                }

                Section {
                    Button { adding = true } label: {
                        Label("Añadir ejercicio", systemImage: "plus.circle.fill")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Theme.training)
                    }
                }
            }
            .environment(\.editMode, $editMode)
            .animation(.snappy, value: exercises)
            .sensoryFeedback(.impact(weight: .light), trigger: exercises.map(\.id))
            .safeAreaBar(edge: .bottom, spacing: 0) { saveBar }
            .navigationTitle("Editar día")
            .navigationSubtitle(day.name)
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: String.self) { id in
                if let index = exercises.firstIndex(where: { $0.id == id }) {
                    ExerciseTargetEditor(exercise: $exercises[index], suggestion: suggestions[id], hrZones: hrZones, thumbnail: thumbnail(exercises[index]))
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar", systemImage: "xmark") {
                        if changed { confirmDiscard = true } else { dismiss() }
                    }
                    .confirmationDialog("¿Descartar los cambios?", isPresented: $confirmDiscard, titleVisibility: .visible) {
                        Button("Descartar cambios", role: .destructive) { dismiss() }
                        Button("Seguir editando", role: .cancel) {}
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button(editMode.isEditing ? "Listo" : "Ordenar") {
                        withAnimation(.snappy) { editMode = editMode.isEditing ? .inactive : .active }
                    }
                    .disabled(exercises.isEmpty)
                }
            }
        }
        .interactiveDismissDisabled(changed || saving)
        .sheet(isPresented: $adding) {
            ExercisePickerSheet { add($0) }
        }
        .sheet(item: $swapping) { exercise in
            // The editor's own scope applies on save, so the sheet doesn't ask.
            SwapExerciseSheet(exerciseId: exercise.exerciseId, name: exercise.exerciseName, scopes: [scope], initialScope: scope) { library, _ in
                swap(exercise, to: library)
            }
        }
    }

    private var header: some View {
        HStack(spacing: 6) {
            Text("\(exercises.count) \(exercises.count == 1 ? "ejercicio" : "ejercicios")")
                .contentTransition(.numericText())
            if day.overridden == true {
                Text("· con cambios de hoy")
            }
        }
    }

    /// When the edit applies, then save. Thumb-reachable, always in view.
    private var saveBar: some View {
        VStack(spacing: 10) {
            if let error {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.orange)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .transition(.opacity)
            }
            Picker("Aplicar", selection: $scope) {
                ForEach(EditScope.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            Text(scope.explanation)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentTransition(.opacity)
            Button(action: save) {
                Group {
                    if saving {
                        ProgressView().tint(.white)
                    } else {
                        Text(scope == .today ? "Guardar solo para hoy" : "Guardar en el programa")
                    }
                }
                .font(.headline)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
            }
            .buttonStyle(.glassProminent)
            .tint(Theme.training)
            .disabled(saving || exercises.isEmpty && day.exercises.isEmpty)
        }
        .padding(.horizontal, Theme.padding)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .sensoryFeedback(.selection, trigger: scope)
        .animation(.snappy, value: scope)
        .animation(.snappy, value: error)
    }

    private func thumbnail(_ exercise: ProgramExercise) -> String? {
        thumbnails[exercise.exerciseId] ?? cachedThumbnail(exercise.exerciseId)
    }

    private func add(_ library: LibraryExercise) {
        thumbnails[library.id] = library.thumbnail
        exercises.append(.draft(library))
    }

    private func swap(_ exercise: ProgramExercise, to library: LibraryExercise) {
        guard let index = exercises.firstIndex(of: exercise) else { return }
        thumbnails[library.id] = library.thumbnail
        exercises[index] = exercise.swapped(to: library)
    }

    private func remove(_ exercise: ProgramExercise) {
        exercises.removeAll { $0.id == exercise.id }
    }

    private func save() {
        saving = true
        error = nil
        Task {
            defer { saving = false }
            do {
                try await TrainingStore.shared.saveDay(day.id, scope: scope, exercises: exercises.map(\.editInput))
                dismiss()
            } catch let failure {
                error = failure.localizedDescription
            }
        }
    }
}

/// An exercise in the editor: still, name and its target in one line.
private struct EditorRow: View {
    let exercise: ProgramExercise
    let suggestion: LoadSuggestion?
    let thumbnail: String?
    let editing: Bool

    var body: some View {
        HStack(spacing: 12) {
            ExerciseMediaView(path: thumbnail, cornerRadius: 10)
                .frame(width: 46, height: 46)
            VStack(alignment: .leading, spacing: 2) {
                Text(exercise.exerciseName)
                    .font(.body.weight(.semibold))
                    .lineLimit(2)
                Text(TrainingFormat.summary(exercise, suggestion: suggestion))
                    .font(.subheadline)
                    .fontDesign(.rounded)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 4)
            if exercise.isDraft {
                ReasonTag(text: "Nuevo")
            }
            if !editing {
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
        .contentShape(.rect)
    }
}

#if DEBUG
#Preview("Editar día · 375 pt", traits: .fixedLayout(width: 375, height: 812)) {
    DayEditorView(day: .editorPreview, hrZones: HrZoneRange.previews)
}

#Preview("Editar día · 440 pt, claro", traits: .fixedLayout(width: 440, height: 956)) {
    DayEditorView(day: .editorPreview).preferredColorScheme(.light)
}

#Preview("Editar día · XXL", traits: .fixedLayout(width: 375, height: 812)) {
    DayEditorView(day: .editorPreview).dynamicTypeSize(.xxLarge)
}

#Preview("Editar día · vacío", traits: .fixedLayout(width: 375, height: 812)) {
    DayEditorView(day: ProgramDay(id: "d", name: "Pierna B", focus: nil, weekday: nil, exercises: []))
}
#endif
