import SwiftUI

/// The Coach's morning brief (and, on Sunday and Monday, the weekly check-in)
/// as a glass card. "Responder" opens a conversation that starts from it.
struct CoachBriefCard: View {
    let model: PulsoModel
    @State private var store = CoachBriefStore()
    @State private var kind: CoachBrief.Kind = .daily
    @Environment(\.scenePhase) private var scenePhase

    /// The check-in is offered while it is fresh: its Sunday or the day after.
    private var freshWeekly: CoachBrief? {
        guard let weekly = store.briefs.weekly, let day = weekly.day,
              let age = Calendar.current.dateComponents([.day], from: day, to: .now).day, age <= 1 else { return nil }
        return weekly
    }

    private var brief: CoachBrief? { kind == .weekly ? freshWeekly : store.briefs.daily }
    private var writing: Bool { brief?.status == .running }
    private var hasText: Bool { !(brief?.text.isEmpty ?? true) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            content
                .transition(.blurReplace)
            if hasText, let brief {
                actions(brief)
            }
        }
        .padding(Theme.padding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: Theme.corner))
        .overlay {
            if writing { GlowBorder(shape: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous)).transition(.opacity) }
        }
        .animation(.snappy, value: store.briefs)
        .animation(.snappy, value: kind)
        .sensoryFeedback(.success, trigger: store.briefs.daily?.updatedAt) { old, new in old != nil && new != old }
        .task(id: model.credentials?.deviceId) { await store.refresh() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await store.refresh() } }
        }
        .onChange(of: freshWeekly?.id) { _, id in
            if id == nil { kind = .daily }
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            CoachAvatar(size: 30, active: writing)
            VStack(alignment: .leading, spacing: 1) {
                Text(kind == .weekly ? "Tu semana" : "Resumen del Coach")
                    .font(.headline)
                if let subtitle {
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            if freshWeekly != nil {
                Picker("Resumen", selection: $kind) {
                    Text("Hoy").tag(CoachBrief.Kind.daily)
                    Text("Semana").tag(CoachBrief.Kind.weekly)
                }
                .pickerStyle(.segmented)
                .fixedSize()
            }
        }
    }

    private var subtitle: String? {
        if writing { return hasText ? "Actualizando…" : nil }
        guard let brief, let day = brief.day else { return nil }
        if brief.kind == .weekly { return "Semana al \(day.formatted(.dateTime.day().month(.wide)))" }
        return Calendar.current.isDateInToday(day) ? "Hoy" : day.formatted(.dateTime.weekday(.wide).day().month(.wide))
    }

    @ViewBuilder
    private var content: some View {
        if let brief, hasText {
            CoachMarkdown(text: brief.text)
                .font(.subheadline)
                .opacity(writing ? 0.55 : 1)
                .textSelection(.enabled)
        } else if writing {
            HStack(spacing: 10) {
                ThinkingDots()
                Text("Tu Coach está revisando tus datos…")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        } else if store.loaded {
            empty
        } else {
            ProgressView().frame(maxWidth: .infinity, minHeight: 60)
        }
    }

    private var empty: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "sun.horizon.fill")
                    .font(.title2)
                    .foregroundStyle(Theme.carbs.gradient)
                    .symbolEffect(.breathe, options: .repeating)
                Text(brief?.status == .error
                     ? "El Coach no pudo preparar tu resumen. Inténtalo de nuevo."
                     : "Cada mañana tu Coach te deja aquí un resumen del día: recuperación, entreno, comida y medicación.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Button("Preparar ahora", systemImage: "sparkles") {
                Task { await store.regenerate(kind) }
            }
            .buttonStyle(.glassProminent)
        }
    }

    private func actions(_ brief: CoachBrief) -> some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                Button {
                    Task { await store.reply(to: brief) }
                } label: {
                    Label("Responder", systemImage: store.replying ? "ellipsis" : "arrowshape.turn.up.left.fill")
                        .contentTransition(.symbolEffect(.replace))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .disabled(writing || store.replying)

                Button {
                    Task { await store.regenerate(brief.kind) }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .symbolEffect(.rotate, options: .repeating, isActive: writing)
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .disabled(writing)
                .accessibilityLabel("Volver a generar")
            }
        }
        .sensoryFeedback(.selection, trigger: store.replying) { _, new in new }
    }
}
