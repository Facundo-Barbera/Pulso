/**
 * What the web app's Medicación page draws: today's slots, the as-needed
 * meds with today's count, adherence, every medication (paused too) and the
 * last 60 days of logged doses grouped by day. Read-only, from the
 * medication store, on the Mac's clock.
 */
import type { AdherenceReport, DoseEvent, Medication, MedicationDay } from "@pulso/contract";
import { addDays, localNow } from "../medication/schedule";
import { adherence, dosesBetween, listMedications, medicationDay } from "../medication/store";

export type HistoryEntry = DoseEvent & { name: string; dose: number; unit: string };

export type MedicationPage = {
  date: string;
  time: string;
  day: MedicationDay;
  adherence: AdherenceReport;
  /** Active first, then paused. */
  medications: Medication[];
  /** Active as-needed meds, with how many were taken today. */
  asNeeded: { medication: Medication; today: number }[];
  /** Days with something logged, newest first; entries newest first. */
  history: { date: string; entries: HistoryEntry[] }[];
};

export const HISTORY_DAYS = 60;

export function medicationPage(now = new Date()): MedicationPage {
  const { date, time } = localNow(now);
  const medications = listMedications({ includeInactive: true });
  const byId = new Map(medications.map((m) => [m.id, m]));
  const day = medicationDay(date, time);

  const asNeeded = medications
    .filter((m) => m.active && m.schedule.asNeeded)
    .map((medication) => ({ medication, today: day.asNeeded.filter((e) => e.medicationId === medication.id && e.status === "tomada").length }));

  // An entry's moment: when it was taken, else its slot, else when it was logged.
  const moment = (e: DoseEvent) => e.takenAt ?? (e.scheduledTime ? Date.parse(`${e.date}T${e.scheduledTime}:00`) : e.loggedAt);
  const groups = new Map<string, HistoryEntry[]>();
  for (const e of dosesBetween(addDays(date, -(HISTORY_DAYS - 1)), date)) {
    const med = byId.get(e.medicationId);
    groups.set(e.date, [...(groups.get(e.date) ?? []), { ...e, name: med?.name ?? "Medicamento", dose: med?.dose ?? 0, unit: med?.unit ?? "" }]);
  }
  const history = [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, entries]) => ({ date, entries: entries.sort((a, b) => moment(b) - moment(a)) }));

  return { date, time, day, adherence: adherence(date, time), medications, asNeeded, history };
}
