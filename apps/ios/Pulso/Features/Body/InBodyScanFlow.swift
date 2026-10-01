import SwiftUI
import VisionKit

/// Camera → QR → engine parse → confirmation form. Unreadable QRs explain why and offer manual entry.
struct InBodyScanFlow: View {
    let store: BodyStore
    @State private var phase: Phase = .scanning
    @Environment(\.dismiss) private var dismiss

    enum Phase: Equatable {
        case scanning
        case reading
        case parsed(BodyScan)
        case failed(String)
        case manual
    }

    var body: some View {
        NavigationStack {
            switch phase {
            case .parsed(let scan):
                BodyScanForm(store: store, scan: scan)
            case .manual:
                BodyScanForm(store: store, scan: nil)
            default:
                scanner
            }
        }
        .sensoryFeedback(.success, trigger: phase) { _, new in if case .parsed = new { true } else { false } }
        .sensoryFeedback(.error, trigger: phase) { _, new in if case .failed = new { true } else { false } }
    }

    private var scanner: some View {
        ZStack(alignment: .bottom) {
            if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                QRScanner(paused: phase != .scanning) { payload in read(payload) }
                    .ignoresSafeArea()
                Viewfinder().allowsHitTesting(false)
            } else {
                ContentUnavailableView("Cámara no disponible", systemImage: "camera.badge.ellipsis",
                                       description: Text("Pulso necesita la cámara para leer el QR. Revisa el permiso en Ajustes."))
            }
            status.padding(20)
        }
        .navigationTitle("QR de InBody")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cerrar", systemImage: "xmark", role: .cancel) { dismiss() }
            }
        }
    }

    @ViewBuilder private var status: some View {
        VStack(spacing: 12) {
            switch phase {
            case .reading:
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Leyendo resultado…")
                }
            case .failed(let message):
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .symbolRenderingMode(.multicolor)
                AdaptiveStack {
                    Button("Reintentar", systemImage: "arrow.clockwise") { phase = .scanning }
                        .buttonStyle(.glass)
                    Button("Cargar a mano", systemImage: "square.and.pencil") { phase = .manual }
                        .buttonStyle(.glassProminent)
                        .tint(Theme.body)
                }
                .lineLimit(1)
            default:
                Label("Apunta al QR de tu hoja o pantalla de InBody", systemImage: "qrcode.viewfinder")
            }
        }
        .font(.subheadline.weight(.medium))
        .multilineTextAlignment(.center)
        .padding(16)
        .frame(maxWidth: .infinity)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
        .animation(.snappy, value: phase)
    }

    private func read(_ payload: String) {
        guard phase == .scanning else { return }
        phase = .reading
        Task {
            do {
                phase = .parsed(try await store.parse(qr: payload))
            } catch {
                phase = .failed(error.localizedDescription)
            }
        }
    }
}

/// A rounded square guide over the camera.
private struct Viewfinder: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 28, style: .continuous)
            .strokeBorder(.white.opacity(0.85), style: StrokeStyle(lineWidth: 3, dash: [28, 14]))
            .frame(width: 250, height: 250)
            .shadow(color: .black.opacity(0.3), radius: 8)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// VisionKit's live scanner, QR codes only. Calls `found` with each new payload while not `paused`.
private struct QRScanner: UIViewControllerRepresentable {
    let paused: Bool
    let found: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .accurate,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        context.coordinator.found = found
        context.coordinator.paused = paused
        if !scanner.isScanning { try? scanner.startScanning() }
    }

    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        scanner.stopScanning()
    }

    func makeCoordinator() -> Coordinator { Coordinator(found: found) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        var found: (String) -> Void
        var paused = false

        init(found: @escaping (String) -> Void) { self.found = found }

        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !paused else { return }
            for case .barcode(let code) in items {
                if let payload = code.payloadStringValue, !payload.isEmpty {
                    found(payload)
                    return
                }
            }
        }
    }
}
