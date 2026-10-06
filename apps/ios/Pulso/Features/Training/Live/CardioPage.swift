import SwiftUI

/// A cardio block, full screen: one big ring with the time (the interval phase
/// counting down, else the time left or elapsed), start/pause and "Terminar",
/// then what the block asks for. Ending it asks for distance, level, heart rate
/// and kcal and logs a `CardioLog`.
struct CardioPage: View {
    let session: LiveSession
    let index: Int
    @State private var logging = false

    private var exercise: LiveExercise? {
        session.state.exercises.indices.contains(index) ? session.state.exercises[index] : nil
    }

    var body: some View {
        if let exercise {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    CardioHeader(exercise: exercise)
                    if let log = exercise.cardioLog {
                        CardioDone(log: log, cutShort: exercise.cutShort, amount: exercise.cutShortAmount) { logging = true }
                    } else {
                        TimelineView(.periodic(from: .now, by: 0.25)) { context in
                            CardioHero(
                                exercise: exercise,
                                elapsed: session.cardioElapsed(exercise, at: context.date),
                                running: session.cardioRunning(exercise),
                                zones: TrainingStore.shared.hrZones
                            )
                        }
                        controls(exercise)
                    }
                    if let target = exercise.cardio {
                        CardioTargetCard(target: target, modality: exercise.modality, zones: TrainingStore.shared.hrZones)
                    }
                    if let notes = exercise.notes, !notes.isEmpty {
                        Label(notes, systemImage: "text.quote")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Button {
                        withAnimation(.snappy) { session.setSkipped(index, !exercise.skipped) }
                    } label: {
                        Label(exercise.skipped ? "Retomar" : "Saltar bloque", systemImage: exercise.skipped ? "arrow.uturn.backward" : "forward")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.glass)
                    .opacity(exercise.cardioLog == nil ? 1 : 0)
                    .disabled(exercise.cardioLog != nil)
                    NextCard(session: session, after: index)
                }
                .padding(.horizontal, Theme.padding)
                .padding(.top, 4)
                .padding(.bottom, 24)
            }
            .sheet(isPresented: $logging) {
                CardioLogSheet(exercise: exercise, elapsed: session.cardioElapsed(exercise)) { log in
                    withAnimation(.snappy) { session.finishCardio(index, log: log) }
                }
            }
            .sensoryFeedback(.success, trigger: exercise.cardioLog != nil) { _, done in done }
        }
    }

    private func controls(_ exercise: LiveExercise) -> some View {
        let running = session.cardioRunning(exercise)
        let started = session.cardioElapsed(exercise) > 0
        return AdaptiveStack(spacing: 10) {
            Button {
                withAnimation(.snappy) { running ? session.pauseCardio() : session.startCardio(index) }
            } label: {
                Label(running ? "Pausar" : started ? "Seguir" : "Empezar", systemImage: running ? "pause.fill" : "play.fill")
                    .font(.title3.bold())
                    .contentTransition(.symbolEffect(.replace))
                    .frame(maxWidth: .infinity, minHeight: 56)
            }
            .buttonStyle(.glassProminent)
            .tint(Theme.training)
            .sensoryFeedback(.impact(weight: .medium), trigger: running)

            Button {
                if running { session.pauseCardio() }
                logging = true
            } label: {
                Label("Terminar", systemImage: "flag.checkered")
                    .font(.title3.bold())
                    .frame(maxWidth: .infinity, minHeight: 56)
            }
            .buttonStyle(.glass)
        }
    }
}

// MARK: - Pieces

private struct CardioHeader: View {
    let exercise: LiveExercise

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: CardioCue.symbol(exercise.modality))
                .font(.system(size: 30))
                .foregroundStyle(Theme.energy.gradient)
                .frame(width: 60, height: 60)
                .background(Theme.energy.opacity(0.14), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(exercise.name)
                    .font(.title2.bold())
                    .fontDesign(.rounded)
                    .fixedSize(horizontal: false, vertical: true)
                Text([CardioCue.label(exercise.modality), exercise.cardio?.summary].compactMap(\.self).joined(separator: " · "))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if exercise.skipped { GlassChip("Saltado", systemImage: "forward") }
        }
    }
}

/// The hero. Intervals: the phase ("Rápido") and its countdown, "Ronda 3 de 8",
/// the ring draining per phase. A timed block: the time left. Otherwise elapsed.
private struct CardioHero: View {
    let exercise: LiveExercise
    let elapsed: TimeInterval
    let running: Bool
    let zones: [HrZoneRange]?

    private var phase: CardioPhase? { exercise.cardio?.intervals.flatMap { CardioPhase.at(elapsed, in: $0) } }
    private var total: TimeInterval? { exercise.cardio?.totalSeconds }

    private var tint: Color {
        guard let phase else { return Theme.energy }
        return phase.work ? Theme.energy : Theme.body
    }

    private var fraction: Double {
        if let phase { return min(1, (elapsed - phase.start) / max(1, phase.length)) }
        if let total, total > 0 { return min(1, elapsed / total) }
        return elapsed.truncatingRemainder(dividingBy: 60) / 60
    }

    private var big: String {
        if let phase { return CardioCue.clock((phase.end - elapsed).rounded(.up)) }
        if let total, total > elapsed { return CardioCue.clock((total - elapsed).rounded(.up)) }
        return CardioCue.clock(elapsed)
    }

    private var title: String {
        if let phase { return phase.label }
        if let total, total > elapsed { return elapsed > 0 ? "Quedan" : "Listo para empezar" }
        if total != nil { return "Tiempo cumplido" }
        return "Tiempo"
    }

    private var caption: String? {
        if let phase { return "Ronda \(phase.round) de \(phase.rounds)" }
        if total != nil, elapsed > 0 { return "\(CardioCue.clock(elapsed)) hechos" }
        return CardioCue.zone(exercise.cardio?.zone, zones: zones)
    }

    var body: some View {
        ZStack {
            Circle().stroke(tint.opacity(0.16), lineWidth: 16)
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(tint.gradient, style: StrokeStyle(lineWidth: 16, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 0.25), value: fraction)
            VStack(spacing: 4) {
                Text(title)
                    .font(.title2.bold())
                    .foregroundStyle(tint)
                    .contentTransition(.opacity)
                Text(big)
                    .font(.system(size: 64, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .contentTransition(.numericText(countsDown: phase != nil || total != nil))
                    .animation(.snappy, value: big)
                if let caption {
                    Text(caption)
                        .font(.headline)
                        .fontDesign(.rounded)
                        .foregroundStyle(.secondary)
                        .contentTransition(.numericText())
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .padding(28)
        }
        .frame(maxWidth: 280)
        .aspectRatio(1, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .opacity(running || elapsed == 0 ? 1 : 0.7)
        .animation(.snappy, value: phase?.index)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
    }
}

/// What the block asks for, one row per field it sets, and the intervals as a strip.
private struct CardioTargetCard: View {
    let target: CardioTarget
    let modality: String?
    let zones: [HrZoneRange]?

    var body: some View {
        Card {
            CardTitle(text: "Objetivo", systemImage: "target")
            if let minutes = target.durationMinutes { row("Duración", "\(minutes.formatted()) min", "clock") }
            if let km = target.distanceKm { row("Distancia", "\(km.formatted()) km", "point.topleft.down.to.point.bottomright.curvepath") }
            if let speed = target.speedKmh { row("Velocidad", "\(speed.formatted()) km/h", "speedometer") }
            if let pace = target.paceMinPerKm { row("Ritmo", "\(CardioCue.clock(pace * 60)) /km", "figure.run") }
            if let incline = target.inclinePercent { row("Inclinación", "\(incline.formatted()) %", "arrow.up.right") }
            if let level = target.level { row("Nivel", level.formatted(), "dial.medium") }
            if let zone = CardioCue.zone(target.zone, zones: zones) { row("Zona", zone, "heart.fill") }
            if let intervals = target.intervals {
                row("Intervalos", "\(intervals.rounds) rondas · \(CardioCue.clock(Double(intervals.workSeconds))) y \(CardioCue.clock(Double(intervals.restSeconds))) de pausa", "repeat")
                IntervalStrip(intervals: intervals)
            }
        }
    }

    private func row(_ title: String, _ value: String, _ symbol: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).foregroundStyle(Theme.energy).frame(width: 22)
            Text(title).foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Text(value).fontWeight(.semibold).fontDesign(.rounded).multilineTextAlignment(.trailing)
        }
        .font(.subheadline)
        .accessibilityElement(children: .combine)
    }
}

/// Work and recovery parts to scale.
private struct IntervalStrip: View {
    let intervals: CardioIntervals

    var body: some View {
        let phases = CardioPhase.phases(intervals)
        let total = max(1, phases.last?.end ?? 1)
        GeometryReader { proxy in
            let gaps = CGFloat(max(0, phases.count - 1)) * 2
            HStack(spacing: 2) {
                ForEach(phases, id: \.index) { phase in
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(phase.work ? Theme.energy : Theme.body.opacity(0.5))
                        .frame(width: max(1, (proxy.size.width - gaps) * phase.length / total), height: phase.work ? 14 : 8)
                }
            }
            .frame(maxHeight: .infinity)
        }
        .frame(height: 16)
        .accessibilityHidden(true)
    }
}

/// After logging: what was done, editable.
private struct CardioDone: View {
    let log: CardioLog
    /// Ended early by the Coach: "Terminado antes · 12 de 20 min" and why.
    var cutShort: CutShort? = nil
    var amount: String? = nil
    let edit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Bloque hecho", systemImage: "checkmark.seal.fill")
                .font(.headline)
                .foregroundStyle(Theme.training)
            if let cutShort {
                VStack(alignment: .leading, spacing: 2) {
                    Label(["Terminado antes", amount].compactMap(\.self).joined(separator: " · "), systemImage: "stopwatch")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.energy)
                    if let reason = cutShort.reason, !reason.isEmpty {
                        Text(reason).font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            HStack(spacing: 10) {
                StatTile(title: "Tiempo", value: CardioCue.clock(log.durationSeconds), systemImage: "clock", tint: Theme.energy)
                if let km = log.distanceKm { StatTile(title: "Distancia", value: km.formatted(), unit: "km", systemImage: "point.topleft.down.to.point.bottomright.curvepath", tint: Theme.energy) }
            }
            HStack(spacing: 10) {
                if let hr = log.avgHr { StatTile(title: "FC media", value: Int(hr).formatted(), unit: "ppm", systemImage: "heart.fill", tint: Theme.heart) }
                if let kcal = log.kcal { StatTile(title: "Energía", value: Int(kcal).formatted(), unit: "kcal", systemImage: "flame.fill", tint: Theme.energy) }
            }
            Button("Editar registro", systemImage: "pencil", action: edit)
                .buttonStyle(.glass)
        }
    }
}

// MARK: - Log sheet

/// Ending a block: the time (from the stopwatch) and what the machine showed.
struct CardioLogSheet: View {
    let exercise: LiveExercise
    let elapsed: TimeInterval
    let save: (CardioLog) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var minutes = ""
    @State private var distance = ""
    @State private var level = ""
    @State private var incline = ""
    @State private var avgHr = ""
    @State private var kcal = ""

    private var showsIncline: Bool { ["treadmill", "walk"].contains(exercise.modality ?? "") || exercise.cardio?.inclinePercent != nil }
    private var showsLevel: Bool { ["elliptical", "bike", "stairs", "rower"].contains(exercise.modality ?? "") || exercise.cardio?.level != nil }
    private var showsDistance: Bool { !["stairs", "jump_rope", "hiit"].contains(exercise.modality ?? "") }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    field("Duración", text: $minutes, unit: "min", symbol: "clock")
                    if showsDistance { field("Distancia", text: $distance, unit: "km", symbol: "point.topleft.down.to.point.bottomright.curvepath") }
                    if showsLevel { field("Nivel", text: $level, unit: "", symbol: "dial.medium") }
                    if showsIncline { field("Inclinación", text: $incline, unit: "%", symbol: "arrow.up.right") }
                } footer: {
                    Text("Lo que marcó la máquina. Solo la duración es necesaria.")
                }
                Section {
                    field("FC media", text: $avgHr, unit: "ppm", symbol: "heart.fill")
                    field("Energía", text: $kcal, unit: "kcal", symbol: "flame.fill")
                }
            }
            .navigationTitle(exercise.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar", systemImage: "xmark") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar", systemImage: "checkmark") {
                        save(log)
                        dismiss()
                    }
                    .buttonStyle(.glassProminent)
                    .tint(Theme.training)
                    .disabled((NumberEntry.parse(minutes) ?? 0) <= 0)
                }
            }
            .onAppear(perform: prefill)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func field(_ title: String, text: Binding<String>, unit: String, symbol: String) -> some View {
        HStack(spacing: 10) {
            Label(title, systemImage: symbol)
            Spacer(minLength: 8)
            TextField("—", text: text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .font(.body.weight(.semibold))
                .fontDesign(.rounded)
                .frame(maxWidth: 110)
            if !unit.isEmpty { Text(unit).foregroundStyle(.secondary) }
        }
        .frame(minHeight: 44)
    }

    private func prefill() {
        let previous = exercise.cardioLog
        let seconds = previous?.durationSeconds ?? (elapsed > 0 ? elapsed : exercise.cardio?.totalSeconds ?? 0)
        minutes = seconds > 0 ? ((seconds / 60 * 10).rounded() / 10).formatted() : ""
        distance = (previous?.distanceKm).map { $0.formatted() } ?? ""
        level = (previous?.level ?? exercise.cardio?.level).map { $0.formatted() } ?? ""
        incline = (previous?.inclinePercent ?? exercise.cardio?.inclinePercent).map { $0.formatted() } ?? ""
        avgHr = (previous?.avgHr).map { Int($0).formatted() } ?? ""
        kcal = (previous?.kcal).map { Int($0).formatted() } ?? ""
    }

    private var log: CardioLog {
        CardioLog(
            exerciseId: exercise.exerciseId,
            durationSeconds: ((NumberEntry.parse(minutes) ?? 0) * 60).rounded(),
            distanceKm: showsDistance ? NumberEntry.parse(distance) : nil,
            level: showsLevel ? NumberEntry.parse(level) : nil,
            inclinePercent: showsIncline ? NumberEntry.parse(incline) : nil,
            avgHr: NumberEntry.parse(avgHr),
            kcal: NumberEntry.parse(kcal),
            doneAt: exercise.cardioLog?.doneAt ?? LiveSessionState.ms(.now)
        )
    }
}

#if DEBUG
#Preview("Cardio con intervalos · 375 pt", traits: .fixedLayout(width: 375, height: 812)) {
    let state = { var s = LiveSessionState.preview; s.setFocus(2); return s }()
    LiveSessionView(session: LiveSession(state: state, clock: CardioClock(exerciseId: "pe3", runningSince: .now.addingTimeInterval(-158))), store: .shared)
}

#Preview("Cardio · 440 pt, claro", traits: .fixedLayout(width: 440, height: 956)) {
    let state = { var s = LiveSessionState.preview; s.setFocus(2); return s }()
    LiveSessionView(session: LiveSession(state: state, clock: CardioClock(exerciseId: "pe3", accumulated: 70)), store: .shared)
        .preferredColorScheme(.light)
}

#Preview("Cardio · 375 pt, XXL", traits: .fixedLayout(width: 375, height: 812)) {
    let state = { var s = LiveSessionState.preview; s.setFocus(3); return s }()
    LiveSessionView(session: LiveSession(state: state), store: .shared)
        .dynamicTypeSize(.xxLarge)
}

#Preview("Registrar cardio") {
    CardioLogSheet(exercise: LiveSessionState.preview.exercises[2], elapsed: 1_000) { _ in }
}
#endif
