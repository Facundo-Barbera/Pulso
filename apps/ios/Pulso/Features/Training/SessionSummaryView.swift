import SwiftUI

/// After "Terminar": the session's numbers, and its records celebrated.
struct SessionSummaryView: View {
    let summary: SessionSummary
    @Environment(\.dismiss) private var dismiss
    @State private var celebrate = false

    private var session: TrainingSession { summary.session }
    private var cardio: [CardioLog] { session.cardio ?? [] }
    private var cardioMinutes: Double { session.cardioMinutes ?? cardio.reduce(0) { $0 + $1.durationSeconds } / 60 }

    /// Sum of a cardio field over the blocks that logged it; nil when none did.
    private func total(_ field: KeyPath<CardioLog, Double?>) -> Double? {
        let values = cardio.compactMap { $0[keyPath: field] }
        return values.isEmpty ? nil : values.reduce(0, +)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 22) {
                    hero
                    HStack(spacing: 12) {
                        Tile(value: Duration.seconds(session.duration).formatted(.units(allowed: [.hours, .minutes], width: .abbreviated)), label: "Duración", systemImage: "clock")
                        if !session.sets.isEmpty || cardio.isEmpty {
                            Tile(value: "\(session.sets.count)", label: "Series", systemImage: "square.stack.3d.up")
                            Tile(value: TrainingStore.shared.defaultUnit.formatTotal(session.volumeKg), label: "Volumen", systemImage: "scalemass")
                        }
                    }
                    if !cardio.isEmpty {
                        HStack(spacing: 12) {
                            Tile(value: "\(Int(cardioMinutes.rounded())) min", label: cardio.count == 1 ? "Cardio" : "Cardio · \(cardio.count) bloques", systemImage: "heart")
                            if let km = total(\.distanceKm) {
                                Tile(value: "\(km.formatted(.number.precision(.fractionLength(0...2)))) km", label: "Distancia", systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                            }
                            if let kcal = total(\.kcal) {
                                Tile(value: "\(Int(kcal)) kcal", label: "Energía", systemImage: "flame")
                            }
                        }
                    }
                    PostWorkoutDoseCard(sessionStart: session.start)
                    ForEach(summary.cutShort, id: \.self) { line in
                        Label {
                            Text("Terminado antes: \(line)")
                        } icon: {
                            Image(systemName: "stopwatch").foregroundStyle(Theme.energy)
                        }
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if !summary.skipped.isEmpty {
                        Label {
                            Text("Saltados: \(TrainingText.list(summary.skipped))")
                        } icon: {
                            Image(systemName: "forward.fill").foregroundStyle(.orange)
                        }
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                        .background(.background.secondary, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
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
        VStack(alignment: .leading, spacing: 10) {
            if summary.uploadFailed {
                UnsavedBanner()
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
            }
            if summary.savedToHealth {
                Label("Guardado en Salud", systemImage: "heart.fill").foregroundStyle(.pink)
            }
            if summary.uploaded {
                Label("Guardado en tu Mac", systemImage: "desktopcomputer").foregroundStyle(.secondary)
            } else if !summary.uploadFailed && (!session.sets.isEmpty || !cardio.isEmpty) {
                Label {
                    Text("Guardando en tu Mac…")
                } icon: {
                    ProgressView().controlSize(.mini)
                }
                .foregroundStyle(.secondary)
            }
        }
        .font(.footnote)
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(.snappy, value: summary.uploadFailed)
        .animation(.snappy, value: summary.uploaded)
    }
}

/// "No se pudo guardar en la Mac · Reintentar": the session waits on this phone and goes on its own later too.
private struct UnsavedBanner: View {
    @State private var retrying = false

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "exclamationmark.icloud.fill")
                .font(.title3)
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text("No se pudo guardar en la Mac").font(.subheadline.weight(.semibold))
                Text("Sigue guardada en este iPhone y se enviará sola.").font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                retrying = true
                Task {
                    await TrainingStore.shared.retryUpload()
                    retrying = false
                }
            } label: {
                if retrying { ProgressView() } else { Text("Reintentar") }
            }
            .font(.subheadline.weight(.semibold))
            .buttonStyle(.glassProminent)
            .tint(.orange)
            .disabled(retrying)
        }
        .padding(14)
        .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
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

    private var unit: WeightUnit { TrainingStore.shared.unit(for: record.exerciseId) }

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(record.exerciseName).font(.body.weight(.medium))
                Text(record.label).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(record.valueText(unit)).font(.headline).fontDesign(.rounded).foregroundStyle(.orange)
                if let previous = record.previousText(unit) {
                    Text("antes \(previous)")
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

#Preview("Resumen con cardio · 375 pt, XXL", traits: .fixedLayout(width: 375, height: 812)) {
    let start = Date.now.addingTimeInterval(-4_000).timeIntervalSince1970 * 1000
    let sets = (0..<8).map { SetLog(exerciseId: "press-banca", setIndex: $0, weightKg: 80, reps: 8, rpe: nil, doneAt: start + Double($0) * 200_000) }
    let cardio = [CardioLog(exerciseId: "cinta", durationSeconds: 960, distanceKm: 2.6, avgHr: 152, kcal: 190, doneAt: start + 3_900_000)]
    let session = TrainingSession(id: "s2", name: "Torso A", startedAt: start, endedAt: start + 3_960_000, sets: sets, cardio: cardio)
    SessionSummaryView(summary: SessionSummary(session: session))
        .dynamicTypeSize(.xxLarge)
}
#endif
