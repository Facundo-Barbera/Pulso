import SwiftUI

/// "Editar sesión", for this session only: drag to reorder, swipe to skip or
/// remove, tap for the targets, and add from the library. Every change applies
/// to the live session right away (and reaches the engine shortly after).
struct EditSessionSheet: View {
    let session: LiveSession
    @Environment(\.dismiss) private var dismiss
    @State private var adding = false

    private var exercises: [LiveExercise] { session.state.exercises }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(Array(exercises.enumerated()), id: \.element.id) { index, exercise in
                        NavigationLink(value: exercise.id) {
                            EditRow(exercise: exercise, current: index == session.state.focus)
                        }
                        .deleteDisabled(exercise.hasDoneWork)
                        .swipeActions(edge: .leading) {
                            Button(exercise.skipped ? "Retomar" : "Saltar", systemImage: exercise.skipped ? "arrow.uturn.backward" : "forward") {
                                withAnimation(.snappy) { session.setSkipped(index, !exercise.skipped) }
                            }
                            .tint(Theme.training)
                        }
                    }
                    .onMove { source, destination in
                        withAnimation(.snappy) { session.move(fromOffsets: source, toOffset: destination) }
                    }
                    .onDelete { offsets in
                        withAnimation(.snappy) { offsets.sorted(by: >).forEach(session.remove) }
                    }
                } footer: {
                    Text("Mantén pulsado y arrastra para reordenar. Los cambios son solo para hoy; un ejercicio con series hechas se puede saltar, no quitar.")
                }

                Section {
                    Button {
                        adding = true
                    } label: {
                        Label("Añadir ejercicio", systemImage: "plus.circle.fill")
                            .font(.body.weight(.semibold))
                            .frame(minHeight: 44)
                    }
                    .tint(Theme.training)
                }
            }
            .navigationTitle("Editar sesión")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: String.self) { id in
                TargetEditor(session: session, exerciseId: id)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { EditButton() }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Listo", systemImage: "checkmark") { dismiss() }
                        .buttonStyle(.glassProminent)
                        .tint(Theme.training)
                }
            }
            .sheet(isPresented: $adding) {
                ExercisePickerSheet { picked in
                    withAnimation(.snappy) { session.add(picked) }
                    adding = false
                }
            }
            .overlay {
                if exercises.isEmpty {
                    EmptyStateView(systemImage: "dumbbell", title: "Sin ejercicios", message: "Añade el primero de hoy.", tint: Theme.training, actionTitle: "Añadir ejercicio") { adding = true }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

private struct EditRow: View {
    let exercise: LiveExercise
    let current: Bool

    private var status: (String, String)? {
        if exercise.skipped { return ("Saltado", "forward") }
        if exercise.done { return ("Hecho", "checkmark.circle.fill") }
        if current { return ("En pantalla", "eye") }
        return nil
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: exercise.isCardio ? CardioCue.symbol(exercise.modality) : "dumbbell.fill")
                .font(.headline)
                .foregroundStyle(exercise.isCardio ? Theme.energy : Theme.training)
                .frame(width: 36, height: 36)
                .background((exercise.isCardio ? Theme.energy : Theme.training).opacity(0.14), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(exercise.name)
                    .font(.body.weight(.semibold))
                    .strikethrough(exercise.skipped)
                    .lineLimit(2)
                Text(exercise.target)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let (label, symbol) = status {
                Image(systemName: symbol)
                    .foregroundStyle(exercise.done ? Theme.training : .secondary)
                    .accessibilityLabel(label)
            }
        }
        .opacity(exercise.skipped ? 0.55 : 1)
        .padding(.vertical, 4)
    }
}

/// Today's targets for one exercise: sets, reps, load and rest (or the cardio block's).
private struct TargetEditor: View {
    let session: LiveSession
    let exerciseId: String
    @Environment(\.dismiss) private var dismiss

    private var index: Int? { session.state.exercises.firstIndex { $0.id == exerciseId } }

    var body: some View {
        if let index {
            let exercise = session.state.exercises[index]
            Form {
                if exercise.isCardio {
                    cardio(exercise, index)
                } else {
                    strength(exercise, index)
                }
                Section {
                    Toggle("Saltar hoy", systemImage: "forward", isOn: Binding(
                        get: { session.state.exercises.indices.contains(index) && session.state.exercises[index].skipped },
                        set: { session.setSkipped(index, $0) }
                    ))
                    if !exercise.hasDoneWork {
                        Button("Quitar de la sesión", systemImage: "trash", role: .destructive) {
                            dismiss()
                            session.remove(at: index)
                        }
                    }
                } footer: {
                    Text("Solo para esta sesión.")
                }
            }
            .navigationTitle(exercise.name)
            .navigationBarTitleDisplayMode(.inline)
        } else {
            EmptyStateView(systemImage: "questionmark.circle", title: "Ya no está en la sesión", tint: Theme.training)
        }
    }

    @ViewBuilder
    private func strength(_ exercise: LiveExercise, _ index: Int) -> some View {
        let done = exercise.sets.filter(\.done).count
        let update = { (sets: Int, repMin: Int, repMax: Int, weight: Double?, rest: Int) in
            session.updateTarget(index, sets: sets, repMin: repMin, repMax: repMax, weightKg: weight, restSeconds: rest)
        }
        Section {
            Stepper(value: Binding(get: { exercise.sets.count }, set: { update($0, exercise.repMin, exercise.repMax, nil, exercise.restSeconds) }), in: max(1, done)...20) {
                value("Series", "\(exercise.sets.count)")
            }
            Stepper(value: Binding(get: { exercise.repMin }, set: { update(exercise.sets.count, $0, max($0, exercise.repMax), nil, exercise.restSeconds) }), in: 1...50) {
                value("Reps mínimas", "\(exercise.repMin)")
            }
            Stepper(value: Binding(get: { exercise.repMax }, set: { update(exercise.sets.count, min(exercise.repMin, $0), $0, nil, exercise.restSeconds) }), in: 1...50) {
                value("Reps máximas", "\(exercise.repMax)")
            }
            Stepper(value: Binding(get: { exercise.workingWeight }, set: { update(exercise.sets.count, exercise.repMin, exercise.repMax, $0, exercise.restSeconds) }), in: 0...500, step: exercise.weightStep) {
                value("Peso", "\(exercise.workingWeight.formatted()) kg")
            }
            Stepper(value: Binding(get: { exercise.restSeconds }, set: { update(exercise.sets.count, exercise.repMin, exercise.repMax, nil, $0) }), in: 0...600, step: 15) {
                value("Descanso", Duration.seconds(exercise.restSeconds).formatted(.time(pattern: .minuteSecond)))
            }
        } header: {
            Text("Objetivo de hoy")
        } footer: {
            if done > 0 { Text("El peso y las repeticiones cambian en las series que faltan; las \(done) hechas se quedan como están.") }
        }
    }

    @ViewBuilder
    private func cardio(_ exercise: LiveExercise, _ index: Int) -> some View {
        let target = exercise.cardio ?? CardioTarget()
        let set = { (change: (inout CardioTarget) -> Void) in
            var next = target
            change(&next)
            session.updateCardioTarget(index, next)
        }
        Section("Objetivo de hoy") {
            if let intervals = target.intervals {
                let change = { (edit: (inout CardioIntervals) -> Void) in
                    var next = intervals
                    edit(&next)
                    set { $0.intervals = next }
                }
                Stepper(value: Binding(get: { intervals.rounds }, set: { value in change { $0.rounds = value } }), in: 1...40) {
                    value("Rondas", "\(intervals.rounds)")
                }
                Stepper(value: Binding(get: { intervals.workSeconds }, set: { value in change { $0.workSeconds = value } }), in: 5...600, step: 5) {
                    value(intervals.workLabel ?? "Rápido", CardioCue.clock(Double(intervals.workSeconds)))
                }
                Stepper(value: Binding(get: { intervals.restSeconds }, set: { value in change { $0.restSeconds = value } }), in: 0...600, step: 5) {
                    value(intervals.restLabel ?? "Suave", CardioCue.clock(Double(intervals.restSeconds)))
                }
            } else {
                Stepper(value: Binding(get: { target.durationMinutes ?? 0 }, set: { minutes in set { $0.durationMinutes = minutes > 0 ? minutes : nil } }), in: 0...240, step: 1) {
                    value("Duración", target.durationMinutes.map { "\($0.formatted()) min" } ?? "Libre")
                }
            }
            Picker(selection: Binding(get: { target.zone ?? 0 }, set: { zone in set { $0.zone = zone == 0 ? nil : zone } })) {
                Text("Sin zona").tag(0)
                ForEach(1...5, id: \.self) { zone in
                    Text(CardioCue.zone(zone, zones: TrainingStore.shared.hrZones) ?? "Zona \(zone)").tag(zone)
                }
            } label: {
                Label("Zona", systemImage: "heart.fill")
            }
        }
    }

    private func value(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title)
            Spacer(minLength: 8)
            Text(value)
                .fontWeight(.semibold)
                .fontDesign(.rounded)
                .monospacedDigit()
                .contentTransition(.numericText())
                .foregroundStyle(Theme.training)
        }
    }
}

#if DEBUG
#Preview("Editar sesión · 375 pt", traits: .fixedLayout(width: 375, height: 812)) {
    EditSessionSheet(session: LiveSession(state: .preview))
}

#Preview("Editar sesión · 440 pt, claro", traits: .fixedLayout(width: 440, height: 956)) {
    EditSessionSheet(session: LiveSession(state: .preview))
        .preferredColorScheme(.light)
}

#Preview("Editar sesión · 375 pt, XXL", traits: .fixedLayout(width: 375, height: 812)) {
    EditSessionSheet(session: LiveSession(state: .preview))
        .dynamicTypeSize(.xxLarge)
}
#endif
