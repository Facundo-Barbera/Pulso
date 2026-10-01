import SwiftUI

/// After "Terminar": the session's numbers, and its records celebrated.
struct SessionSummaryView: View {
    let summary: SessionSummary
    @Environment(\.dismiss) private var dismiss
    @State private var celebrate = false

    private var session: TrainingSession { summary.session }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 22) {
                    hero
                    HStack(spacing: 12) {
                        Tile(value: Duration.seconds(session.duration).formatted(.units(allowed: [.hours, .minutes], width: .abbreviated)), label: "Duración", systemImage: "clock")
                        Tile(value: "\(session.sets.count)", label: "Series", systemImage: "square.stack.3d.up")
                        Tile(value: "\(Int(session.volumeKg).formatted()) kg", label: "Volumen", systemImage: "scalemass")
                    }
                    if !summary.prs.isEmpty {
                        Card {
                            CardTitle(text: "Récords", systemImage: "trophy")
                            ForEach(summary.prs, id: \.self) { RecordRow(record: $0) }
                        }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                    status
                }
                .padding(Theme.padding)
                .animation(.snappy, value: summary.prs)
            }
            .navigationTitle(session.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Listo", systemImage: "checkmark") { dismiss() }
                        .buttonStyle(.glassProminent)
                        .tint(Theme.training)
                }
            }
        }
        .presentationDragIndicator(.visible)
        .sensoryFeedback(.success, trigger: summary.prs.count) { _, new in new > 0 }
        .onChange(of: summary.prs.count, initial: true) { _, count in
            if count > 0 { celebrate.toggle() }
        }
    }

    private var hero: some View {
        VStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(RadialGradient(colors: [Theme.training.opacity(0.45), .clear], center: .center, startRadius: 4, endRadius: 90))
                    .frame(width: 180, height: 180)
                Image(systemName: summary.prs.isEmpty ? "checkmark.seal.fill" : "trophy.fill")
                    .font(.system(size: 72))
                    .foregroundStyle(summary.prs.isEmpty ? AnyShapeStyle(Theme.training.gradient) : AnyShapeStyle(LinearGradient(colors: [.yellow, .orange], startPoint: .top, endPoint: .bottom)))
                    .symbolEffect(.bounce, value: celebrate)
                    .contentTransition(.symbolEffect(.replace))
            }
            Text(summary.prs.isEmpty ? "Sesión completada" : summary.prs.count == 1 ? "¡Nuevo récord!" : "¡\(summary.prs.count) récords nuevos!")
                .font(.title.bold())
                .fontDesign(.rounded)
                .contentTransition(.numericText())
            Text(session.start.formatted(.dateTime.weekday(.wide).day().month().hour().minute()))
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.top, 8)
    }

    @ViewBuilder private var status: some View {
        VStack(alignment: .leading, spacing: 8) {
            if summary.savedToHealth {
                Label("Guardado en Salud", systemImage: "heart.fill").foregroundStyle(.pink)
            }
            if summary.uploaded {
                Label("Guardado en tu Mac", systemImage: "desktopcomputer").foregroundStyle(.secondary)
            } else if !session.sets.isEmpty {
                Label("Se enviará a tu Mac cuando vuelva la conexión", systemImage: "arrow.triangle.2.circlepath").foregroundStyle(.secondary)
            }
        }
        .font(.footnote)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct Tile: View {
    let value: String
    let label: String
    let systemImage: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: systemImage).foregroundStyle(Theme.training)
            Text(value).font(.title3.bold()).fontDesign(.rounded).lineLimit(1).minimumScaleFactor(0.7)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
    }
}

private struct RecordRow: View {
    let record: TrainingRecord

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(record.exerciseName).font(.body.weight(.medium))
                Text(record.label).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(record.valueText).font(.headline).fontDesign(.rounded).foregroundStyle(.orange)
                if let previous = record.previous {
                    Text("antes \(record.kind == "reps" ? "\(Int(previous))" : "\(previous.formatted()) kg")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

#if DEBUG
#Preview("Resumen · 375 pt", traits: .fixedLayout(width: 375, height: 812)) {
    let start = Date.now.addingTimeInterval(-4_000).timeIntervalSince1970 * 1000
    let sets = (0..<14).map { SetLog(exerciseId: "press-banca", setIndex: $0, weightKg: 102.5, reps: 8, rpe: nil, doneAt: start + Double($0) * 200_000) }
    let session = TrainingSession(id: "s1", name: "Torso A · Fuerza", startedAt: start, endedAt: start + 3_960_000, sets: sets)
    let prs = [TrainingRecord(exerciseId: "press-banca", exerciseName: "Press de banca con barra y agarre cerrado", kind: "e1rm", value: 129.8, previous: 125.4)]
    SessionSummaryView(summary: SessionSummary(session: session, prs: prs, uploaded: true, savedToHealth: true))
}
#endif
