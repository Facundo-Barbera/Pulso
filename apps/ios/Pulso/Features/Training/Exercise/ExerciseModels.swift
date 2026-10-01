import Foundation

// Mirrors of `@pulso/contract` exercise detail types. Weights kg, times epoch ms.

/// Fine-grained muscles for the body map.
enum Muscle: String, Codable, CaseIterable, Hashable {
    case chest
    case frontDelts = "front_delts"
    case sideDelts = "side_delts"
    case rearDelts = "rear_delts"
    case traps
    case upperBack = "upper_back"
    case lats
    case lowerBack = "lower_back"
    case biceps
    case triceps
    case forearms
    case abs
    case obliques
    case glutes
    case quads
    case hamstrings
    case adductors
    case abductors
    case calves
    case neck

    var label: String {
        switch self {
        case .chest: "Pecho"
        case .frontDelts: "Deltoides anterior"
        case .sideDelts: "Deltoides lateral"
        case .rearDelts: "Deltoides posterior"
        case .traps: "Trapecio"
        case .upperBack: "Espalda alta"
        case .lats: "Dorsales"
        case .lowerBack: "Lumbares"
        case .biceps: "Bíceps"
        case .triceps: "Tríceps"
        case .forearms: "Antebrazos"
        case .abs: "Abdominales"
        case .obliques: "Oblicuos"
        case .glutes: "Glúteos"
        case .quads: "Cuádriceps"
        case .hamstrings: "Isquiotibiales"
        case .adductors: "Aductores"
        case .abductors: "Abductores"
        case .calves: "Gemelos"
        case .neck: "Cuello"
        }
    }
}

struct ExerciseMedia: Codable, Hashable {
    /// Engine-relative, bearer-protected: resolve with `PulsoAPI.mediaURL(_:)`.
    var animation: String?
    var thumbnail: String?
    var source: String?
    var attribution: String?
}

struct ExerciseVideo: Codable, Hashable, Identifiable {
    var youtubeId: String
    var title: String
    var channel: String
    /// "es" or "en".
    var lang: String

    var id: String { youtubeId }
}

/// `GET /api/mobile/training/exercises/:id`: `Exercise` plus everything the exercise screen shows.
struct ExerciseDetail: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var muscle: String
    var secondary: [String]
    var equipment: String
    var kind: String
    var nameEn: String?
    var primaryMuscles: [Muscle]
    var secondaryMuscles: [Muscle]
    var instructions: [String]
    var tips: [String]
    var media: ExerciseMedia
    var videos: [ExerciseVideo]
    var notes: String?
}

struct ExercisePerformance: Codable, Hashable {
    struct MaxWeight: Codable, Hashable { var kg: Double; var reps: Int; var at: Double }
    struct Best: Codable, Hashable { var kg: Double; var at: Double }
    struct Point: Codable, Hashable, Identifiable {
        var at: Double
        var topWeightKg: Double
        var e1rm: Double
        var volumeKg: Double

        var id: Double { at }
        var day: Date { Date(timeIntervalSince1970: at / 1000) }
    }

    var exerciseId: String
    var maxWeight: MaxWeight?
    var bestE1rm: Best?
    var maxVolume: Best?
    /// Oldest first, one point per session.
    var history: [Point]
}

extension PulsoAPI {
    private struct Ignored: Decodable {}

    func exerciseDetail(_ id: String) async throws -> ExerciseDetail {
        try await call("api/mobile/training/exercises/\(id)", method: "GET")
    }

    func exercisePerformance(_ id: String) async throws -> ExercisePerformance {
        try await call("api/mobile/training/exercises/\(id)/performance", method: "GET")
    }

    func saveExerciseNotes(_ id: String, notes: String?) async throws {
        let _: Ignored = try await call("api/mobile/training/exercises/\(id)/notes", method: "PUT", body: ["notes": notes])
    }

    /// Media paths come engine-relative (`/api/mobile/training/media/…`); keeps any query.
    func mediaURL(_ path: String) -> URL? {
        if let absolute = URL(string: path), absolute.scheme != nil { return absolute }
        let root = base.absoluteString.hasSuffix("/") ? base : URL(string: base.absoluteString + "/")
        return URL(string: String(path.drop { $0 == "/" }), relativeTo: root)?.absoluteURL
    }

    /// A GET for a media path, carrying the bearer.
    func mediaRequest(_ path: String) -> URLRequest? {
        guard let url = mediaURL(path) else { return nil }
        var request = URLRequest(url: url)
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
        return request
    }
}

// MARK: - Fixtures

extension ExerciseDetail {
    static let preview = ExerciseDetail(
        id: "press-banca",
        name: "Press de banca",
        muscle: "chest",
        secondary: ["shoulders", "triceps"],
        equipment: "barbell",
        kind: "compound",
        nameEn: "Barbell Bench Press",
        primaryMuscles: [.chest],
        secondaryMuscles: [.frontDelts, .triceps],
        instructions: [
            "Túmbate en el banco con los ojos bajo la barra y los pies firmes en el suelo.",
            "Agarra la barra algo más abierto que los hombros y sácala del soporte con los brazos extendidos.",
            "Baja la barra controlada hasta rozar la parte baja del pecho.",
            "Empuja hacia arriba y ligeramente hacia atrás hasta extender los codos.",
        ],
        tips: ["Junta las escápulas", "Codos a 45°", "Pies apoyados", "No rebotes en el pecho"],
        media: ExerciseMedia(animation: nil, thumbnail: nil, source: "exercisedb", attribution: "Animación: ExerciseDB"),
        videos: [ExerciseVideo(youtubeId: "rT7DgCr-3pg", title: "Cómo hacer press de banca", channel: "Jeff Nippard", lang: "en")],
        notes: "Agarre en la marca del anillo."
    )
}

extension ExercisePerformance {
    static let preview: ExercisePerformance = {
        let day = 86_400_000.0
        let start = Date.now.timeIntervalSince1970 * 1000 - 70 * day
        let tops: [Double] = [70, 72.5, 72.5, 75, 75, 77.5, 77.5, 80, 80, 82.5]
        let history = tops.enumerated().map { i, kg in
            let reps = 8 - i % 3
            return Point(at: start + Double(i) * 7 * day, topWeightKg: kg, e1rm: (kg * (1 + Double(reps) / 30)).rounded(), volumeKg: kg * Double(reps) * 3)
        }
        return ExercisePerformance(
            exerciseId: "press-banca",
            maxWeight: MaxWeight(kg: 82.5, reps: 7, at: history.last!.at),
            bestE1rm: Best(kg: history.map(\.e1rm).max()!, at: history.last!.at),
            maxVolume: Best(kg: history.map(\.volumeKg).max()!, at: history[history.count - 2].at),
            history: history
        )
    }()
}
