import SwiftUI

/// First launch, and after "Olvidar esta Mac": what Pulso is → Apple Health → pair.
/// Someone who already went through the first two steps lands straight on pairing.
struct OnboardingView: View {
    let model: PulsoModel
    @AppStorage("pulso.onboarded") private var onboarded = false
    @State private var step: Step = .welcome
    @State private var forward = true

    enum Step: Int, CaseIterable { case welcome, health, pair }

    var body: some View {
        VStack(spacing: 0) {
            header
            ZStack {
                switch step {
                case .welcome: WelcomeStep { go(.health) }
                case .health: HealthStep { go(.pair) }
                case .pair: PairView(model: model)
                }
            }
            .transition(.asymmetric(
                insertion: .move(edge: forward ? .trailing : .leading).combined(with: .opacity),
                removal: .move(edge: forward ? .leading : .trailing).combined(with: .opacity)
            ))
            .id(step)
        }
        .background { OnboardingBackground() }
        .onAppear { if onboarded { step = .pair } }
    }

    /// Back chevron and three progress dots, in one glass bar.
    private var header: some View {
        HStack {
            Button {
                go(Step(rawValue: step.rawValue - 1) ?? .welcome)
            } label: {
                Image(systemName: "chevron.left").font(.body.weight(.semibold)).frame(width: 22, height: 22)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .opacity(step == .welcome ? 0 : 1)
            .disabled(step == .welcome)
            .accessibilityLabel("Atrás")
            Spacer()
            HStack(spacing: 6) {
                ForEach(Step.allCases, id: \.self) { item in
                    Capsule()
                        .fill(item == step ? AnyShapeStyle(Theme.brandGradient) : AnyShapeStyle(.secondary.opacity(0.35)))
                        .frame(width: item == step ? 22 : 7, height: 7)
                }
            }
            .accessibilityElement()
            .accessibilityLabel("Paso \(step.rawValue + 1) de \(Step.allCases.count)")
            Spacer()
            Color.clear.frame(width: 44, height: 44)
        }
        .padding(.horizontal)
        .padding(.top, 8)
    }

    private func go(_ next: Step) {
        forward = next.rawValue > step.rawValue
        if next == .pair { onboarded = true }
        withAnimation(.snappy(duration: 0.4)) { step = next }
    }
}

// MARK: - Steps

private struct WelcomeStep: View {
    let next: () -> Void
    @State private var appeared = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)
            BrandMark(size: 112)
                .scaleEffect(appeared ? 1 : 0.6)
                .opacity(appeared ? 1 : 0)
            Text("Pulso")
                .font(.system(size: 44, weight: .bold, design: .rounded))
                .padding(.top, 24)
            Text("Tu dieta, tu entreno y tu cuerpo, con un coach que los entiende juntos.")
                .font(.title3)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.top, 8)
                .padding(.horizontal, 24)
            VStack(alignment: .leading, spacing: 18) {
                Feature(systemImage: "sparkles", tint: Theme.training, title: "Un coach que conoce tus datos", text: "Pregúntale qué comer o cómo entrenar hoy.")
                Feature(systemImage: "chart.line.uptrend.xyaxis", tint: Theme.body, title: "Tendencias, no sólo números", text: "Peso, composición, sueño y recuperación en el tiempo.")
                Feature(systemImage: "lock.laptopcomputer", tint: Theme.fat, title: "Tus datos viven en tu Mac", text: "Nada pasa por la nube: el iPhone habla con tu Mac por Tailscale.")
            }
            .padding(.top, 36)
            .padding(.horizontal, 28)
            Spacer(minLength: 24)
            PrimaryButton(title: "Empezar", action: next)
        }
        .onAppear { withAnimation(.spring(duration: 0.7, bounce: 0.4).delay(0.1)) { appeared = true } }
    }
}

private struct HealthStep: View {
    let next: () -> Void
    @State private var asking = false
    @State private var failed: String?

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)
            Image(systemName: "heart.fill")
                .font(.system(size: 54, weight: .semibold))
                .foregroundStyle(.white)
                .symbolEffect(.pulse)
                .frame(width: 112, height: 112)
                .background(LinearGradient(colors: [Color(red: 1, green: 0.38, blue: 0.45), Color(red: 0.96, green: 0.18, blue: 0.33)], startPoint: .top, endPoint: .bottom), in: RoundedRectangle(cornerRadius: 26, style: .continuous))
                .shadow(color: .pink.opacity(0.35), radius: 18, y: 8)
            Text("Apple Salud")
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .padding(.top, 24)
            Text("Pulso lee de Salud lo que tu iPhone y tu reloj ya miden, para que el coach trabaje con datos reales.")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.top, 8)
                .padding(.horizontal, 28)
            VStack(alignment: .leading, spacing: 18) {
                Feature(systemImage: "figure.run", tint: Theme.energy, title: "Entrenamientos y actividad", text: "Sesiones, pasos, energía y minutos de ejercicio.")
                Feature(systemImage: "bed.double.fill", tint: Theme.fat, title: "Sueño y recuperación", text: "Fases de sueño, pulso en reposo y variabilidad.")
                Feature(systemImage: "figure", tint: Theme.body, title: "Cuerpo", text: "Peso y porcentaje de grasa.")
            }
            .padding(.top, 32)
            .padding(.horizontal, 28)
            Text("Sólo lectura. Puedes cambiarlo cuando quieras en Salud → tu perfil → Apps → Pulso.")
                .font(.footnote)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
                .padding(.top, 24)
                .padding(.horizontal, 32)
            if let failed {
                Text(failed).font(.footnote).foregroundStyle(Theme.protein).padding(.top, 8)
            }
            Spacer(minLength: 24)
            PrimaryButton(title: "Permitir acceso", busy: asking) {
                Task { await ask() }
            }
            Button("Ahora no", action: next)
                .font(.body.weight(.medium))
                .foregroundStyle(.secondary)
                .padding(.bottom, 8)
        }
    }

    private func ask() async {
        guard HealthSync.available else { return next() }
        asking = true
        defer { asking = false }
        do {
            try await HealthSync.requestAccess()
            next()
        } catch {
            failed = "Salud no respondió. Puedes hacerlo luego desde Ajustes."
        }
    }
}

// MARK: - Pieces

/// One icon + title + line row of the welcome and Health steps.
private struct Feature: View {
    let systemImage: String
    let tint: Color
    let title: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            Image(systemName: systemImage)
                .font(.title2)
                .foregroundStyle(tint.gradient)
                .frame(width: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(text).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// The full-width call to action at the bottom of each step.
struct PrimaryButton: View {
    let title: String
    var busy = false
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if busy { ProgressView().tint(.white) }
                Text(title)
            }
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
        }
        .buttonStyle(.glassProminent)
        .disabled(busy || disabled)
        .padding(.horizontal, 24)
        .padding(.bottom, 12)
    }
}

/// Two soft blooms of the icon's colors behind the glass; quiet in light and dark.
private struct OnboardingBackground: View {
    var body: some View {
        ZStack {
            Color(.systemBackground)
            Circle()
                .fill(Theme.brand[0].opacity(0.22))
                .frame(width: 420)
                .blur(radius: 110)
                .offset(x: -140, y: -320)
            Circle()
                .fill(Theme.brand[2].opacity(0.18))
                .frame(width: 460)
                .blur(radius: 120)
                .offset(x: 160, y: 340)
        }
        .ignoresSafeArea()
    }
}
