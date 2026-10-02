import SwiftUI
import UIKit

/// What RootView shows instead of the app while it's locked: the mark, one line,
/// and "Desbloquear". Asks for Face ID by itself once, as soon as the scene is active.
struct LockScreen: View {
    let lock: AppLock
    @Environment(\.scenePhase) private var scenePhase
    @State private var prompted = false
    @State private var failures = 0

    var body: some View {
        LockArtwork(subtitle: "Tus datos de salud están protegidos.")
            .overlay(alignment: .bottom) {
                Button {
                    Task { await unlock() }
                } label: {
                    Label("Desbloquear", systemImage: AppLock.methodSymbol)
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .disabled(lock.authenticating)
                .padding(.horizontal, 40)
                .padding(.bottom, 24)
            }
            .sensoryFeedback(.error, trigger: failures)
            .task(id: scenePhase) {
                guard scenePhase == .active, !prompted else { return }
                prompted = true
                await unlock()
            }
    }

    private func unlock() async {
        await lock.unlock()
        if lock.locked { failures += 1 }
    }
}

/// The mark centered on a calm backdrop. The lock screen and the app-switcher
/// cover share it, so locking on return looks like the cover simply staying.
struct LockArtwork: View {
    var subtitle: String?

    var body: some View {
        VStack(spacing: 18) {
            BrandMark(size: 92)
            VStack(spacing: 6) {
                Text("Pulso").font(.largeTitle.weight(.bold)).fontDesign(.rounded)
                if let subtitle {
                    Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
                }
            }
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            ZStack {
                Color(.systemBackground)
                LinearGradient(colors: [Theme.brand[2].opacity(0.16), Theme.brand[0].opacity(0.06), .clear], startPoint: .top, endPoint: .bottom)
            }
            .ignoresSafeArea()
        }
    }
}

/// Covers everything, sheets included, while the scene isn't active (app switcher,
/// Control Center), independent of the lock setting. A window of its own above
/// the app's, so nothing the app presents can sit on top of it.
@MainActor
final class PrivacyShield {
    static let shared = PrivacyShield()
    private var window: UIWindow?
    private var hiding: Task<Void, Never>?

    func show() {
        hiding?.cancel()
        hiding = nil
        if let window {
            window.alpha = 1
            return
        }
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
        let window = UIWindow(windowScene: scene)
        window.windowLevel = .alert + 1
        let host = UIHostingController(rootView: LockArtwork())
        host.view.backgroundColor = .systemBackground
        window.rootViewController = host
        window.isHidden = false
        self.window = window
    }

    /// `after` lets the app settle first, e.g. sheets closing behind a lock that just engaged.
    func hide(after delay: Duration = .zero) {
        guard window != nil, hiding == nil else { return }
        hiding = Task {
            if delay > .zero { try? await Task.sleep(for: delay) }
            guard !Task.isCancelled, let window else { return }
            UIView.animate(withDuration: 0.25) {
                window.alpha = 0
            } completion: { _ in
                Task { @MainActor in self.dropIfHidden() }
            }
        }
    }

    private func dropIfHidden() {
        guard let window, window.alpha == 0 else { return }
        window.isHidden = true
        self.window = nil
        hiding = nil
    }
}
