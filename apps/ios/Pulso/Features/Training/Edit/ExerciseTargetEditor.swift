import SwiftUI

/// One exercise's target inside the day editor: series, reps, load, rest and effort
/// for strength; duration, zone, pace, machine settings and intervals for cardio.
struct ExerciseTargetEditor: View {
    @Binding var exercise: ProgramExercise
    var suggestion: LoadSuggestion?
    var hrZones: [HrZoneRange]?
    var thumbnail: String?

    private var notes: Binding<String> {
        Binding(get: { exercise.notes ?? "" }, set: { exercise.notes = $0.isEmpty ? nil : $0 })
    }

    var body: some View {
        Form {
            Section { hero }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            if exercise.isCardio {
                CardioTargetFields(target: Binding(get: { exercise.cardio ?? CardioTarget() }, set: { exercise.cardio = $0 }), hrZones: hrZones)
            } else {
                StrengthTargetFields(exercise: $exercise, suggestion: suggestion)
            }
            Section("Notas") {
                TextField("Indicaciones para ti (opcional)", text: notes, axis: .vertical)
                    .lineLimit(2...6)
            }
        }
        .navigationTitle(exercise.isCardio ? "Cardio" : "Objetivo")
        .navigationBarTitleDisplayMode(.inline)
        // Steppers and zones tick; typing notes doesn't.
        .sensoryFeedback(.selection, trigger: [Double(exercise.sets), Double(exercise.repMin), Double(exercise.repMax), Double(exercise.restSeconds), exercise.weightKg ?? -1])
        .sensoryFeedback(.selection, trigger: exercise.cardio?.zone)
    }

    /// The exercise and its prescription as the screen's one big number.
    private var hero: some View {
        HStack(spacing: 14) {
            ExerciseMediaView(path: thumbnail, cornerRadius: 14)
                .frame(width: 72, height: 72)
            VStack(alignment: .leading, spacing: 4) {
                Text(exercise.exerciseName)
                    .font(.headline)
                    .lineLimit(2)
                Text(exercise.prescription)
                    .font(.system(.title, design: .rounded, weight: .bold))
                    .foregroundStyle(Theme.training)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .contentTransition(.numericText())
                    .animation(.snappy, value: exercise.prescription)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
    }
}

// MARK: - Strength

private struct StrengthTargetFields: View {
    @Binding var exercise: ProgramExercise
    let suggestion: LoadSuggestion?

    private enum Effort: String, CaseIterable { case none, rir, rpe }

    private var effort: Binding<Effort> {
        Binding(
            get: { exercise.targetRir != nil ? .rir : exercise.targetRpe != nil ? .rpe : .none },
            set: { mode in
                exercise.targetRir = mode == .rir ? (exercise.targetRir ?? 2) : nil
                exercise.targetRpe = mode == .rpe ? (exercise.targetRpe ?? 8) : nil
            }
        )
    }

    private var unit: WeightUnit { TrainingStore.shared.unit(for: exercise.exerciseId) }

    private var suggested: Binding<Bool> {
        Binding(
            get: { exercise.weightKg == nil },
            set: { on in exercise.weightKg = on ? nil : (suggestion?.weightKg ?? unit.fromUnit(unit == .lb ? 45 : 20)) }
        )
    }

    /// The hand-set load as typed in the unit, to the quarter, kept as its exact kg.
    private func typed(_ kg: Double) -> Binding<Double> {
        Binding(get: { unit.shown(kg) }, set: { exercise.weightKg = unit.fromUnit(max(0, ($0 * 4).rounded() / 4)) })
    }

    private static let restPresets = [60, 90, 120, 180]

    var body: some View {
        Section("Series y repeticiones") {
            Stepper(value: $exercise.sets, in: 1...10) {
                ValueRow(title: "Series", value: "\(exercise.sets)")
            }
            Stepper(value: Binding(get: { exercise.repMin }, set: { exercise.repMin = $0; exercise.repMax = max(exercise.repMax, $0) }), in: 1...50) {
                ValueRow(title: "Reps mínimas", value: "\(exercise.repMin)")
            }
            Stepper(value: $exercise.repMax, in: exercise.repMin...60) {
                ValueRow(title: "Reps máximas", value: "\(exercise.repMax)")
            }
        }

        Section {
            LabeledContent("Unidad de esta máquina") { UnitPicker(exerciseId: exercise.exerciseId) }
            Toggle("Sugerido por Pulso", isOn: suggested).tint(Theme.training)
            if let kg = exercise.weightKg {
                HStack {
                    TextField("Peso", value: typed(kg), format: .number.precision(.fractionLength(0...2)))
                        .keyboardType(.decimalPad)
                        .font(.title3.weight(.semibold))
                        .fontDesign(.rounded)
                    Text(unit.rawValue).foregroundStyle(.secondary)
                    Stepper("Peso") {
                        exercise.weightKg = unit.fromUnit(unit.stepUp(unit.snap(kg)))
                    } onDecrement: {
                        exercise.weightKg = unit.fromUnit(unit.stepDown(unit.snap(kg)))
                    }
                    .labelsHidden()
                }
            }
        } header: {
            Text("Peso")
        } footer: {
            if exercise.weightKg != nil {
                Text("Se usa la próxima vez; después vuelve la progresión automática.")
            } else if let suggestion, let kg = suggestion.weightKg, kg > 0 {
                Text("Pulso propone \(unit.format(kg)). \(suggestion.reason)")
            } else {
                Text("Pulso calcula la carga con tu progresión.")
            }
        }

        Section("Descanso") {
            Stepper(value: $exercise.restSeconds, in: 0...600, step: 15) {
                ValueRow(title: "Entre series", value: TrainingFormat.rest(exercise.restSeconds))
            }
            HStack(spacing: 8) {
                ForEach(Self.restPresets, id: \.self) { seconds in
                    Button(TrainingFormat.rest(seconds)) { exercise.restSeconds = seconds }
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.capsule)
                        .tint(exercise.restSeconds == seconds ? Theme.training : .secondary)
                        .font(.subheadline.weight(.medium))
                        .fontDesign(.rounded)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
            .buttonStyle(.borderless)
        }

        Section {
            Picker("Medir esfuerzo", selection: effort) {
                Text("Libre").tag(Effort.none)
                Text("En reserva").tag(Effort.rir)
                Text("Del 1 al 10").tag(Effort.rpe)
            }
            .pickerStyle(.segmented)
            if let rir = exercise.targetRir {
                Stepper(value: Binding(get: { rir }, set: { exercise.targetRir = $0 }), in: 0...5) {
                    ValueRow(title: "Repeticiones en reserva", value: "\(rir)")
                }
            }
            if let rpe = exercise.targetRpe {
                Stepper(value: Binding(get: { rpe }, set: { exercise.targetRpe = $0 }), in: 5...10, step: 0.5) {
                    ValueRow(title: "Esfuerzo", value: TrainingFormat.number(rpe))
                }
            }
        } header: {
            Text("Esfuerzo")
        } footer: {
            switch effort.wrappedValue {
            case .rir: Text("Las que podrías hacer de más al acabar cada serie.")
            case .rpe: Text("Cuánto cuesta cada serie, de 1 a 10; 10 es no poder hacer ni una más.")
            case .none: EmptyView()
            }
        }
    }
}

// MARK: - Cardio

private struct CardioTargetFields: View {
    @Binding var target: CardioTarget
    let hrZones: [HrZoneRange]?

    private enum Rhythm: String { case none, speed, pace }

    private var rhythm: Binding<Rhythm> {
        Binding(
            get: { target.speedKmh != nil ? .speed : target.paceMinPerKm != nil ? .pace : .none },
            set: { mode in
                target.speedKmh = mode == .speed ? (target.speedKmh ?? 8) : nil
                target.paceMinPerKm = mode == .pace ? (target.paceMinPerKm ?? 6) : nil
            }
        )
    }

    private var intervalsOn: Binding<Bool> {
        Binding(
            get: { target.intervals != nil },
            set: { on in target.intervals = on ? CardioIntervals(rounds: 8, workSeconds: 30, restSeconds: 90, workLabel: "Rápido", restLabel: "Suave") : nil }
        )
    }

    var body: some View {
        Section {
            OptionalNumberRow(title: "Duración", value: $target.durationMinutes, unit: "min", step: 5, range: 1...240, initial: 20)
            OptionalNumberRow(title: "Distancia", value: $target.distanceKm, unit: "km", step: 0.5, range: 0.5...100, initial: 5)
        } header: {
            Text("Objetivo")
        } footer: {
            if target.intervals != nil { Text("Con intervalos, la duración es su total más el calentamiento.") }
        }

        Section {
            ZoneRow(zone: nil, range: nil, selected: target.zone == nil) { target.zone = nil }
            ForEach(1...5, id: \.self) { zone in
                ZoneRow(zone: zone, range: hrZones?.first { $0.zone == zone }, selected: target.zone == zone) { target.zone = zone }
            }
        } header: {
            Text("Zona cardiaca")
        } footer: {
            if hrZones == nil { Text("Añade tu edad o tu FC máxima en el perfil para ver las pulsaciones de cada zona.") }
        }

        Section("Ritmo") {
            Picker("Ritmo", selection: rhythm) {
                Text("Libre").tag(Rhythm.none)
                Text("Velocidad").tag(Rhythm.speed)
                Text("Ritmo").tag(Rhythm.pace)
            }
            .pickerStyle(.segmented)
            if target.speedKmh != nil {
                OptionalNumberRow(title: "Velocidad", value: $target.speedKmh, unit: "km/h", step: 0.5, range: 1...30, initial: 8)
            }
            if target.paceMinPerKm != nil {
                OptionalNumberRow(title: "Ritmo", value: $target.paceMinPerKm, unit: "min/km", step: 0.25, range: 2...15, initial: 6, format: TrainingFormat.pace)
            }
        }

        Section("Máquina") {
            OptionalNumberRow(title: "Inclinación", value: $target.inclinePercent, unit: "%", step: 0.5, range: 0...20, initial: 2)
            OptionalNumberRow(title: "Nivel", value: $target.level, unit: "", step: 1, range: 1...30, initial: 5)
        }

        Section {
            Toggle("Intervalos", isOn: intervalsOn).tint(Theme.training)
            if let intervals = target.intervals {
                IntervalFields(intervals: Binding(get: { intervals }, set: { target.intervals = $0 }))
            }
        } footer: {
            if let intervals = target.intervals {
                let total = intervals.rounds * (intervals.workSeconds + intervals.restSeconds)
                Text("\(intervals.summary) · \(TrainingFormat.rest(total)) en total")
            }
        }
    }
}

private struct IntervalFields: View {
    @Binding var intervals: CardioIntervals

    private func label(_ keyPath: WritableKeyPath<CardioIntervals, String?>) -> Binding<String> {
        Binding(get: { intervals[keyPath: keyPath] ?? "" }, set: { intervals[keyPath: keyPath] = $0.isEmpty ? nil : $0 })
    }

    var body: some View {
        Stepper(value: $intervals.rounds, in: 1...50) {
            ValueRow(title: "Rondas", value: "\(intervals.rounds)")
        }
        Stepper(value: $intervals.workSeconds, in: 5...900, step: 5) {
            ValueRow(title: "Trabajo", value: TrainingFormat.rest(intervals.workSeconds))
        }
        TextField("Nombre del trabajo (Rápido, Sprint…)", text: label(\.workLabel))
        Stepper(value: $intervals.restSeconds, in: 0...900, step: 5) {
            ValueRow(title: "Recuperación", value: TrainingFormat.rest(intervals.restSeconds))
        }
        TextField("Nombre de la recuperación (Suave…)", text: label(\.restLabel))
    }
}

/// A heart-rate zone to pick, with its purpose and the person's bpm band when known.
private struct ZoneRow: View {
    let zone: Int?
    let range: HrZoneRange?
    let selected: Bool
    let select: () -> Void

    static func color(_ zone: Int?) -> Color {
        switch zone {
        case 1: Theme.water
        case 2: Theme.body
        case 3: Theme.carbs
        case 4: Theme.energy
        case 5: Theme.protein
        default: .secondary
        }
    }

    static func name(_ zone: Int?) -> String {
        switch zone {
        case 1: "Recuperación"
        case 2: "Base aeróbica"
        case 3: "Tempo"
        case 4: "Umbral"
        case 5: "Máximo"
        default: "Sin zona"
        }
    }

    var body: some View {
        Button(action: select) {
            HStack(spacing: 12) {
                Text(zone.map { "Z\($0)" } ?? "—")
                    .font(.subheadline.weight(.bold))
                    .fontDesign(.rounded)
                    .foregroundStyle(zone == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(.white))
                    .frame(width: 36, height: 28)
                    .background(zone == nil ? AnyShapeStyle(.fill.tertiary) : AnyShapeStyle(Self.color(zone).gradient), in: .capsule)
                Text(Self.name(zone)).foregroundStyle(.primary)
                Spacer(minLength: 4)
                if let range {
                    Text("\(range.minBpm)–\(range.maxBpm) lpm")
                        .font(.subheadline)
                        .fontDesign(.rounded)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Image(systemName: "checkmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Theme.training)
                    .opacity(selected ? 1 : 0)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// MARK: - Rows

/// "Series ··· 4" inside a stepper's label.
private struct ValueRow: View {
    let title: String
    let value: String

    var body: some View {
        HStack {
            Text(title)
            Spacer(minLength: 8)
            Text(value)
                .fontWeight(.semibold)
                .fontDesign(.rounded)
                .monospacedDigit()
                .contentTransition(.numericText())
                .animation(.snappy, value: value)
        }
    }
}

/// A number that may be unset: "Añadir" until it is, then a stepper with a clear button.
private struct OptionalNumberRow: View {
    let title: String
    @Binding var value: Double?
    let unit: String
    let step: Double
    let range: ClosedRange<Double>
    let initial: Double
    var format: (Double) -> String = TrainingFormat.number

    var body: some View {
        if let current = value {
            Stepper(value: Binding(get: { current }, set: { value = $0 }), in: range, step: step) {
                HStack(spacing: 8) {
                    Button("Quitar \(title.lowercased())", systemImage: "xmark.circle.fill") { value = nil }
                        .labelStyle(.iconOnly)
                        .foregroundStyle(.tertiary)
                        .buttonStyle(.borderless)
                    ValueRow(title: title, value: [format(current), unit].filter { !$0.isEmpty }.joined(separator: " "))
                }
            }
        } else {
            Button { value = initial } label: {
                HStack {
                    Text(title).foregroundStyle(.primary)
                    Spacer()
                    Label("Añadir", systemImage: "plus.circle.fill")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Theme.training)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
        }
    }
}

#if DEBUG
private struct TargetPreview: View {
    @State var exercise: ProgramExercise

    var body: some View {
        NavigationStack {
            ExerciseTargetEditor(
                exercise: $exercise,
                suggestion: LoadSuggestion(exerciseId: exercise.exerciseId, weightKg: 52.5, reps: 8, reason: "Hiciste 8 reps en todas las series.", lastSessionAt: nil),
                hrZones: HrZoneRange.previews
            )
        }
    }
}

#Preview("Objetivo fuerza · 375 pt", traits: .fixedLayout(width: 375, height: 1100)) {
    TargetPreview(exercise: ProgramDay.editorPreview.exercises[0])
}

#Preview("Objetivo cardio · 440 pt, claro", traits: .fixedLayout(width: 440, height: 1300)) {
    TargetPreview(exercise: ProgramDay.editorPreview.exercises[3]).preferredColorScheme(.light)
}

#Preview("Objetivo · XXL", traits: .fixedLayout(width: 375, height: 1300)) {
    TargetPreview(exercise: ProgramDay.editorPreview.exercises[2]).dynamicTypeSize(.xxLarge)
}
#endif
