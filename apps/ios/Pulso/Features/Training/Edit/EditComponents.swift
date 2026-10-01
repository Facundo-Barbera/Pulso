import SwiftUI

// Pieces shared by the day editor, the exercise sheets and the preferences.

/// Contract `MuscleGroup` ids ↔ Spanish labels. Order = the picker's chips.
enum MuscleGroup {
    static let all = ["chest", "back", "shoulders", "biceps", "triceps", "forearms", "quads", "hamstrings", "glutes", "calves", "core", "full_body", "cardio"]

    static func label(_ id: String) -> String {
        switch id {
        case "chest": "Pecho"
        case "back": "Espalda"
        case "shoulders": "Hombros"
        case "biceps": "Bíceps"
        case "triceps": "Tríceps"
        case "forearms": "Antebrazos"
        case "quads": "Cuádriceps"
        case "hamstrings": "Isquios"
        case "glutes": "Glúteos"
        case "calves": "Gemelos"
        case "core": "Core"
        case "full_body": "Cuerpo completo"
        case "cardio": "Cardio"
        default: id.capitalized
        }
    }
}

/// What a sheet shows while it fetches.
enum LoadPhase<Value> {
    case loading
    case loaded(Value)
    case failed(String)
}

/// The library, fetched once per launch so the picker opens instantly the second time.
@MainActor
enum ExerciseLibrary {
    private(set) static var cached: [LibraryExercise]?

    static func load(_ api: PulsoAPI) async throws -> [LibraryExercise] {
        if let cached { return cached }
        let fresh = try await api.libraryExercises()
        cached = fresh
        return fresh
    }
}

/// Where the person's preferred equipment ranks; anything else ties after it.
@MainActor
func equipmentRank(_ id: String) -> Int {
    let preferred = TrainingStore.shared.settings.preferredEquipment
    return preferred.firstIndex(of: id) ?? preferred.count
}

/// The still the catalog already has for `exerciseId`, for rows the engine sent without one.
@MainActor
func cachedThumbnail(_ exerciseId: String) -> String? {
    ExerciseCatalog.shared.details[exerciseId]?.media.thumbnail
}

/// A filter capsule on glass, filled with the tint when selected.
struct FilterChip: View {
    let title: String
    var systemImage: String?
    let selected: Bool
    var tint: Color = Theme.training
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let systemImage { Image(systemName: systemImage) }
                Text(title)
            }
            .font(.subheadline.weight(.medium))
            .lineLimit(1)
            .foregroundStyle(selected ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .glassEffect(selected ? .regular.tint(tint).interactive() : .regular.interactive(), in: .capsule)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// A sideways-scrolling row of chips that bleeds to the screen edges.
struct ChipRow<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView(.horizontal) {
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) { content }
                    .padding(.vertical, 2)
            }
        }
        .scrollIndicators(.hidden)
        .contentMargins(.horizontal, Theme.padding, for: .scrollContent)
    }
}

/// A soft tinted capsule for short facts ("Mismo músculo"); no glass, so lists stay calm.
struct ReasonTag: View {
    let text: String
    var tint: Color = Theme.training

    var body: some View {
        Text(text)
            .font(.caption.weight(.medium))
            .lineLimit(1)
            .foregroundStyle(tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(tint.opacity(0.13), in: .capsule)
    }
}

/// A library exercise as a row: still, name, equipment and whatever `detail` adds.
struct LibraryRow<Detail: View>: View {
    let name: String
    let equipment: String
    var thumbnail: String?
    var caption: String?
    @ViewBuilder var detail: Detail

    var body: some View {
        HStack(spacing: 12) {
            ExerciseMediaView(path: thumbnail, cornerRadius: 12)
                .frame(width: 52, height: 52)
            VStack(alignment: .leading, spacing: 4) {
                Text(name)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                HStack(spacing: 5) {
                    Image(systemName: Equipment.symbol(equipment))
                    Text([Equipment.label(equipment), caption].compactMap(\.self).joined(separator: " · "))
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                detail
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .contentShape(.rect)
    }
}

extension LibraryRow where Detail == EmptyView {
    init(name: String, equipment: String, thumbnail: String? = nil, caption: String? = nil) {
        self.init(name: name, equipment: equipment, thumbnail: thumbnail, caption: caption) { EmptyView() }
    }
}

// MARK: - Editing helpers

extension ProgramExercise {
    /// Exercises added in the editor carry this id prefix until the engine names them.
    static let draftPrefix = "draft-"

    var isDraft: Bool { id.hasPrefix(Self.draftPrefix) }

    /// What the edit sends: drafts go without an id so the engine creates them.
    var editInput: DayExerciseInput {
        var input = input
        if isDraft { input.id = nil }
        return input
    }

    /// A fresh prescription for a library pick: 3 × 8–12 for strength, 20 min in Z2 for cardio.
    static func draft(_ library: LibraryExercise) -> ProgramExercise {
        var exercise = ProgramExercise(
            id: draftPrefix + UUID().uuidString, exerciseId: library.id, exerciseName: library.name, equipment: library.equipment,
            sets: 3, repMin: 8, repMax: 12, targetRpe: nil, targetRir: 2,
            restSeconds: library.kind == "compound" ? 120 : 90, notes: nil,
            kind: library.kind, modality: library.modality
        )
        if library.isCardio {
            exercise.sets = 1
            exercise.repMin = 1
            exercise.repMax = 1
            exercise.targetRir = nil
            exercise.restSeconds = 0
            exercise.cardio = CardioTarget(durationMinutes: 20, zone: 2)
        }
        return exercise
    }

    /// Another exercise in this slot. Strength keeps the sets, reps, rest and effort;
    /// the hand-set load and notes belonged to the old one. A new id, so the engine
    /// suggests the new exercise's load from its own history.
    func swapped(to library: LibraryExercise) -> ProgramExercise {
        guard !isCardio, !library.isCardio else { return .draft(library) }
        var exercise = self
        exercise.id = Self.draftPrefix + UUID().uuidString
        exercise.exerciseId = library.id
        exercise.exerciseName = library.name
        exercise.equipment = library.equipment
        exercise.kind = library.kind
        exercise.modality = library.modality
        exercise.weightKg = nil
        exercise.notes = nil
        return exercise
    }
}

enum TrainingFormat {
    /// 90 → "1:30", 45 → "45 s".
    static func rest(_ seconds: Int) -> String {
        seconds < 60 ? "\(seconds) s" : String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    /// 5.5 → "5:30".
    static func pace(_ minutesPerKm: Double) -> String {
        var minutes = Int(minutesPerKm)
        var seconds = Int(((minutesPerKm - Double(minutes)) * 60).rounded())
        if seconds == 60 { minutes += 1; seconds = 0 }
        return String(format: "%d:%02d", minutes, seconds)
    }

    static func number(_ value: Double) -> String { value.formatted(.number.precision(.fractionLength(0...2))) }

    /// "4 series de 6 a 8 repeticiones · unos 32,5 kg · 2:00", or the cardio target.
    static func summary(_ exercise: ProgramExercise, suggestion: LoadSuggestion?) -> String {
        if exercise.isCardio { return exercise.prescription }
        var parts = [exercise.prescription]
        if let kg = exercise.weightKg {
            parts.append("\(number(kg)) kg")
        } else if let kg = suggestion?.weightKg, kg > 0 {
            parts.append("unos \(number(kg)) kg")
        }
        parts.append(rest(exercise.restSeconds))
        return parts.joined(separator: " · ")
    }
}

// MARK: - Fixtures

#if DEBUG
extension LibraryExercise {
    static let previews: [LibraryExercise] = [
        LibraryExercise(id: "press-pecho-maquina", name: "Press de pecho en máquina", muscle: "chest", secondary: ["triceps"], equipment: "machine", kind: "compound"),
        LibraryExercise(id: "aperturas-polea", name: "Aperturas en polea cruzada", muscle: "chest", secondary: [], equipment: "cable", kind: "isolation"),
        LibraryExercise(id: "press-banca", name: "Press de banca", muscle: "chest", secondary: ["triceps", "shoulders"], equipment: "barbell", kind: "compound"),
        LibraryExercise(id: "press-mancuernas", name: "Press inclinado con mancuernas en banco a 30 grados", muscle: "chest", secondary: ["shoulders"], equipment: "dumbbell", kind: "compound"),
        LibraryExercise(id: "jalon-pecho", name: "Jalón al pecho", muscle: "back", secondary: ["biceps"], equipment: "machine", kind: "compound"),
        LibraryExercise(id: "remo-polea", name: "Remo sentado en polea", muscle: "back", secondary: ["biceps"], equipment: "cable", kind: "compound"),
        LibraryExercise(id: "prensa", name: "Prensa de piernas", muscle: "quads", secondary: ["glutes"], equipment: "machine", kind: "compound"),
        LibraryExercise(id: "flexiones", name: "Flexiones", muscle: "chest", secondary: ["triceps"], equipment: "bodyweight", kind: "compound"),
        LibraryExercise(id: "cinta", name: "Cinta de correr", muscle: "cardio", secondary: [], equipment: "machine", kind: "cardio", modality: "treadmill"),
        LibraryExercise(id: "eliptica", name: "Elíptica", muscle: "cardio", secondary: [], equipment: "machine", kind: "cardio", modality: "elliptical"),
    ]
}

extension SimilarExercise {
    static let previews: [SimilarExercise] = [
        SimilarExercise(id: "press-pecho-maquina", name: "Press de pecho en máquina", muscle: "chest", secondary: ["triceps"], equipment: "machine", kind: "compound", score: 94, reasons: ["Mismo músculo", "Mismo patrón", "Máquina"], preferred: true),
        SimilarExercise(id: "press-inclinado-maquina", name: "Press inclinado convergente en máquina Hammer Strength", muscle: "chest", secondary: ["shoulders"], equipment: "machine", kind: "compound", score: 88, reasons: ["Mismo músculo", "Empuje horizontal"], preferred: true),
        SimilarExercise(id: "aperturas-polea", name: "Aperturas en polea cruzada", muscle: "chest", secondary: [], equipment: "cable", kind: "isolation", score: 76, reasons: ["Mismo músculo"], preferred: true),
        SimilarExercise(id: "press-mancuernas", name: "Press con mancuernas", muscle: "chest", secondary: ["triceps"], equipment: "dumbbell", kind: "compound", score: 71, reasons: ["Mismo músculo", "Mismo patrón"], preferred: false),
        SimilarExercise(id: "flexiones", name: "Flexiones", muscle: "chest", secondary: ["triceps"], equipment: "bodyweight", kind: "compound", score: 52, reasons: ["Mismo patrón"], preferred: false),
    ]
}

extension ProgramDay {
    static let editorPreview = ProgramDay(id: "d1", name: "Torso A", focus: "Empuje horizontal", weekday: 1, exercises: [
        ProgramExercise(id: "pe1", exerciseId: "press-pecho-maquina", exerciseName: "Press de pecho en máquina", equipment: "machine", sets: 4, repMin: 6, repMax: 8, targetRpe: nil, targetRir: 2, restSeconds: 120, notes: nil, kind: "compound", weightKg: 50),
        ProgramExercise(id: "pe2", exerciseId: "jalon-pecho", exerciseName: "Jalón al pecho con agarre neutro", equipment: "machine", sets: 3, repMin: 8, repMax: 10, targetRpe: nil, targetRir: 2, restSeconds: 90, notes: nil, kind: "compound"),
        ProgramExercise(id: "pe3", exerciseId: "aperturas-polea", exerciseName: "Aperturas en polea cruzada", equipment: "cable", sets: 3, repMin: 12, repMax: 15, targetRpe: 8, targetRir: nil, restSeconds: 60, notes: "Pausa de un segundo arriba", kind: "isolation"),
        ProgramExercise(id: "pe4", exerciseId: "cinta", exerciseName: "Cinta de correr", equipment: "machine", sets: 1, repMin: 1, repMax: 1, targetRpe: nil, targetRir: nil, restSeconds: 0, notes: nil, kind: "cardio", modality: "treadmill", cardio: CardioTarget(durationMinutes: 20, inclinePercent: 6, zone: 2)),
    ], overridden: true)
}

extension HrZoneRange {
    static let previews = [
        HrZoneRange(zone: 1, minBpm: 98, maxBpm: 117),
        HrZoneRange(zone: 2, minBpm: 117, maxBpm: 137),
        HrZoneRange(zone: 3, minBpm: 137, maxBpm: 156),
        HrZoneRange(zone: 4, minBpm: 156, maxBpm: 176),
        HrZoneRange(zone: 5, minBpm: 176, maxBpm: 195),
    ]
}
#endif
