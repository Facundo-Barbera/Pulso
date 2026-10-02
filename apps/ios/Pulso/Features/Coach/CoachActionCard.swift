import SwiftUI

/// Deshacer for an action card, handed down by whoever owns the messages (a `ChatStore`).
/// Returns nil when it worked, else what to tell the person.
struct CoachUndo {
    let run: @MainActor (_ message: AgentMessage, _ index: Int) async -> String?
}

extension EnvironmentValues {
    @Entry var coachUndo: CoachUndo? = nil
}

/// The cards for what a Coach reply changed, each with Deshacer wired to the message.
struct CoachActionCards: View {
    let message: AgentMessage
    var compact = false
    @Environment(\.coachUndo) private var undo

    private var actions: [(index: Int, result: AgentToolResult)] {
        message.tools.enumerated().compactMap { index, tool in
            tool.status == .done ? tool.result.map { (index, $0) } : nil
        }
    }

    var body: some View {
        ForEach(actions, id: \.index) { action in
            CoachActionCard(result: action.result, compact: compact, onUndo: undo.map { undo in { await undo.run(message, action.index) } })
                .transition(.scale(scale: 0.95).combined(with: .opacity))
        }
    }
}

/// "Perfil actualizado · Objetivo: ~~Bajar de peso~~ → Bajar 10 kg de grasa — Abrir · Deshacer":
/// what a tool changed, where it lives and a way back. `compact` (inside a workout)
/// drops the link so the person stays on the gym floor.
struct CoachActionCard: View {
    let result: AgentToolResult
    var compact = false
    var onUndo: (() async -> String?)?

    @State private var opened = 0
    @State private var undoing = false
    @State private var error: String?
    @State private var showingMedication = false

    private var place: CoachResultPlace { CoachResultPlace(result: result) }

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 8 : 10) {
            header
            if !result.shownLines.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(result.shownLines.enumerated()), id: \.offset) { _, line in
                        CoachActionLineView(line: line, struck: result.undone)
                    }
                }
                .font(compact ? .footnote : .subheadline)
                .padding(.leading, compact ? 0 : 50)
            }
            if showsButtons { buttons.padding(.leading, compact ? 0 : 42) }
            if let error {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.orange)
                    .padding(.leading, compact ? 0 : 50)
                    .transition(.opacity)
            }
        }
        .padding(compact ? 12 : 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular.tint(place.color.opacity(result.undone ? 0.04 : 0.12)), in: .rect(cornerRadius: Theme.corner))
        .opacity(result.undone ? 0.75 : 1)
        .animation(.snappy, value: result.undo)
        .animation(.snappy, value: error)
        .sensoryFeedback(.selection, trigger: opened)
        .sensoryFeedback(.success, trigger: result.undone) { _, undone in undone }
        .sheet(isPresented: $showingMedication) {
            NavigationStack { MedicationView(model: PulsoModel.shared) }
        }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: result.undone ? "arrow.uturn.backward" : place.symbol)
                .font((compact ? Font.subheadline : .body).weight(.semibold))
                .foregroundStyle(place.color)
                .frame(width: compact ? 28 : 38, height: compact ? 28 : 38)
                .background(place.color.opacity(0.16), in: .circle)
                .contentTransition(.symbolEffect(.replace))
                .symbolEffect(.bounce, value: opened)
            Text(result.title)
                .font(compact ? .subheadline.weight(.semibold) : .headline)
            Spacer(minLength: 0)
            if result.undone {
                Text("Deshecho")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(.fill.tertiary, in: .capsule)
                    .transition(.scale.combined(with: .opacity))
            }
        }
    }

    private var canOpen: Bool { !compact && place.opens }
    private var canUndo: Bool { onUndo != nil && result.undoable }
    private var showsButtons: Bool { canOpen || canUndo }

    private var buttons: some View {
        HStack(spacing: 4) {
            if canOpen {
                Button {
                    opened += 1
                    open()
                } label: {
                    HStack(spacing: 3) {
                        Text("Abrir en \(place.name)")
                        Image(systemName: "chevron.right").font(.caption2.weight(.bold))
                    }
                    .foregroundStyle(place.color)
                    .padding(.horizontal, 8)
                    .frame(minHeight: 36)
                    .contentShape(.rect)
                }
                .accessibilityHint("Abre \(place.name)")
            }
            if canUndo {
                Button {
                    Task {
                        undoing = true
                        error = await onUndo?()
                        undoing = false
                    }
                } label: {
                    Label(undoing ? "Deshaciendo…" : "Deshacer", systemImage: "arrow.uturn.backward")
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 8)
                        .frame(minHeight: 36)
                        .contentShape(.rect)
                }
                .disabled(undoing)
                .symbolEffect(.pulse, isActive: undoing)
            }
        }
        .font(.footnote.weight(.semibold))
        .buttonStyle(.plain)
    }

    private func open() {
        if result.place == "medicacion" {
            showingMedication = true
        } else {
            CoachLauncher.shared.show(tab: result.tab)
        }
    }
}

/// "Objetivo: ~~Bajar de peso~~ → **Bajar 10 kg de grasa**".
struct CoachActionLineView: View {
    let line: AgentActionLine
    var struck = false

    var body: some View {
        let label = line.label.map { Text("\($0): ").foregroundStyle(.secondary) } ?? Text("")
        let before = line.before.map { Text("\(Text($0).strikethrough().foregroundStyle(.secondary)) → ").foregroundStyle(.secondary) } ?? Text("")
        Text("\(label)\(before)\(Text(line.value).fontWeight(.medium))")
            .strikethrough(struck)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityLabel([line.label, line.before.map { "antes \($0), ahora" }, line.value].compactMap { $0 }.joined(separator: " "))
    }
}

/// Where a card leads, as the tab bar names and draws it.
struct CoachResultPlace: Equatable {
    let name: String
    let symbol: String
    let color: Color
    /// False where the app has no screen for it (the profile lives on the Mac).
    var opens = true

    init(tab: String) {
        switch tab {
        case "entreno": (name, symbol, color) = ("Entreno", "dumbbell.fill", Theme.training)
        case "dieta": (name, symbol, color) = ("Dieta", "fork.knife", Theme.carbs)
        case "cuerpo": (name, symbol, color) = ("Cuerpo", "figure", Theme.body)
        default: (name, symbol, color) = ("Hoy", "sun.max.fill", Theme.energy)
        }
    }

    init(result: AgentToolResult) {
        switch result.place {
        case "medicacion": self.init(name: "Medicación", symbol: "pills.fill", color: Theme.water)
        case "perfil": self.init(name: "Perfil", symbol: "person.crop.circle.badge.checkmark", color: Theme.body, opens: false)
        default: self.init(tab: result.tab)
        }
    }

    private init(name: String, symbol: String, color: Color, opens: Bool = true) {
        (self.name, self.symbol, self.color, self.opens) = (name, symbol, color, opens)
    }
}

/// "Revisó 3 cosas": the lookups behind a reply, folded into one quiet line that opens to show them.
struct CoachCheckedGroup: View {
    let tools: [AgentToolUse]
    @State private var expanded = false

    private var labels: [(label: String, symbol: String, color: Color)] {
        var seen = Set<String>()
        return tools.map { CoachToolLabel.describe($0.name) }.filter { seen.insert($0.label).inserted }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.snappy) { expanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.good)
                    Text(tools.count == 1 ? "Revisó 1 cosa" : "Revisó \(tools.count) cosas")
                    Image(systemName: "chevron.down")
                        .font(.caption2.weight(.bold))
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .font(.footnote.weight(.medium))
                .foregroundStyle(.secondary)
                .frame(minHeight: 32)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint(expanded ? "Oculta lo que revisó" : "Muestra lo que revisó")
            if expanded {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(labels, id: \.label) { item in
                        Label {
                            Text(item.label)
                        } icon: {
                            Image(systemName: item.symbol).foregroundStyle(item.color)
                        }
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    }
                }
                .padding(.leading, 4)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .sensoryFeedback(.selection, trigger: expanded)
    }
}

#Preview("Action cards") {
    let profile = AgentToolResult(
        title: "Perfil actualizado", detail: nil, tab: "cuerpo", place: "perfil",
        lines: [AgentActionLine(label: "Objetivo", before: "Bajar de peso", value: "Bajar 10 kg de grasa")], undo: "available"
    )
    let meal = AgentToolResult(
        title: "Comida registrada", detail: nil, tab: "dieta",
        lines: [AgentActionLine(value: "Batido de proteína"), AgentActionLine(value: "347 kcal · 32 g proteína"), AgentActionLine(value: "Merienda · 17:30")], undo: "done"
    )
    ScrollView {
        VStack(spacing: 12) {
            CoachCheckedGroup(tools: [AgentToolUse(name: "get_profile", status: .done), AgentToolUse(name: "list_meals", status: .done)])
                .frame(maxWidth: .infinity, alignment: .leading)
            CoachActionCard(result: profile, onUndo: { nil })
            CoachActionCard(result: meal, onUndo: { nil })
            CoachActionCard(result: profile, compact: true, onUndo: { nil })
        }
        .padding()
    }
}
