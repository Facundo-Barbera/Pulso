import Foundation
import Observation

/// Sustancias' state. Owned by the screen, not shared: nothing of it stays in
/// memory once the screen closes, and no other part of the app can read it.
@MainActor
@Observable
final class SubstanceStore {
    var substance: Substance = .cannabis
    private(set) var overviews: [Substance: SubstanceOverview] = [:]
    private(set) var loading = false
    /// Bumped on every saved or deleted entry; the screen hangs haptics off it.
    private(set) var changes = 0

    private var model: PulsoModel { .shared }

    var current: SubstanceOverview? { overviews[substance] }

    /// Unstructured callers only: a cancelled request would read as the Mac being offline.
    func load() async {
        guard let api = model.api else { return }
        let substance = substance
        loading = true
        defer { loading = false }
        do {
            overviews[substance] = try await api.substanceOverview(substance)
        } catch {
            model.handle(error)
        }
    }

    func save(_ draft: SubstanceDraft, id: String?) async -> Bool {
        guard let api = model.api else { return false }
        do {
            if let id { _ = try await api.updateSubstanceEntry(id: id, draft) } else { _ = try await api.addSubstanceEntry(draft) }
            changes += 1
            // An edit that moved the entry to another substance: the one it left reloads when shown.
            if draft.substance != substance {
                overviews[substance] = nil
                substance = draft.substance // the screen loads on the switch
            } else {
                await load()
            }
            return true
        } catch {
            model.handle(error)
            return false
        }
    }

    func delete(_ entry: SubstanceEntry) async {
        guard let api = model.api else { return }
        overviews[entry.substance]?.entries.removeAll { $0.id == entry.id }
        do {
            try await api.deleteSubstanceEntry(id: entry.id)
            changes += 1
        } catch {
            model.handle(error)
        }
        await reload(entry.substance)
    }

    /// The person's own weekly maximum; nil removes it.
    func setGoal(_ maxDaysPerWeek: Int?) async {
        guard let api = model.api else { return }
        do {
            _ = try await api.updateSubstanceSettings(maxDaysPerWeek: maxDaysPerWeek)
        } catch {
            model.handle(error)
        }
        // The goal is one setting for every substance; the others reload when shown.
        overviews = overviews.filter { $0.key == substance }
        await load()
    }

    private func reload(_ other: Substance) async {
        guard let api = model.api else { return }
        do {
            overviews[other] = try await api.substanceOverview(other)
        } catch {
            model.handle(error)
        }
    }
}
