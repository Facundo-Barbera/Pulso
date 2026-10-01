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
            (medications, day, adherence) = try await (meds, today, report)
            history = (try? await doses)?.sorted { ($0.takenAt ?? 0, $0.date, $0.scheduledTime ?? "") > ($1.takenAt ?? 0, $1.date, $1.scheduledTime ?? "") } ?? history
            loaded = true
            await replan()
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
        await log(DoseLog(medicationId: slot.medicationId, date: slot.date, scheduledTime: slot.time, status: .tomada, takenAt: (Date.now.timeIntervalSince1970 * 1000).rounded()))
    }

    func skip(_ slot: DoseSlot) async {
        await log(DoseLog(medicationId: slot.medicationId, date: slot.date, scheduledTime: slot.time, status: .omitida))
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
        guard var day, day.date == log.date, let time = log.scheduledTime,
              let index = day.slots.firstIndex(where: { $0.medicationId == log.medicationId && $0.time == time })
        else { return }
        day.slots[index].status = log.status
        day.slots[index].takenAt = log.takenAt
        self.day = day
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

    private func replan() async {
        let handled = Set((day?.slots ?? []).filter { $0.status != .pendiente }.map(\.id))
        let reminders = MedicationNotifications.plan(medications: medications, handled: handled, now: .now)
        await MedicationNotifications.shared.schedule(reminders)
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
