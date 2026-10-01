import SwiftUI
import WidgetKit

struct SnapshotEntry: TimelineEntry {
    var date: Date
    var snapshot: WidgetSnapshot?
    var paired: Bool
}

/// Every Pulso widget draws from the same snapshot. The app rewrites it after
/// each sync and reloads the timelines; when it is older than `maxAge` (the app
/// has not been opened), the timeline asks the engine itself first.
struct SnapshotProvider: TimelineProvider {
    static let maxAge: TimeInterval = 20 * 60
    static let refetch: TimeInterval = 30 * 60

    func placeholder(in context: Context) -> SnapshotEntry {
        SnapshotEntry(date: .now, snapshot: .preview, paired: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        if context.isPreview { return completion(placeholder(in: context)) }
        completion(SnapshotEntry(date: .now, snapshot: SnapshotStore.load(), paired: SharedCredentials.load() != nil))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        Task {
            let now = Date.now
            let snapshot = await WidgetEngine.snapshot(maxAge: Self.maxAge, now: now)
            let paired = SharedCredentials.load() != nil
            let dates = Self.redraws(after: now, snapshot: snapshot)
            let entries = dates.map { SnapshotEntry(date: $0, snapshot: snapshot, paired: paired) }
            completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(Self.refetch))))
        }
    }

    /// Now, plus the moments the same snapshot should look different: when the
    /// next dose comes due (it turns late) and at midnight (macros start over).
    static func redraws(after now: Date, snapshot: WidgetSnapshot?, calendar: Calendar = .current) -> [Date] {
        let horizon = now.addingTimeInterval(refetch)
        var dates = [now]
        if let due = snapshot?.nextDose?.due, due > now, due < horizon { dates.append(due) }
        if let midnight = calendar.nextDate(after: now, matching: DateComponents(hour: 0, minute: 0), matchingPolicy: .nextTime), midnight < horizon {
            dates.append(midnight)
        }
        return dates.sorted()
    }
}

extension WidgetSnapshot {
    static let preview = WidgetSnapshot(
        updatedAt: .now,
        date: WidgetClock.date(.now),
        recovery: Recovery(score: 78, level: "high", explanation: "Dormiste bien y tu VFC está sobre tu media."),
        macros: Macros(kcal: 1_340, kcalTarget: 2_400, protein: 92, proteinTarget: 160),
        nextDose: Dose(medicationId: "preview", name: "Vitamina D", doseText: "1 comprimido", date: WidgetClock.date(.now), time: "21:00", due: .now.addingTimeInterval(3_600)),
        dosesLeft: 2,
        workout: Workout(programName: "Fuerza 4 días", dayName: "Torso A", focus: "Empuje y tracción horizontal", exercises: 6)
    )
}
