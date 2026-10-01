import SwiftUI

/// Paired: five tabs, one per feature folder under `Features/`, each with the
/// Ajustes button, and an offline accessory above the tab bar when the Mac is
/// unreachable. Not paired: onboarding and nothing else.
struct RootView: View {
    let model: PulsoModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var tab = "hoy"
    private var launcher = CoachLauncher.shared
    private var training = TrainingStore.shared

    init(model: PulsoModel) { self.model = model }

    var body: some View {
        Group {
            if model.credentials == nil {
                OnboardingView(model: model)
                    .transition(.opacity)
            } else {
                TabView(selection: $tab) {
                    Tab("Hoy", systemImage: "sun.max", value: "hoy") {
                        NavigationStack { TodayView(model: model).settingsToolbar(model) }
                    }
                    Tab("Coach", systemImage: "sparkles", value: "coach") {
                        NavigationStack { CoachView(model: model).settingsToolbar(model) }
                    }
                    Tab("Entreno", systemImage: "dumbbell", value: "entreno") {
                        NavigationStack { TrainingView(model: model).settingsToolbar(model) }
                    }
                    Tab("Dieta", systemImage: "fork.knife", value: "dieta") {
                        NavigationStack { NutritionView(model: model).settingsToolbar(model) }
                    }
                    Tab("Cuerpo", systemImage: "figure", value: "cuerpo") {
                        NavigationStack { BodyView(model: model).settingsToolbar(model) }
                    }
                }
                .modifier(OfflineAccessory(model: model))
                .onChange(of: launcher.pending?.id) { _, id in if id != nil { tab = "coach" } }
                // The Coach's result cards ("Abrir en Entreno") ask for another tab.
                .onChange(of: launcher.tabRequest?.id) { _, id in if id != nil, let next = launcher.takeTab() { tab = next } }
                // A session started from Siri, a widget or another tab shows where it lives.
                .onChange(of: training.live != nil) { _, live in if live { tab = "entreno" } }
                .transition(.opacity)
            }
        }
        .animation(.snappy, value: model.credentials == nil)
        .sensoryFeedback(.success, trigger: model.credentials != nil) { _, paired in paired }
        .task { await model.refresh() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await model.refresh() }
                // Replies the Mac kept writing while Pulso was away pick up where they were.
                ChatStore.resumeAll()
            }
        }
    }
}

/// The banner as the tab bar's bottom accessory (iOS 26.1+, which the phone runs);
/// on 26.0 a glass capsule floating above the tab bar instead.
private struct OfflineAccessory: ViewModifier {
    let model: PulsoModel

    func body(content: Content) -> some View {
        if #available(iOS 26.1, *) {
            content.tabViewBottomAccessory(isEnabled: model.offline) { OfflineBanner(model: model) }
        } else {
            content.overlay(alignment: .bottom) {
                if model.offline {
                    OfflineBanner(model: model)
                        .padding(.vertical, 10)
                        .glassEffect(.regular, in: .capsule)
                        .padding(.horizontal)
                        .padding(.bottom, 64)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.snappy, value: model.offline)
        }
    }
}

/// "Sin conexión con la Mac" with a retry, in the tab bar's glass accessory. While it
/// shows, the Mac is pinged every 20 s so it disappears on its own when it's back.
struct OfflineBanner: View {
    let model: PulsoModel

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "wifi.exclamationmark")
                .foregroundStyle(.orange)
                .symbolEffect(.pulse, isActive: model.checking)
            VStack(alignment: .leading, spacing: 0) {
                Text("Sin conexión con la Mac").font(.subheadline.weight(.semibold))
                Text("Revisa que esté despierta y con Tailscale").font(.caption).foregroundStyle(.secondary)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            Spacer(minLength: 8)
            Button {
                Task { await model.checkConnection() }
            } label: {
                if model.checking {
                    ProgressView().controlSize(.small)
                } else {
                    Text("Reintentar").font(.subheadline.weight(.semibold)).lineLimit(1)
                }
            }
            .layoutPriority(1)
            .disabled(model.checking)
        }
        .padding(.horizontal, 16)
        .accessibilityElement(children: .combine)
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                if model.offline { await model.checkConnection() }
            }
        }
    }
}
