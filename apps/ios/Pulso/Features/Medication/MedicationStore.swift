import Foundation
import Observation

/// Medication state shared by the Hoy card, the full screen and the
/// notification actions. One instance, so a dose logged from a notification
/// shows up everywhere.
@MainActor
@Observable
final class MedicationStore {
    static let shared = MedicationStore()

    private(set) var medications: [Medication] = []
    private(set) var day: MedicationDay?
    private(set) var adherence: AdherenceReport?
    /// The last `historyDays` days of logged doses, newest first.
    private(set) var history: [DoseEvent] = []
    static let historyDays = 60
    /// Schedule suggestions not dismissed on this phone.
    private(set) var nudges: [ScheduleNudge] = []
    private var dismissedNudges = Set(UserDefaults.standard.stringArray(forKey: MedicationStore.dismissedNudgesKey) ?? [])
    private static let dismissedNudgesKey = "pulso.medication.nudges.dismissed"
    private(set) var loaded = false
    private(set) var loading = false

    /// Logs that failed to reach the Mac (e.g. tapped "Tomada" off the tailnet). Retried on refresh.
    private var outbox: [DoseLog] = MedicationStore.loadOutbox()
    private static let outboxKey = "pulso.medication.outbox"

    private var model: PulsoModel { .shared }

    var active: [Medication] { medications.filter(\.active) }
    var lowStock: [Medication] { active.filter(\.lowStock) }
    var asNeeded: [Medication] { active.filter(\.schedule.asNeeded) }

    func refresh() async {
        guard let api = model.api else { return }
        loading = true
        defer { loading = false }
        await flushOutbox()
        do {
            async let meds = api.medications()
            async let today = api.medicationDay()
            async let report = api.medicationAdherence()
            let from = LocalClock.date(Calendar.current.date(byAdding: .day, value: -(Self.historyDays - 1), to: .now) ?? .now)
            async let doses = api.doses(from: from, to: LocalClock.date(.now))
            async let upcoming = api.upcomingMedication()
            async let suggested = api.scheduleNudges()
            (medications, day, adherence) = try await (meds, today, report)
            // An engine without `/nudges` simply suggests nothing.
            nudges = ((try? await suggested) ?? []).filter { !dismissedNudges.contains($0.medicationId) }
            history = (try? await doses)?.sorted { ($0.takenAt ?? 0, $0.date, $0.scheduledTime ?? "") > ($1.takenAt ?? 0, $1.date, $1.scheduledTime ?? "") } ?? history
            loaded = true
            await replan(upcoming: try? await upcoming)
            await WidgetSync.refresh()
        } catch {
            model.handle(error)
        }
    }

    // MARK: Doses

    /// Logs a dose, optimistically updating today's slot. Off the tailnet it's queued and retried.
    func log(_ log: DoseLog, replan: Bool = true) async {
        apply(log)
        MedicationNotifications.shared.clearSnooze(for: "\(log.medicationId)|\(log.date)|\(log.scheduledTime ?? "")")
        guard let api = model.api else { return enqueue(log) }
        do {
            try await api.logDose(log)
        } catch let failure as PulsoAPI.Failure where failure.kind == .transport {
            enqueue(log)
        } catch {
            model.handle(error)
        }
        if replan { await refresh() }
    }

    func take(_ slot: DoseSlot) async {
        await log(slot.log(.tomada, takenAt: (Date.now.timeIntervalSince1970 * 1000).rounded()))
    }

    func skip(_ slot: DoseSlot) async {
        await log(slot.log(.omitida))
    }

    /// Back to pending. Returns the dose to stock if it was taken.
    func undo(_ slot: DoseSlot) async {
        guard let api = model.api, let eventId = slot.eventId else { return }
        do {
            try await api.undoDose(eventId: eventId)
        } catch {
            model.handle(error)
        }
        await refresh()
    }

    /// A workout just ended, was saved or synced from Salud: the training slots
    /// resolve differently now, so reload them and their reminders.
    func refreshAfterWorkout() async {
        if loaded && medications.isEmpty { return }
        await refresh()
    }

    /// The latest workout end seen from Salud, so a sync with nothing new costs nothing.
    private var lastHealthWorkoutEnd: Double?

    /// After a Salud sync: replans only when a workout ended today that wasn't seen yet
    /// and something is tied to training.
    func healthWorkoutsSynced(_ workouts: [WorkoutInput]) async {
        let today = LocalClock.date(.now)
        let ends = workouts.map(\.endedAt).filter { LocalClock.date(Date(timeIntervalSince1970: $0 / 1000)) == today }
        guard let latest = ends.max(), latest > (lastHealthWorkoutEnd ?? 0) else { return }
        lastHealthWorkoutEnd = latest
        if loaded && !medications.contains(where: { $0.active && $0.schedule.training != nil }) { return }
        await refresh()
    }

    /// Today's doses tied to training that are still to take, for the post-workout card.
    var pendingAfterWorkout: [DoseSlot] {
        guard let day, day.date == LocalClock.date(.now) else { return [] }
        return day.slots.filter { $0.moment == .entreno && $0.isPending }
    }

    /// Doses actually taken today, scheduled or not.
    var takenToday: Int {
        (day?.taken ?? 0) + (day?.asNeeded.count { $0.status == .tomada } ?? 0)
    }

    /// Removes one logged dose (a mistaken tap, a duplicate).
    func undo(event: DoseEvent) async {
        guard let api = model.api else { return }
        history.removeAll { $0.id == event.id }
        do {
            try await api.undoDose(eventId: event.id)
        } catch {
            model.handle(error)
        }
        await refresh()
    }

    /// An as-needed (or extra) intake, now.
    func takeNow(_ med: Medication) async {
        await log(DoseLog(medicationId: med.id, date: LocalClock.date(.now), scheduledTime: nil, status: .tomada, takenAt: (Date.now.timeIntervalSince1970 * 1000).rounded()))
    }

    private func apply(_ log: DoseLog) {
        guard var day, day.date == log.date, let key = log.scheduledTime,
              let index = day.slots.firstIndex(where: { $0.medicationId == log.medicationId && $0.slot == key })
        else { return }
        day.slots[index].status = log.status
        day.slots[index].takenAt = log.takenAt
        self.day = day
    }

    /// «Ahora no»: hides a suggestion on this phone for good.
    func dismiss(_ nudge: ScheduleNudge) {
        dismissedNudges.insert(nudge.medicationId)
        UserDefaults.standard.set(Array(dismissedNudges), forKey: Self.dismissedNudgesKey)
        nudges.removeAll { $0.id == nudge.id }
    }

    // MARK: Medications

    func save(_ draft: MedicationDraft, id: String?) async -> Bool {
        guard let api = model.api else { return false }
        do {
            if let id { _ = try await api.updateMedication(id: id, draft) } else { _ = try await api.addMedication(draft) }
            await refresh()
            if !draft.schedule.asNeeded { await MedicationNotifications.shared.requestAuthorization() }
            return true
        } catch {
            model.handle(error)
            return false
        }
    }

    func delete(_ id: String) async {
        guard let api = model.api else { return }
        do {
            try await api.deleteMedication(id: id)
        } catch {
            model.handle(error)
        }
        await refresh()
    }

    // MARK: Reminders and outbox

    /// Reminders from the engine's resolved slots; an engine without `/upcoming`
    /// (nil) gets the fixed times expanded here, as before.
    private func replan(upcoming: MedicationUpcoming?) async {
        let notifications = MedicationNotifications.shared
        let reminders: [MedicationNotifications.Reminder]
        if let upcoming {
            reminders = MedicationNotifications.plan(slots: upcoming.slots, now: .now, nudged: notifications.nudged)
        } else {
            let handled = Set((day?.slots ?? []).filter { $0.status != .pendiente }.map(\.id))
            reminders = MedicationNotifications.plan(medications: medications, handled: handled, now: .now)
        }
        await notifications.schedule(reminders)
    }

    private func enqueue(_ log: DoseLog) {
        outbox.removeAll { $0.medicationId == log.medicationId && $0.date == log.date && $0.scheduledTime == log.scheduledTime && log.scheduledTime != nil }
        outbox.append(log)
        saveOutbox()
    }

    private func flushOutbox() async {
        guard let api = model.api, !outbox.isEmpty else { return }
        var remaining: [DoseLog] = []
        for log in outbox {
            do {
                try await api.logDose(log)
            } catch let failure as PulsoAPI.Failure where failure.kind == .transport {
                remaining.append(log)
            } catch {
                // Refused (e.g. the med was deleted): drop it rather than retry forever.
            }
        }
        outbox = remaining
        saveOutbox()
    }

    private func saveOutbox() {
        UserDefaults.standard.set(try? JSONEncoder().encode(outbox), forKey: Self.outboxKey)
    }

    private static func loadOutbox() -> [DoseLog] {
        guard let data = UserDefaults.standard.data(forKey: outboxKey) else { return [] }
        return (try? JSONDecoder().decode([DoseLog].self, from: data)) ?? []
    }
}
