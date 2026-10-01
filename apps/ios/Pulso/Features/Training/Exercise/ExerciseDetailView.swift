import SwiftUI

/// One exercise, in two segments. Guía: the looping demonstration as the hero,
/// the muscles it works, how to do it, technique videos and the person's notes.
/// Rendimiento: records and the history chart. Opened from a live session it
/// starts with today's targets and the machine's unit.
struct ExerciseDetailView: View {
    let exerciseId: String
    /// Shown as the title until the detail arrives.
    var name: String?
    /// The exercise in the live session, for the "Hoy" card.
    var today: LiveExercise? = nil
    @State private var catalog = ExerciseCatalog.shared
    @State private var segment = Segment.guide
    @State private var failed = false

    enum Segment: String, CaseIterable, Identifiable {
        case guide = "Guía"
        case performance = "Rendimiento"
        var id: Self { self }
    }

    private var detail: ExerciseDetail? { catalog.details[exerciseId] }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let today { TodayCard(exercise: today) }
                Picker("Sección", selection: $segment.animation(.snappy)) {
                    ForEach(Segment.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .sensoryFeedback(.selection, trigger: segment)

                switch segment {
                case .guide:
                    if let detail {
                        ExerciseGuide(detail: detail)
                    } else if failed {
                        EmptyStateView(systemImage: "wifi.exclamationmark", title: "Sin conexión", message: "No se pudo cargar la guía de este ejercicio.", tint: Theme.training, actionTitle: "Reintentar") {
                            Task { await load() }
                        }
                    } else {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, 80)
                    }
                case .performance:
                    ExercisePerformanceSection(exerciseId: exerciseId)
                }
            }
            .padding(.horizontal, Theme.padding)
            .padding(.bottom, 32)
        }
        .navigationTitle(detail?.name ?? name ?? "Ejercicio")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: exerciseId) { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        failed = false
        _ = catalog.detail(exerciseId) // the disk copy first: the gym may have no signal
        let fresh = await catalog.refresh(exerciseId)
        failed = fresh == nil
    }
}

/// Today's prescription in full words, the effort and rest advice, the engine's
/// reason for the load, the notes and the machine's unit.
private struct TodayCard: View {
    let exercise: LiveExercise

    private var notes: String? { exercise.notes.flatMap { $0.isEmpty ? nil : $0 } }

    var body: some View {
        Card {
            CardTitle(text: "Hoy", systemImage: "target")
            Text(exercise.prescription)
                .font(.title3.bold())
                .fontDesign(.rounded)
                .foregroundStyle(Theme.training)
            if let guidance = exercise.guidance {
                Text(guidance).font(.subheadline)
            }
            if let hint = exercise.hint, !hint.isEmpty {
                Label(hint, systemImage: "chart.line.uptrend.xyaxis")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if let notes {
                Label(notes, systemImage: "text.quote")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if Equipment.needsLoad(exercise.equipment) {
                Divider()
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Unidad de esta máquina").font(.subheadline.weight(.medium))
                        Text("Se queda para las próximas sesiones.").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    UnitPicker(exerciseId: exercise.exerciseId)
                }
            }
        }
    }
}

private struct ExerciseGuide: View {
    let detail: ExerciseDetail
    @State private var playing: ExerciseVideo?

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            hero
            Card {
                CardTitle(text: "Músculos", systemImage: "figure.arms.open")
                MuscleMapView(primary: detail.primaryMuscles, secondary: detail.secondaryMuscles)
                    .frame(maxHeight: 280)
                    .padding(.vertical, 4)
                if !detail.primaryMuscles.isEmpty || !detail.secondaryMuscles.isEmpty {
                    muscleNames
                }
            }
            if !detail.instructions.isEmpty { instructions }
            if !detail.tips.isEmpty { tips }
            if !detail.videos.isEmpty { videos }
            NotesCard(exerciseId: detail.id, initial: detail.notes ?? "")
        }
        .sheet(item: $playing) { VideoSheet(video: $0) }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 10) {
            ExerciseMediaView(path: detail.media.animation ?? detail.media.thumbnail, cornerRadius: 28)
                .frame(maxWidth: 340)
                .frame(maxWidth: .infinity)
                .shadow(color: .black.opacity(0.12), radius: 16, y: 8)
            HStack(spacing: 8) {
                GlassChip(Equipment.label(detail.equipment), systemImage: Equipment.symbol(detail.equipment))
                GlassChip(detail.kind == "compound" ? "Multiarticular" : "Aislamiento")
                Spacer(minLength: 0)
            }
            if let attribution = detail.media.attribution {
                Text(attribution).font(.caption2).foregroundStyle(.tertiary)
            }
        }
    }

    private var muscleNames: some View {
        VStack(alignment: .leading, spacing: 4) {
            if !detail.primaryMuscles.isEmpty {
                Text(detail.primaryMuscles.map(\.label).formatted(.list(type: .and))).font(.subheadline.weight(.semibold))
            }
            if !detail.secondaryMuscles.isEmpty {
                Text("También: " + detail.secondaryMuscles.map(\.label).formatted(.list(type: .and)))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var instructions: some View {
        Card {
            CardTitle(text: "Instrucciones", systemImage: "list.number")
            ForEach(Array(detail.instructions.enumerated()), id: \.offset) { i, step in
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text("\(i + 1)")
                        .font(.subheadline.bold())
                        .fontDesign(.rounded)
                        .foregroundStyle(Theme.training)
                        .frame(width: 26, height: 26)
                        .background(Theme.training.opacity(0.15), in: Circle())
                        .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 8 }
                    Text(step).font(.body).fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 2)
            }
        }
    }

    private var tips: some View {
        VStack(alignment: .leading, spacing: 10) {
            CardTitle(text: "Claves", systemImage: "lightbulb")
            FlowLayout(spacing: 8) {
                ForEach(detail.tips, id: \.self) { tip in
                    Text(tip)
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .glassEffect(.regular.tint(Theme.training.opacity(0.12)), in: .capsule)
                }
            }
        }
    }

    private var videos: some View {
        Card {
            CardTitle(text: "Ver técnica en video", systemImage: "play.rectangle")
            ForEach(detail.videos) { video in
                Button { playing = video } label: { VideoRow(video: video) }
                    .buttonStyle(.plain)
            }
        }
    }
}

private struct VideoRow: View {
    let video: ExerciseVideo

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: URL(string: "https://i.ytimg.com/vi/\(video.youtubeId)/mqdefault.jpg")) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Color.secondary.opacity(0.15)
            }
            .frame(width: 112, height: 63)
            .overlay {
                Image(systemName: "play.fill")
                    .font(.footnote)
                    .foregroundStyle(.white)
                    .padding(8)
                    .background(.black.opacity(0.55), in: Circle())
            }
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(video.title).font(.subheadline.weight(.semibold)).lineLimit(2).foregroundStyle(.primary)
                Text("\(video.channel) · \(video.lang.uppercased())").font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .accessibilityLabel("Ver video: \(video.title), de \(video.channel)")
    }
}

/// The person's own notes on the exercise (seat height, grip…). Saves a second
/// after typing stops, and right away when the screen closes.
private struct NotesCard: View {
    let exerciseId: String
    @State private var text: String
    @State private var saved: String
    @State private var pending: Task<Void, Never>?
    @State private var justSaved = false

    init(exerciseId: String, initial: String) {
        self.exerciseId = exerciseId
        _text = State(initialValue: initial)
        _saved = State(initialValue: initial)
    }

    var body: some View {
        Card {
            HStack {
                CardTitle(text: "Mis notas", systemImage: "note.text")
                Spacer()
                if justSaved {
                    Label("Guardado", systemImage: "checkmark.circle.fill")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Theme.training)
                        .transition(.opacity.combined(with: .scale))
                }
            }
            TextField("Asiento, agarre, sensaciones…", text: $text, axis: .vertical)
                .lineLimit(2...8)
        }
        .animation(.snappy, value: justSaved)
        .onChange(of: text) { schedule() }
        .onDisappear {
            pending?.cancel()
            if text != saved { save(text) }
        }
    }

    private func schedule() {
        pending?.cancel()
        justSaved = false
        pending = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            save(text)
        }
    }

    private func save(_ value: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let notes = trimmed.isEmpty ? nil : trimmed
        saved = value
        ExerciseCatalog.shared.setNotes(notes, for: exerciseId)
        Task {
            guard let api = PulsoModel.shared.api else { return }
            do {
                try await api.saveExerciseNotes(exerciseId, notes: notes)
                justSaved = true
            } catch {
                PulsoModel.shared.handle(error)
            }
        }
    }
}

/// Lays children out left to right, wrapping to a new line when one doesn't fit.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = rows(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row { var indices: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func rows(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows = [Row()]
        for (index, subview) in subviews.enumerated() {
            let size = subview.sizeThatFits(.unspecified)
            if !rows[rows.count - 1].indices.isEmpty, rows[rows.count - 1].width + spacing + size.width > width {
                rows.append(Row())
            }
            var row = rows[rows.count - 1]
            row.width += (row.indices.isEmpty ? 0 : spacing) + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
            rows[rows.count - 1] = row
        }
        return rows
    }
}

#Preview("Guía · 375 pt", traits: .fixedLayout(width: 375, height: 1600)) {
    NavigationStack {
        ScrollView { ExerciseGuide(detail: .preview).padding() }
            .navigationTitle("Press de banca")
    }
}
