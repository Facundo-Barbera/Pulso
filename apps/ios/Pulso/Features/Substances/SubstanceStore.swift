import Foundation
import Observation

/// Sustancias' state. Owned by the screen, not shared: nothing of it stays in
/// memory once the screen closes, and no other part of the app can read it.
@MainActor
@Observable
final class SubstanceStore {
    /// Nil until the first overview tells which substance the engine starts on.
    var scope: SubstanceScope?
    /// Every substance: active by position, then archived.
    private(set) var substances: [Substance] = []
    private(set) var overviews: [SubstanceScope: SubstanceOverview] = [:]
    private(set) var loading = false
    /// Bumped on every saved or deleted entry; the screen hangs haptics off it.
    private(set) var changes = 0

    private var model: PulsoModel { .shared }

    var current: SubstanceOverview? { scope.flatMap { overviews[$0] } }
    var active: [Substance] { substances.filter { !$0.archived } }
    var archived: [Substance] { substances.filter(\.archived) }

    func substance(_ id: String?) -> Substance? {
        guard let id else { return nil }
        return substances.first { $0.id == id }
    }

    /// Unstructured callers only: a cancelled request would read as the Mac being offline.
    func load() async {
        guard let api = model.api else { return }
        let requested = scope
        loading = true
        defer { loading = false }
        do {
            let overview = try await api.substanceOverview(requested)
            let resolved = requested ?? overview.scope
            overviews[resolved] = overview
            substances = overview.substances
            if scope == nil { scope = resolved }
        } catch {
            model.handle(error)
        }
    }

    func save(_ draft: SubstanceDraft, id: String?) async -> Bool {
        guard let api = model.api else { return false }
        do {
            if let id { _ = try await api.updateSubstanceEntry(id: id, draft) } else { _ = try await api.addSubstanceEntry(draft) }
            changes += 1
            // Logged for another substance than the one on screen: follow it there.
            if let shown = scope?.substanceId, shown != draft.substanceId, active.contains(where: { $0.id == draft.substanceId }) {
                overviews = [:]
                scope = .one(draft.substanceId) // the screen loads on the switch
            } else {
                await refresh()
            }
            return true
        } catch {
            model.handle(error)
            return false
        }
    }

    func delete(_ entry: SubstanceEntry) async {
        guard let api = model.api else { return }
        if let scope { overviews[scope]?.entries.removeAll { $0.id == entry.id } }
        do {
            try await api.deleteSubstanceEntry(id: entry.id)
            changes += 1
        } catch {
            model.handle(error)
        }
        await refresh()
    }

    // MARK: Substances

    /// The person's own weekly maximum for one substance; nil removes it.
    func setGoal(_ maxDaysPerWeek: Int?, for id: String) async {
        await update(id, SubstancePatch(maxDaysPerWeek: .some(maxDaysPerWeek)))
    }

    /// Returns the new substance, or nil when the Mac said no.
    func create(_ definition: SubstanceDefinition) async -> Substance? {
        guard let api = model.api else { return nil }
        do {
            let created = try await api.createSubstance(definition.patch)
            apply(created)
            await refresh()
            return created
        } catch {
            model.handle(error)
            return nil
        }
    }

    @discardableResult
    func update(_ id: String, _ patch: SubstancePatch) async -> Bool {
        guard let api = model.api else { return false }
        do {
            let updated = try await api.updateSubstance(id: id, patch)
            apply(updated)
            // Archived while on screen: Todas is the one view that always exists.
            if updated.archived, scope == .one(id) {
                overviews = [:]
                scope = .all
            } else {
                await refresh()
            }
            return true
        } catch {
            model.handle(error)
            return false
        }
    }

    func setArchived(_ archived: Bool, _ id: String) async {
        await update(id, SubstancePatch(archived: archived))
    }

    /// Reorders active substances right away (so the dragged row stays put), then saves.
    func moveActive(from source: IndexSet, to destination: Int) {
        var ordered = active
        ordered.move(fromOffsets: source, toOffset: destination)
        for index in ordered.indices { ordered[index].position = index }
        substances = ordered + archived
        let ids = ordered.map(\.id)
        Task {
            guard let api = model.api else { return }
            do {
                substances = try await api.reorderSubstances(ids)
            } catch {
                model.handle(error)
                if let fresh = try? await api.substanceTypes() { substances = fresh }
            }
        }
    }

    private func apply(_ substance: Substance) {
        var list = substances.filter { $0.id != substance.id }
        list.append(substance)
        substances = Substance.sorted(list)
    }

    /// Entries, goals and names feed every view: drop the others and reload this one.
    private func refresh() async {
        overviews = overviews.filter { $0.key == scope }
        await load()
    }
}
