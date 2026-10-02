import SwiftUI
import UniformTypeIdentifiers

/// Cuerpo: latest scan as the hero, trends with projection and goals, composition, InBody-style
/// segment, muscle-fat and obesity analyses, the evolution across scans, and history.
struct BodyView: View {
    let model: PulsoModel
    @State private var store = BodyStore()
    @State private var sheet: BodySheet?
    @State private var importing = false
    @State private var metric: BodyMetric = .percentBodyFat

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if let latest = store.latest {
                    BodyHero(scan: latest, previous: store.previous)
                    BodyTrendCard(store: store, metric: $metric) { sheet = .goal(metric) }
                    CompositionCard(scan: latest)
                    if let analysis = store.analysis {
                        if let segments = analysis.segments { SegmentFigureCard(segments: segments) }
                        MuscleFatCard(analysis: analysis)
                        if !analysis.obesity.isEmpty { ObesityCard(gauges: analysis.obesity) }
                    }
                    BodyEvolutionCard(scans: store.scans)
                    BodyHistoryCard(scans: store.scans) { scan in Task { await store.delete(scan) } }
                } else if store.loaded {
                    BodyEmptyState(scan: { sheet = .scanner }, manual: { sheet = .entry(nil) }, importCSV: { importing = true })
                } else {
                    ProgressView().padding(.top, 120)
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 32)
            .animation(.snappy, value: store.scans)
        }
        .background(alignment: .top) {
            LinearGradient(colors: [Theme.body.opacity(0.22), .clear], startPoint: .top, endPoint: .center)
                .ignoresSafeArea()
        }
        .navigationTitle("Cuerpo")
        .toolbar { addMenu }
        .refreshable { await store.refresh() }
        .task {
            await store.refresh()
            await store.syncHealth(quiet: true)
        }
        .sheet(item: $sheet) { sheet in
            switch sheet {
            case .scanner: InBodyScanFlow(store: store)
            case .entry(let scan): NavigationStack { BodyScanForm(store: store, scan: scan) }
            case .goal(let metric): BodyGoalSheet(store: store, metric: metric)
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.commaSeparatedText, .plainText, .text]) { result in
            if case .success(let url) = result { Task { await store.importCSV(from: url) } }
        }
        .overlay(alignment: .bottom) { notice }
        .sensoryFeedback(.success, trigger: store.notice) { _, new in new != nil }
    }

    private var addMenu: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Button("Escanear QR de InBody", systemImage: "qrcode.viewfinder") { sheet = .scanner }
                Button("Cargar a mano", systemImage: "square.and.pencil") { sheet = .entry(nil) }
                Button("Importar CSV de InBody", systemImage: "doc.badge.plus") { importing = true }
                Divider()
                Button("Sincronizar con Salud", systemImage: "heart.text.square") { Task { await store.syncHealth() } }
            } label: {
                Image(systemName: store.busy ? "ellipsis" : "plus")
                    .symbolEffect(.variableColor.iterative, isActive: store.busy)
            }
        }
    }

    @ViewBuilder private var notice: some View {
        if let text = store.notice {
            Label(text, systemImage: "checkmark.circle.fill")
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .glassEffect(.regular.tint(Theme.body.opacity(0.3)), in: .capsule)
                .padding(.bottom, 12)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: text) {
                    try? await Task.sleep(for: .seconds(2.5))
                    withAnimation(.snappy) { store.notice = nil }
                }
        }
    }
}

enum BodySheet: Identifiable {
    case scanner
    case entry(BodyScan?)
    case goal(BodyMetric)

    var id: String {
        switch self {
        case .scanner: "scanner"
        case .entry: "entry"
        case .goal(let metric): "goal-\(metric.rawValue)"
        }
    }
}

/// No scans yet: what Cuerpo is for and the three ways to start.
private struct BodyEmptyState: View {
    let scan: () -> Void
    let manual: () -> Void
    let importCSV: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "figure.arms.open")
                .font(.system(size: 64, weight: .light))
                .foregroundStyle(Theme.body.gradient)
                .symbolEffect(.breathe)
            VStack(spacing: 6) {
                Text("Tu composición corporal").font(.title2.bold()).fontDesign(.rounded)
                Text("Escanea el QR de tu InBody para ver músculo, grasa y hacia dónde vas.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: scan) {
                Label("Escanear QR de InBody", systemImage: "qrcode.viewfinder").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .tint(Theme.body)
            AdaptiveStack {
                Button("Cargar a mano", systemImage: "square.and.pencil", action: manual)
                Button("Importar CSV", systemImage: "doc.badge.plus", action: importCSV)
            }
            .buttonStyle(.glass)
            .lineLimit(1)
        }
        .padding(.top, 72)
        .padding(.horizontal, 12)
    }
}
