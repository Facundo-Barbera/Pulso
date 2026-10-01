import SwiftUI
import UserNotifications

/// Ajustes: the connection to the Mac, this iPhone, permissions, and forgetting the Mac.
/// Presented as a sheet from the toolbar button every tab gets in RootView.
struct SettingsView: View {
    let model: PulsoModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var notifications: UNAuthorizationStatus?
    @State private var askingHealth = false
    @State private var confirmForget = false

    var body: some View {
        NavigationStack {
            Form {
                header
                connection
                device
                permissions
                Section {
                    Button("Olvidar esta Mac", systemImage: "laptopcomputer.slash", role: .destructive) { confirmForget = true }
                } footer: {
                    Text("Para volver a usar Pulso tendrás que emparejar con un código nuevo. Tus datos siguen en la Mac.")
                }
            }
            .navigationTitle("Ajustes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Listo", systemImage: "checkmark") { dismiss() }
                }
            }
            .confirmationDialog("¿Olvidar esta Mac?", isPresented: $confirmForget, titleVisibility: .visible) {
                Button("Olvidar esta Mac", role: .destructive) {
                    dismiss()
                    model.unpair()
                }
            } message: {
                Text("Este iPhone dejará de sincronizar hasta que lo emparejes otra vez.")
            }
            .task { await reload() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await loadNotifications() } }
            }
        }
    }

    private var header: some View {
        Section {
            VStack(spacing: 10) {
                BrandMark(size: 72)
                Text("Pulso").font(.title2.weight(.bold)).fontDesign(.rounded)
                Text("Versión \(Self.version)").font(.footnote).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
        }
        .listRowBackground(Color.clear)
    }

    private var connection: some View {
        Section("Conexión") {
            LabeledContent("Estado") {
                ConnectionBadge(reachability: model.reachability, checking: model.checking)
            }
            LabeledContent("Dirección") {
                Text(model.credentials?.baseURL.absoluteString ?? "—")
                    .font(.callout.monospaced())
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
            }
            LabeledContent("Último contacto") {
                if let last = model.lastContact {
                    TimelineView(.periodic(from: .now, by: 15)) { _ in
                        Text(last, format: .relative(presentation: .named))
                    }
                } else {
                    Text("—")
                }
            }
            LabeledContent("Latencia") {
                Text(model.latency.map(Self.milliseconds) ?? "—")
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .animation(.snappy, value: model.latency)
            }
            Button("Probar conexión", systemImage: "arrow.triangle.2.circlepath") {
                Task { await model.checkConnection() }
            }
            .disabled(model.checking)
        }
    }

    private var device: some View {
        Section {
            LabeledContent("Nombre", value: model.credentials?.name ?? "—")
        } header: {
            Text("Este iPhone")
        } footer: {
            Text("Así aparece en la Mac, en la lista de dispositivos emparejados.")
        }
    }

    private var permissions: some View {
        Section {
            LabeledContent {
                Button("Revisar") { Task { await askHealth() } }
                    .disabled(askingHealth || !HealthSync.available)
            } label: {
                Label { Text("Apple Salud") } icon: { Image(systemName: "heart.fill").foregroundStyle(.pink) }
            }
            LabeledContent {
                notificationAction
            } label: {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Notificaciones")
                        Text(Self.describe(notifications)).font(.caption).foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: "bell.badge.fill").foregroundStyle(.red)
                }
            }
        } header: {
            Text("Permisos")
        } footer: {
            Text("Qué lee Pulso de Salud se cambia en Salud → tu perfil → Apps → Pulso.")
        }
    }

    @ViewBuilder private var notificationAction: some View {
        switch notifications {
        case .notDetermined:
            Button("Activar") {
                Task {
                    _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
                    await loadNotifications()
                }
            }
        case .none:
            ProgressView()
        default:
            Button("Ajustes") {
                if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
            }
        }
    }

    private func reload() async {
        await loadNotifications()
        await model.checkConnection()
    }

    private func loadNotifications() async {
        notifications = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    /// HealthKit hides read permissions; asking again shows the sheet only for new
    /// types, and otherwise Salud itself is where they change.
    private func askHealth() async {
        askingHealth = true
        defer { askingHealth = false }
        try? await HealthSync.requestAccess()
        if let url = URL(string: "x-apple-health://") { openURL(url) }
    }

    static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(short) (\(build))"
    }

    static func milliseconds(_ duration: Duration) -> String {
        "\(Int((duration / .milliseconds(1)).rounded())) ms"
    }

    static func describe(_ status: UNAuthorizationStatus?) -> String {
        switch status {
        case .authorized: "Activadas"
        case .provisional: "Silenciosas"
        case .ephemeral: "Temporales"
        case .denied: "Desactivadas"
        case .notDetermined: "Sin pedir todavía"
        default: "Consultando…"
        }
    }
}

/// A colored dot and a word: Conectada / Sin conexión / Comprobando.
struct ConnectionBadge: View {
    let reachability: PulsoModel.Reachability
    var checking = false

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 8, height: 8)
                .symbolEffect(.pulse, isActive: checking)
            Text(checking ? "Comprobando…" : label)
        }
        .foregroundStyle(.secondary)
        .animation(.snappy, value: reachability)
    }

    private var label: String {
        switch reachability {
        case .online: "Conectada"
        case .offline: "Sin conexión"
        case .unknown: "Sin comprobar"
        }
    }

    private var color: Color {
        switch reachability {
        case .online: .green
        case .offline: .orange
        case .unknown: .secondary
        }
    }
}
