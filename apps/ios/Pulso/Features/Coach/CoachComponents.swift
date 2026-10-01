import SwiftUI

/// What the Coach is doing with a tool, in the person's words.
enum CoachToolLabel {
    static func describe(_ name: String) -> (label: String, symbol: String, color: Color) {
        switch name {
        case "list_workouts": return ("Revisando tus entrenamientos", "dumbbell.fill", Theme.training)
        case "get_profile": return ("Leyendo tu perfil", "person.text.rectangle", .accentColor)
        case "update_profile": return ("Actualizando tu perfil", "person.crop.circle.badge.checkmark", .accentColor)
        case "WebSearch": return ("Buscando en la web", "magnifyingglass", .secondary)
        case "WebFetch": return ("Leyendo una página", "globe", .secondary)
        case "Read": return ("Revisando sus notas", "note.text", .secondary)
        case "Write": return ("Tomando notas", "square.and.pencil", .secondary)
        default: break
        }
        // Other features add tools to the registry; guess their domain from the name.
        let lower = name.lowercased()
        let writes = ["log_", "add_", "create_", "update_", "save_", "set_", "delete_", "plan_"].contains { lower.hasPrefix($0) }
        if ["workout", "training", "exercise", "routine", "session", "lift"].contains(where: lower.contains) {
            return (writes ? "Actualizando tu entrenamiento" : "Revisando tus entrenamientos", "dumbbell.fill", Theme.training)
        }
        if ["meal", "food", "nutrition", "diet", "macro", "calorie", "recipe"].contains(where: lower.contains) {
            return (writes ? "Actualizando tu alimentación" : "Revisando tu alimentación", "fork.knife", Theme.carbs)
        }
        if ["body", "weight", "composition", "measure", "fat"].contains(where: lower.contains) {
            return (writes ? "Guardando tus medidas" : "Revisando tu composición corporal", "figure", Theme.body)
        }
        if ["metric", "sleep", "step", "daily", "today", "heart", "hrv"].contains(where: lower.contains) {
            return ("Revisando tus métricas del día", "heart.text.square", Theme.protein)
        }
        return (writes ? "Guardando cambios" : "Consultando tus datos", "sparkles", .accentColor)
    }
}

struct ToolChip: View {
    let tool: AgentToolUse

    var body: some View {
        let info = CoachToolLabel.describe(tool.name)
        HStack(spacing: 6) {
            Group {
                switch tool.status {
                case .running:
                    Image(systemName: info.symbol).symbolEffect(.pulse, options: .repeating)
                case .done:
                    Image(systemName: "checkmark.circle.fill").transition(.symbolEffect(.drawOn))
                case .error:
                    Image(systemName: "exclamationmark.circle.fill")
                }
            }
            .foregroundStyle(tool.status == .error ? AnyShapeStyle(.orange) : AnyShapeStyle(info.color))
            .contentTransition(.symbolEffect(.replace))
            Text(tool.status == .running ? "\(info.label)…" : info.label)
                .foregroundStyle(tool.status == .running ? .primary : .secondary)
        }
        .font(.footnote.weight(.medium))
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .glassEffect(.regular.tint(info.color.opacity(tool.status == .running ? 0.18 : 0.06)), in: .capsule)
        .animation(.snappy, value: tool.status)
    }
}

/// Three dots that breathe while the Coach is thinking.
struct ThinkingDots: View {
    var body: some View {
        Image(systemName: "ellipsis")
            .font(.title2.weight(.bold))
            .symbolEffect(.variableColor.iterative.dimInactiveLayers, options: .repeating)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .glassEffect(.regular, in: .capsule)
            .accessibilityLabel("El Coach está pensando")
    }
}

/// The Coach's mark: sparkles on a glass disc, alive while it answers.
struct CoachAvatar: View {
    var size: CGFloat = 28
    var active = false

    var body: some View {
        Image(systemName: "sparkles")
            .font(.system(size: size * 0.48, weight: .semibold))
            .foregroundStyle(CoachGradient.linear)
            .symbolEffect(.breathe, options: .repeating, isActive: active)
            .frame(width: size, height: size)
            .glassEffect(.regular, in: .circle)
    }
}

enum CoachGradient {
    static let colors = [Theme.training, Theme.protein, Theme.carbs, Theme.fat, Theme.body, Theme.training]
    static let linear = LinearGradient(colors: [Theme.training, Theme.protein, Theme.carbs], startPoint: .topLeading, endPoint: .bottomTrailing)
}

/// An Apple Intelligence–style glow that circles a shape while the Coach answers.
struct GlowBorder<S: InsettableShape>: View {
    let shape: S
    @State private var angle = 0.0

    var body: some View {
        let gradient = AngularGradient(colors: CoachGradient.colors, center: .center, angle: .degrees(angle))
        ZStack {
            shape.strokeBorder(gradient, lineWidth: 2).blur(radius: 6).opacity(0.7)
            shape.strokeBorder(gradient, lineWidth: 1.2)
        }
        .allowsHitTesting(false)
        .onAppear {
            withAnimation(.linear(duration: 3).repeatForever(autoreverses: false)) { angle = 360 }
        }
    }
}

struct StarterPrompt: Identifiable {
    let text: String
    let symbol: String
    let color: Color
    var id: String { text }

    static let all = [
        StarterPrompt(text: "Diseña mi rutina de esta semana", symbol: "dumbbell.fill", color: Theme.training),
        StarterPrompt(text: "Arma mi plan de comidas", symbol: "fork.knife", color: Theme.carbs),
        StarterPrompt(text: "¿Cómo voy este mes?", symbol: "chart.line.uptrend.xyaxis", color: Theme.body),
    ]
}

/// The designed empty state: the Coach's mark, one line, the starter prompts.
struct CoachWelcome: View {
    var title = "Tu coach personal"
    var subtitle = "Rutinas, comidas y progreso, pensados con tus datos."
    let onPick: (String) -> Void
    @State private var appeared = false

    var body: some View {
        VStack(spacing: 28) {
            VStack(spacing: 16) {
                ZStack {
                    Circle()
                        .fill(AngularGradient(colors: CoachGradient.colors, center: .center))
                        .blur(radius: 28)
                        .opacity(0.45)
                        .frame(width: 120, height: 120)
                    CoachAvatar(size: 84, active: true)
                }
                .scaleEffect(appeared ? 1 : 0.85)
                .opacity(appeared ? 1 : 0)
                VStack(spacing: 6) {
                    Text(title).font(.title2.weight(.bold)).fontDesign(.rounded)
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
            GlassEffectContainer(spacing: 10) {
                VStack(spacing: 10) {
                    ForEach(Array(StarterPrompt.all.enumerated()), id: \.element.id) { index, prompt in
                        Button {
                            onPick(prompt.text)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: prompt.symbol)
                                    .foregroundStyle(prompt.color)
                                    .frame(width: 22)
                                Text(prompt.text).foregroundStyle(.primary)
                                Spacer(minLength: 0)
                                Image(systemName: "arrow.up.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                            }
                            .font(.body.weight(.medium))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: Theme.corner))
                        .offset(y: appeared ? 0 : 16)
                        .opacity(appeared ? 1 : 0)
                        .animation(.snappy.delay(0.08 * Double(index + 1)), value: appeared)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
        .onAppear { withAnimation(.smooth) { appeared = true } }
    }
}
