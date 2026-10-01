import SwiftUI

/// Cambios: every change to the plan, newest first, each one undoable while it
/// is live. The Mac refuses an older one while a later change touches the same days.
struct PlanChangesView: View {
    let store: NutritionStore
    @State private var revisions: [PlanRevision]?
    @State private var undoing: String?

    var body: some View {
        List {
            if let revisions {
                if revisions.isEmpty {
                    ContentUnavailableView("Sin cambios todavía", systemImage: "clock.arrow.circlepath",
                                           description: Text("Cuando algo cambie en tu plan, quedará aquí y podrás deshacerlo."))
                } else {
                    ForEach(revisions) { revision in
                        RevisionRow(revision: revision, busy: undoing == revision.id) {
                            Task { await undo(revision) }
                        }
                    }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .navigationTitle("Cambios")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .sensoryFeedback(.success, trigger: undoing) { old, new in old != nil && new == nil }
    }

    private func load() async {
        guard let api = PulsoModel.shared.api else { return }
        do {
            revisions = try await api.planRevisions()
        } catch {
            revisions = revisions ?? []
            PulsoModel.shared.handle(error)
        }
    }

    private func undo(_ revision: PlanRevision) async {
        undoing = revision.id
        _ = await store.undo(revision.id)
        await load()
        undoing = nil
    }
}

private struct RevisionRow: View {
    let revision: PlanRevision
    let busy: Bool
    let onUndo: () -> Void

    private var days: String {
        revision.dates.compactMap(NutritionDate.date).map { $0.formatted(.dateTime.weekday(.abbreviated).day()) }.joined(separator: ", ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(revision.summary)
                .foregroundStyle(revision.isLive ? .primary : .secondary)
                .strikethrough(!revision.isLive, color: .secondary)
            HStack(spacing: 6) {
                Text(revision.created, format: .relative(presentation: .named))
                if !days.isEmpty {
                    Text("·")
                    Text(days)
                }
                if !revision.isLive {
                    Text("·")
                    Text("Deshecho")
                }
            }
            .font(.caption).foregroundStyle(.secondary)
            .lineLimit(1)
        }
        .padding(.vertical, 2)
        .swipeActions(edge: .trailing) {
            if revision.isLive {
                Button("Deshacer", systemImage: "arrow.uturn.backward", action: onUndo).tint(Theme.training)
            }
        }
        .contextMenu {
            if revision.isLive { Button("Deshacer", systemImage: "arrow.uturn.backward", action: onUndo) }
        }
        .overlay(alignment: .trailing) { if busy { ProgressView() } }
    }
}

#Preview("Cambios") {
    NavigationStack { PlanChangesView(store: NutritionStore()) }
}
