import SwiftUI

/// A superset on one screen, top to bottom: each exercise's header (photo,
/// name, muscle, target) linked by "Superserie", the rest after each round,
/// then every round as a card of the same shape — the one up next highlighted
/// with one "Hecho" that logs a set of each and starts the rest, the others
/// quiet — then the actions and the next exercise.
struct SupersetPage: View {
    let session: LiveSession
    let group: Range<Int>
    /// The sessions to read history from; the store's when nil.
    var history: [TrainingSession]? = nil
    let swap: (Int) -> Void
    @State private var guide: Guide?
    @FocusState private var field: SetField?

    private struct Guide: Identifiable {
        let index: Int
        var id: Int { index }
    }

    private var state: LiveSessionState { session.state }
    private var valid: Bool { group.upperBound <= state.exercises.count }
    private var skipped: Bool { group.allSatisfy { state.exercises[$0].skipped } }

    var body: some View {
        if valid {
            let sessions = history ?? TrainingStore.shared.sessions
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    headers
                    if skipped {
                        SkippedBanner {
                            withAnimation(.snappy) { for e in group { session.setSkipped(e, false) } }
                        }
                        .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .top)))
                    }
                    rounds(sessions)
                    efforts
                    actions
                    NextCard(session: session, after: group.lowerBound)
                        .padding(.top, 8)
                }
                .padding(.horizontal, Theme.padding)
                .padding(.top, 8)
                .padding(.bottom, 24)
                .animation(.snappy, value: Array(state.exercises[group]))
            }
            .scrollDismissesKeyboard(.interactively)
            .setKeyboard($field, session: session)
            .sheet(item: $guide) { guide in
                let exercise = state.exercises[guide.index]
                NavigationStack {
                    ExerciseDetailView(exerciseId: exercise.exerciseId, name: exercise.name, today: exercise)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Cerrar", systemImage: "xmark") { self.guide = nil }
                            }
                        }
                }
            }
        }
    }

    // MARK: Headers

    /// Each exercise's header, linked.
    private var headers: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(group), id: \.self) { e in
                if e > group.lowerBound { SupersetLink() }
                ExerciseHeader(exercise: state.exercises[e], target: state.exercises[e].headerTarget(withRest: false)) { guide = Guide(index: e) }
            }
        }
    }

    // MARK: Rounds

    private func unit(_ e: Int) -> WeightUnit { TrainingStore.shared.unit(for: state.exercises[e].exerciseId) }

    /// The members with a set in round `r`: a skipped one only for what it already logged.
    private func members(_ r: Int) -> [Int] {
        group.filter { e in
            state.exercises[e].sets[safe: r].map { !state.exercises[e].skipped || $0.done } ?? false
        }
    }

    private func roundDone(_ r: Int) -> Bool {
        let members = members(r)
        return !members.isEmpty && members.allSatisfy { state.exercises[$0].sets[r].done }
    }

    private func rounds(_ sessions: [TrainingSession]) -> some View {
        let current = state.currentRound(group)
        return VStack(spacing: 8) {
            ForEach(0..<state.rounds(group), id: \.self) { r in
                if !members(r).isEmpty {
                    RoundCard(number: r + 1, current: r == current, done: roundDone(r)) {
                        ForEach(Array(members(r).enumerated()), id: \.element) { i, e in
                            if i > 0 { Divider() }
                            row(e, round: r, current: r == current, sessions: sessions)
                        }
                    } toggle: {
                        field = nil
                        withAnimation(.snappy) { session.toggleRound(group, round: r) }
                    }
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
        }
    }

    private func row(_ e: Int, round r: Int, current: Bool, sessions: [TrainingSession]) -> some View {
        let exercise = state.exercises[e]
        let set = exercise.sets[r]
        return SetRowView(
            number: r + 1, set: set, range: exercise.repRange(set), previous: LiveHistory.set(r, of: LiveHistory.last(exercise.exerciseId, in: sessions)),
            unit: unit(e), needsLoad: Equipment.needsLoad(exercise.equipment), current: current, field: $field,
            name: exercise.name, info: { guide = Guide(index: e) }
        ) { action in
            perform(action, exercise: e, set: r)
        }
    }

    private func perform(_ action: SetAction, exercise e: Int, set s: Int) {
        switch action {
        case .toggle, .close: field = nil
        case .addDrop:
            field = nil
            guard let drop = session.nextDrop(exercise: e, set: s) else { return }
            withAnimation(.snappy) { session.addDrop(exercise: e, set: s, drop) }
        case .removeDrop(let d):
            field = nil
            withAnimation(.snappy) { session.removeDrop(exercise: e, set: s, drop: d) }
        default: session.apply(action, exercise: e, set: s)
        }
    }

    // MARK: After

    /// The effort of each exercise once it is done.
    private var efforts: some View {
        ForEach(Array(group), id: \.self) { e in
            let exercise = state.exercises[e]
            if exercise.done && exercise.hasDoneWork {
                EffortCard(name: exercise.name, value: exercise.effort) { session.setEffort(exercise: e, to: $0) }
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
            }
        }
    }

    private var actions: some View {
        PageActions(
            noun: "Rondas", count: state.rounds(group), canRemove: state.canRemoveRound(group),
            add: { withAnimation(.snappy) { session.addRound(group) } },
            remove: { withAnimation(.snappy) { session.removeRound(group) } }
        ) {
            Menu("Cambiar ejercicio", systemImage: "arrow.triangle.2.circlepath") {
                ForEach(Array(group), id: \.self) { e in
                    Button(state.exercises[e].name) { swap(e) }
                }
            }
            Button("Separar", systemImage: "link.badge.plus") {
                withAnimation(.snappy) { session.splitSuperset(group) }
            }
            .accessibilityHint("Cada ejercicio sigue por su cuenta, con lo que ya hiciste")
        }
    }
}

/// A round: each exercise's set stacked, one tall action on the right ("Hecho"
/// filled on the round up next, a check to undo a done one, a quiet one ahead).
private struct RoundCard<Rows: View>: View {
    let number: Int
    let current: Bool
    let done: Bool
    @ViewBuilder let rows: Rows
    let toggle: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Ronda \(number)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(current && !done ? AnyShapeStyle(Theme.training) : AnyShapeStyle(.secondary))
                rows
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: toggle) {
                VStack(spacing: 2) {
                    Image(systemName: "checkmark").font(.title3.bold())
                    if !done { Text("Hecho").font(.caption.bold()) }
                }
                .frame(width: 44)
                .frame(maxHeight: .infinity)
            }
            .modifier(RoundButtonStyle(prominent: current && !done, done: done))
            .accessibilityLabel(done ? "Desmarcar ronda \(number)" : "Hecho, ronda \(number)")
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(12)
        .background(background, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay {
            if current && !done {
                RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Theme.training.opacity(0.55), lineWidth: 1.5)
            }
        }
    }

    /// As a set row: the round up next stands out, done ones keep a hint of the accent.
    private var background: Color {
        if current && !done { return Theme.training.opacity(0.14) }
        return done ? Theme.training.opacity(0.07) : Color.secondary.opacity(0.07)
    }
}

/// The current round's filled glass "Hecho"; a done or upcoming one's quiet square.
private struct RoundButtonStyle: ViewModifier {
    let prominent: Bool
    let done: Bool

    func body(content: Content) -> some View {
        if prominent {
            content
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.roundedRectangle(radius: 16))
                .tint(Theme.training)
        } else {
            content
                .foregroundStyle(done ? AnyShapeStyle(Theme.training) : AnyShapeStyle(.tertiary))
                .padding(.horizontal, 8)
                .background(done ? Theme.training.opacity(0.18) : Color.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .buttonStyle(.plain)
        }
    }
}

#if DEBUG
#Preview("Superserie · 375 pt", traits: .fixedLayout(width: 375, height: 812)) {
    @Previewable @State var session: LiveSession = {
        var state = LiveSessionState.preview
        state.exercises[0].supersetId = "a"
        state.exercises[1].supersetId = "a"
        state.undoRound(0..<2, round: 0)
        return LiveSession(state: state)
    }()
    NavigationStack {
        SupersetPage(session: session, group: 0..<2, history: TrainingSession.previewHistory) { _ in }
            .navigationTitle("Torso A")
            .navigationBarTitleDisplayMode(.inline)
    }
}
#endif
