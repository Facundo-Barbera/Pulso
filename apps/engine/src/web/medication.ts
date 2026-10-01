/**
 * What the web app's Medicación y suplementos page draws: today's slots
 * grouped by moment, the as-needed meds with today's count, adherence, every
 * medication (paused too) and the last 60 days of logged doses grouped by
 * day. Read-only, from the medication store, on the Mac's clock. Also the
 * Spanish wording of schedules and slots, which Hoy shares.
 */
import type { AdherenceReport, DoseEvent, DoseMoment, DoseSlot, Medication, MedicationDay, MedicationSchedule, TrainingSlot } from "@pulso/contract";
import { addDays, localNow, TIME } from "../medication/schedule";
import { adherence, dosesBetween, listMedications, medicationDay } from "../medication/store";

export type HistoryEntry = DoseEvent & { name: string; dose: number; unit: string };

export type MedicationPage = {
  date: string;
  time: string;
  day: MedicationDay;
  /** Today's slots grouped by moment. */
  groups: DoseGroup[];
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
  const moment = (e: DoseEvent) => e.takenAt ?? (e.scheduledTime && TIME.test(e.scheduledTime) ? Date.parse(`${e.date}T${e.scheduledTime}:00`) : e.loggedAt);
  const groups = new Map<string, HistoryEntry[]>();
  for (const e of dosesBetween(addDays(date, -(HISTORY_DAYS - 1)), date)) {
    const med = byId.get(e.medicationId);
    groups.set(e.date, [...(groups.get(e.date) ?? []), { ...e, name: med?.name ?? "Medicamento", dose: med?.dose ?? 0, unit: med?.unit ?? "" }]);
  }
  const history = [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, entries]) => ({ date, entries: entries.sort((a, b) => moment(b) - moment(a)) }));

  return { date, time, day, groups: groupSlots(day.slots, time), adherence: adherence(date, time), medications, asNeeded, history };
}

// --- Spanish wording for schedules and slots, shared by the page and Hoy. ---

const MOMENT_TITLE: Record<Exclude<DoseMoment, "hora">, string> = {
  entreno: "Después de entrenar",
  desayuno: "Con el desayuno",
  comida: "Con la comida",
  cena: "Con la cena",
  dormir: "Antes de dormir",
};

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (items: string[]) => new Intl.ListFormat("es", { type: "conjunction" }).format(items);

/** A logged slot key as words: "las 09:00", "después de entrenar", "con el desayuno"… */
export function slotLabel(key: string): string {
  return key in MOMENT_TITLE ? lower(MOMENT_TITLE[key as keyof typeof MOMENT_TITLE]) : `las ${key}`;
}

const DAY_LETTERS = ["L", "M", "X", "J", "V", "S", "D"];

/** A schedule in one line: "Después de entrenar · días sin entreno 09:00", "Con la comida", "L X V · 08:00 y 20:00". */
export function scheduleLine(s: MedicationSchedule): string {
  if (s.asNeeded) return "Cuando haga falta";
  const parts: string[] = [];
  if (s.training) parts.push(`después de entrenar · ${s.training.restDayTime ? `días sin entreno ${s.training.restDayTime}` : "solo días de entreno"}`);
  if (s.meals.length) parts.push(`con ${list(s.meals.map((m) => ({ desayuno: "el desayuno", comida: "la comida", cena: "la cena" })[m]))}`);
  if (s.times.length) parts.push(list(s.times));
  if (s.bedtime) parts.push("antes de dormir");
  if (s.days.length) parts.unshift(s.days.map((d) => DAY_LETTERS[d - 1]).join(" "));
  return upper(parts.join(" · "));
}

const COUNT_UNITS: Record<string, string> = { comprimido: "comprimidos", cápsula: "cápsulas", gomita: "gomitas", sobre: "sobres", cazo: "cazos", scoop: "scoops", gota: "gotas" };
const SINGULAR = Object.fromEntries(Object.entries(COUNT_UNITS).map(([one, many]) => [many, one]));

/** The unit agreeing with the amount: 1 cápsula, 2 cápsulas (units it doesn't know stay as typed). */
export function unitFor(dose: number, unit: string): string {
  if (dose === 1) return SINGULAR[unit] ?? unit;
  return COUNT_UNITS[unit] ?? unit;
}

/** How a training slot stands, for a pending dose: "Al terminar tu sesión de las 18:00", "Entrenando…", "Hoy descansas · 09:00"… */
export function trainingLine(t: TrainingSlot, now: string): string {
  switch (t.state) {
    case "trained":
      return now > t.until! ? `Terminaste a las ${t.workoutEnd} · era antes de las ${t.until}` : `Terminaste a las ${t.workoutEnd} · tómala antes de las ${t.until}`;
    case "training":
      return "Entrenando…";
    case "planned":
      return `Al terminar tu sesión de las ${t.plannedAt}`;
    case "rest":
      return `Hoy descansas · ${t.fallback}`;
  }
}

export type GroupedSlot = DoseSlot & {
  /** What to say under the name while it is pending (training slots); null otherwise. */
  line: string | null;
};

/** Today's slots under one moment: a fixed time, a meal, bedtime or "Después de entrenar". */
export type DoseGroup = {
  key: string;
  moment: DoseMoment;
  /** "08:00", "Con el desayuno", "Después de entrenar"… */
  title: string;
  /** The shared due time, shown next to a moment's title; null for fixed times (the title is the time) and training. */
  time: string | null;
  slots: GroupedSlot[];
};

/**
 * Slots grouped by moment, in the order the engine sorted them (by time,
 * slots waiting for a workout last). Fixed times group by the clock; every
 * training slot sits under "Después de entrenar", wherever it resolved.
 */
export function groupSlots(slots: DoseSlot[], now: string): DoseGroup[] {
  const groups = new Map<string, DoseGroup>();
  for (const slot of slots) {
    const key = slot.moment === "hora" ? slot.slot : slot.moment;
    let group = groups.get(key);
    if (!group) {
      group = { key, moment: slot.moment, title: slot.moment === "hora" ? slot.slot : MOMENT_TITLE[slot.moment], time: slot.moment === "hora" || slot.moment === "entreno" ? null : slot.time, slots: [] };
      groups.set(key, group);
    }
    const pending = slot.status === "pendiente" || slot.status === "pospuesta";
    group.slots.push({ ...slot, line: slot.training && pending ? trainingLine(slot.training, now) : null });
  }
  return [...groups.values()];
}
