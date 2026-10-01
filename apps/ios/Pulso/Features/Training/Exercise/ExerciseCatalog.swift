import Foundation
import Observation

/// Exercise details by id, kept on disk so the guide, thumbnails and muscle
/// chips still show in a gym without signal. Shown from disk first, refreshed
/// from the Mac when it answers.
@MainActor
@Observable
final class ExerciseCatalog {
    static let shared = ExerciseCatalog()

    private(set) var details: [String: ExerciseDetail] = [:]
    private var inFlight: Set<String> = []

    private static let directory = URL.cachesDirectory.appending(path: "Exercises", directoryHint: .isDirectory)

    private static func file(_ id: String) -> URL {
        directory.appending(path: "\(id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? id).json")
    }

    func detail(_ id: String) -> ExerciseDetail? {
        if let detail = details[id] { return detail }
        guard let data = try? Data(contentsOf: Self.file(id)), let detail = try? JSONDecoder().decode(ExerciseDetail.self, from: data) else { return nil }
        details[id] = detail
        return detail
    }

    /// Fetches `id` from the Mac. Errors go to the model only when `report` is set,
    /// so background prefetches don't raise banners.
    @discardableResult
    func refresh(_ id: String, report: Bool = true) async -> ExerciseDetail? {
        guard let api = PulsoModel.shared.api, !inFlight.contains(id) else { return detail(id) }
        inFlight.insert(id)
        defer { inFlight.remove(id) }
        do {
            let fresh = try await api.exerciseDetail(id)
            store(fresh)
            return fresh
        } catch {
            if report { PulsoModel.shared.handle(error) }
            return detail(id)
        }
    }

    /// Details for every id not cached yet and their thumbnails, plus the
    /// demonstrations for `animations`, so a session's exercises work offline.
    func prefetch(_ ids: [String], animations: [String] = []) async {
        let unique = Array(NSOrderedSet(array: ids)) as? [String] ?? ids
        for id in unique where detail(id) == nil {
            await refresh(id, report: false)
        }
        guard let api = PulsoModel.shared.api else { return }
        let paths = unique.compactMap { detail($0)?.media.thumbnail } + animations.compactMap { detail($0)?.media.animation }
        for path in paths {
            _ = try? await ExerciseMediaCache.shared.data(for: path, api: api)
        }
    }

    func setNotes(_ notes: String?, for id: String) {
        guard var detail = detail(id) else { return }
        detail.notes = notes
        store(detail)
    }

    private func store(_ detail: ExerciseDetail) {
        details[detail.id] = detail
        try? FileManager.default.createDirectory(at: Self.directory, withIntermediateDirectories: true)
        try? JSONEncoder().encode(detail).write(to: Self.file(detail.id), options: .atomic)
    }
}
