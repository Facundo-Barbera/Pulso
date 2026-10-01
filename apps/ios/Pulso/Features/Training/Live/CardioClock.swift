import Foundation

/// The stopwatch of the cardio block on screen. It is this phone's, not part of
/// the shared session, so it lives in its own file beside it.
struct CardioClock: Codable, Hashable {
    /// The `LiveExercise.id` it times.
    var exerciseId: String
    var runningSince: Date?
    var accumulated: TimeInterval = 0

    var running: Bool { runningSince != nil }

    func elapsed(at now: Date = .now) -> TimeInterval {
        accumulated + (runningSince.map { max(0, now.timeIntervalSince($0)) } ?? 0)
    }

    mutating func start(at now: Date = .now) {
        guard runningSince == nil else { return }
        runningSince = now
    }

    mutating func pause(at now: Date = .now) {
        guard let runningSince else { return }
        accumulated += max(0, now.timeIntervalSince(runningSince))
        self.runningSince = nil
    }
}

/// One part of an interval block: work or recovery of one round.
struct CardioPhase: Hashable {
    /// 0-based across the block.
    var index: Int
    /// 1-based.
    var round: Int
    var rounds: Int
    var work: Bool
    /// "Rápido", "Suave"
    var label: String
    /// Seconds from the block's start.
    var start: TimeInterval
    var length: TimeInterval

    var end: TimeInterval { start + length }

    /// Work then recovery for every round; a zero-length part is left out.
    static func phases(_ intervals: CardioIntervals) -> [CardioPhase] {
        let work = intervals.workLabel.flatMap { $0.isEmpty ? nil : $0 } ?? "Rápido"
        let rest = intervals.restLabel.flatMap { $0.isEmpty ? nil : $0 } ?? "Suave"
        let rounds = max(1, intervals.rounds)
        var phases: [CardioPhase] = []
        var at: TimeInterval = 0
        for round in 1...rounds {
            for (isWork, seconds) in [(true, intervals.workSeconds), (false, intervals.restSeconds)] where seconds > 0 {
                phases.append(CardioPhase(index: phases.count, round: round, rounds: rounds, work: isWork, label: isWork ? work : rest, start: at, length: TimeInterval(seconds)))
                at += TimeInterval(seconds)
            }
        }
        return phases
    }

    /// The phase `elapsed` seconds in; nil once the intervals are over.
    static func at(_ elapsed: TimeInterval, in intervals: CardioIntervals) -> CardioPhase? {
        phases(intervals).first { elapsed < $0.end }
    }
}

extension CardioTarget {
    /// The block's planned length: the intervals' total, else the duration.
    var totalSeconds: TimeInterval? {
        if let intervals { return CardioPhase.phases(intervals).last?.end }
        return durationMinutes.map { $0 * 60 }
    }
}

/// Words, symbols and cues for cardio blocks.
enum CardioCue {
    /// "Z2 · 118–137 ppm", or "Z2" when the person's zones aren't known.
    static func zone(_ zone: Int?, zones: [HrZoneRange]?) -> String? {
        guard let zone else { return nil }
        guard let range = zones?.first(where: { $0.zone == zone }) else { return "Z\(zone)" }
        return "Z\(zone) · \(range.minBpm)–\(range.maxBpm) ppm"
    }

    /// "1:05", "1:02:03"
    static func clock(_ seconds: TimeInterval) -> String {
        let total = Int(max(0, seconds).rounded(.down))
        let (h, m, s) = (total / 3600, total / 60 % 60, total % 60)
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }

    static func symbol(_ modality: String?) -> String {
        switch modality {
        case "treadmill": "figure.run.treadmill"
        case "elliptical": "figure.elliptical"
        case "bike": "figure.indoor.cycle"
        case "rower": "figure.rower"
        case "stairs": "figure.stair.stepper"
        case "run": "figure.run"
        case "walk": "figure.walk"
        case "jump_rope": "figure.jumprope"
        case "hiit": "figure.highintensity.intervaltraining"
        default: "heart.circle"
        }
    }

    static func label(_ modality: String?) -> String {
        switch modality {
        case "treadmill": "Cinta"
        case "elliptical": "Elíptica"
        case "bike": "Bici estática"
        case "rower": "Remo"
        case "stairs": "Escaladora"
        case "run": "Carrera"
        case "walk": "Caminata"
        case "jump_rope": "Comba"
        case "hiit": "HIIT"
        default: "Cardio"
        }
    }

    /// What the lock screen shows for a cardio block.
    static func status(_ exercise: LiveExercise, clock: CardioClock?, zones: [HrZoneRange]?, now: Date = .now) -> TrainingActivityAttributes.ContentState.Cardio {
        let clock = clock?.exerciseId == exercise.id ? clock : nil
        let elapsed = clock?.elapsed(at: now) ?? 0
        let running = clock?.running ?? false
        let zoneText = zone(exercise.cardio?.zone, zones: zones)
        let from = running ? now.addingTimeInterval(-elapsed) : nil
        if let intervals = exercise.cardio?.intervals, let phase = CardioPhase.at(elapsed, in: intervals) {
            let detail = ["Ronda \(phase.round) de \(phase.rounds)", zoneText].compactMap(\.self).joined(separator: " · ")
            return .init(
                phase: phase.label, detail: detail, elapsedFrom: from, elapsedSeconds: elapsed,
                phaseStartedAt: from?.addingTimeInterval(phase.start),
                phaseEndsAt: from?.addingTimeInterval(phase.end),
                work: phase.work
            )
        }
        let total = exercise.cardio?.totalSeconds
        let detail = [total.map { "\(Int(($0 / 60).rounded())) min" }, zoneText].compactMap(\.self).joined(separator: " · ")
        let left = total.map { $0 > elapsed } ?? false
        return .init(
            phase: label(exercise.modality),
            detail: detail.isEmpty ? (running ? "En marcha" : "En pausa") : detail,
            elapsedFrom: from, elapsedSeconds: elapsed,
            phaseStartedAt: left ? from : nil,
            phaseEndsAt: left ? from?.addingTimeInterval(total ?? 0) : nil,
            work: true
        )
    }

    /// One cue per phase change still ahead, plus one when the planned time is up.
    /// `after` is seconds from now; scheduled as local notifications so they reach a locked phone.
    static func cues(_ exercise: LiveExercise, elapsed: TimeInterval) -> [(after: TimeInterval, title: String, body: String)] {
        guard let target = exercise.cardio else { return [] }
        var cues: [(after: TimeInterval, title: String, body: String)] = []
        if let intervals = target.intervals {
            for phase in CardioPhase.phases(intervals) where phase.start > elapsed {
                cues.append((phase.start - elapsed, "\(phase.label) · \(clock(phase.length))", "Ronda \(phase.round) de \(phase.rounds)"))
            }
        }
        if let total = target.totalSeconds, total > elapsed {
            cues.append((total - elapsed, target.intervals != nil ? "Intervalos terminados" : "Tiempo cumplido", exercise.name))
        }
        // iOS keeps at most 64 pending notifications per app; leave room for others.
        return Array(cues.prefix(48))
    }
}
