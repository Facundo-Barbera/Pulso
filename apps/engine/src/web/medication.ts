/**
 * What the web app's Medicación y suplementos page draws: one timeline of
 * today (every active medication once per dose, with its state), suggestions
 * to schedule as-needed meds taken on a rhythm, adherence, every medication
 * (paused too) and the last 60 days of logged doses grouped by day.
 * Read-only, from the medication store, on the Mac's clock. Also the Spanish
 * wording of schedules and slots, which Hoy shares.
 */
import type { AdherenceReport, DayPart, DoseEvent, DoseMoment, DoseSlot, Medication, MedicationDay, MedicationSchedule, ScheduleNudge, TrainingSlot } from "@pulso/contract";
import { addDays, isDueOn, isoWeekday, localNow, TIME, toMinutes } from "../medication/schedule";
import { adherence, dosesBetween, listMedications, medicationDay, nudges } from "../medication/store";

export type HistoryEntry = DoseEvent & { name: string; dose: number; unit: string };

export type MedicationPage = {
  date: string;
  time: string;
  day: MedicationDay;
  /** Today, in order: what was taken, what is still to take, then what waits, can wait or isn't due. */
  today: TodayItem[];
  nudges: ScheduleNudge[];
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

  return { date, time, day, today: todayItems(medications, day, history, date, time), nudges: nudges(date), adherence: adherence(date, time), medications, asNeeded, history };
}

/**
 * Where a dose stands today. `ahora`: due within the last hour (or a workout's window is open);
 * `atrasada`: due longer ago; `entreno`: waiting for a workout; `dia`: due today at any time;
 * `no-toca`: scheduled, not today; `a-demanda`: as-needed, taken or not.
 */
export type TodayState = "tomada" | "omitida" | "ahora" | "atrasada" | "pendiente" | "entreno" | "dia" | "a-demanda" | "no-toca";

export type TodayItem = {
  key: string;
  medication: Medication;
  state: TodayState;
  /** "HH:MM" it sits at on the day: when taken, else when due; null when it has no time today. */
  at: string | null;
  /** When it is due, in words: "A las 09:00", "Con la comida · 14:00", "Después de entrenar", "Cuando haga falta". */
  when: string;
  /** How it stands: "Tomada a las 09:56", "Toca ahora", "Se pasó hace 2 h", "Al terminar tu sesión de las 18:00", "Toca el lunes"… */
  line: string;
  /** The slot to log against; null for as-needed, extra intakes and days off. */
  slot: DoseSlot | null;
  /** Intakes logged today outside a slot (as-needed or extra), newest first. */
  intakes: HistoryEntry[];
};

/** Still to take today. */
export const isLeft = (item: TodayItem) => item.state === "ahora" || item.state === "atrasada" || item.state === "pendiente" || item.state === "entreno" || item.state === "dia";

/** A dose still to take, in a few words for a chip: "ahora", "a las 21:00", "era a las 09:00", "al terminar de entrenar", "cuando quieras", "en la tarde". */
export function leftLabel(item: TodayItem): string {
  const window = item.slot?.window;
  if (item.state === "dia") return "cuando quieras";
  if (window) return item.state === "ahora" ? `hasta las ${window.end}` : lower(MOMENT_TITLE[window.part]);
  if (item.state === "entreno") return "al terminar de entrenar";
  if (item.state === "atrasada") return `era a las ${item.at}`;
  return item.state === "ahora" ? "ahora" : `a las ${item.at}`;
}

const DUE_NOW_MINUTES = 60;
const WEEKDAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const clock = (ms: number) => localNow(new Date(ms)).time;

function slotWhen(slot: DoseSlot): string {
  if (slot.moment === "hora") return `A las ${slot.slot}`;
  if (slot.moment === "dia") return "Cualquier hora";
  if (slot.window) return `${MOMENT_TITLE[slot.moment as DayPart]} · ${range(slot.window)}`;
  if (slot.moment === "entreno") return slot.training?.state === "rest" ? `Hoy descansas · ${slot.time}` : MOMENT_TITLE.entreno;
  return `${MOMENT_TITLE[slot.moment]} · ${slot.time}`;
}

function slotState(slot: DoseSlot, now: string): { state: TodayState; line: string } {
  if (slot.status === "tomada") return { state: "tomada", line: slot.takenAt ? `Tomada a las ${clock(slot.takenAt)}` : "Tomada" };
  if (slot.status === "omitida") return { state: "omitida", line: "Omitida" };
  if (slot.moment === "dia") return { state: "dia", line: slot.status === "pospuesta" ? "Pospuesta · hoy, cuando quieras" : ANY_TIME_LINE };
  if (slot.window) {
    const { start, end } = slot.window;
    if (now < start) return { state: "pendiente", line: slot.status === "pospuesta" ? "Pospuesta" : `Desde las ${start}` };
    return now <= end ? { state: "ahora", line: `Cuando quieras hasta las ${end}` } : { state: "atrasada", line: `Era ${lower(MOMENT_TITLE[slot.moment as DayPart])} · aún estás a tiempo hoy` };
  }
  const t = slot.training;
  if (slot.time === null) return { state: "entreno", line: t ? trainingLine(t, now) : "Esperando" };
  if (t?.state === "trained") return { state: now <= t.until! ? "ahora" : "atrasada", line: trainingLine(t, now) };
  if (slot.time > now) return { state: "pendiente", line: slot.status === "pospuesta" ? "Pospuesta" : `En ${fmtGap(toMinutes(slot.time) - toMinutes(now))}` };
  const late = toMinutes(now) - toMinutes(slot.time);
  return late <= DUE_NOW_MINUTES ? { state: "ahora", line: "Toca ahora" } : { state: "atrasada", line: `Se pasó hace ${fmtGap(late)}` };
}

/** What an any-time dose says until it is taken. */
export const ANY_TIME_LINE = "Hoy toca · cuando quieras";

const range = (w: { start: string; end: string }) => `${w.start}–${w.end}`;

const fmtGap = (minutes: number) => (minutes < 60 ? `${minutes} min` : minutes % 60 === 0 || minutes >= 180 ? `${Math.round(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`);

/** Why a scheduled med has nothing today, and when it does next. */
function offLine(med: Medication, date: string): string {
  const { schedule } = med;
  if (date < med.startDate) return `Empieza el ${fmtDate(med.startDate)}`;
  if (!isDueOn(schedule, date)) {
    // Monthly and every-N schedules can be weeks away; a year covers every frequency.
    const next = Array.from({ length: 366 }, (_, i) => addDays(date, i + 1)).find((d) => isDueOn(schedule, d) && !(med.endDate && d > med.endDate));
    if (!next) return "Hoy no toca";
    if (next === addDays(date, 1)) return "Toca mañana";
    return next < addDays(date, 7) ? `Toca el ${WEEKDAY_NAMES[isoWeekday(next) - 1]}` : `Toca el ${fmtDate(next)}`;
  }
  if (schedule.training && schedule.training.restDayTime === null) return "Hoy descansas · solo los días de entreno";
  return "Hoy no toca";
}

/** "ayer", "el domingo" (this past week), "el 12 de septiembre". */
function lastLabel(last: string, today: string): string {
  if (last === addDays(today, -1)) return "ayer";
  if (last > addDays(today, -7)) return `el ${WEEKDAY_NAMES[isoWeekday(last) - 1]}`;
  return `el ${fmtDate(last)}`;
}

const fmtDate = (date: string) => new Intl.DateTimeFormat("es", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

const ORDER: Record<TodayState, number> = { tomada: 0, omitida: 0, ahora: 0, atrasada: 0, pendiente: 0, entreno: 1, dia: 1, "a-demanda": 2, "no-toca": 3 };

/**
 * Today as one list: every slot of every active med, intakes logged outside a
 * slot, each as-needed med once, and scheduled meds with nothing today. Timed
 * items go by the clock (taken ones at when they were taken); then what waits
 * for a workout or is due any time today, the as-needed meds not taken yet and
 * what isn't due today.
 */
export function todayItems(medications: Medication[], day: MedicationDay, history: MedicationPage["history"], date: string, now: string): TodayItem[] {
  const items: TodayItem[] = [];
  const slotted = new Set(day.slots.map((s) => `${s.medicationId}|${s.slot}`));
  const entries = history.find((d) => d.date === date)?.entries ?? [];
  const loose = entries.filter((e) => e.status === "tomada" && !(e.scheduledTime && slotted.has(`${e.medicationId}|${e.scheduledTime}`)));

  for (const med of medications.filter((m) => m.active)) {
    const intakes = loose.filter((e) => e.medicationId === med.id);
    const at = intakes[0]?.takenAt ? clock(intakes[0].takenAt) : null;
    if (med.schedule.asNeeded) {
      const last = intakes.length ? null : history.find((d) => d.entries.some((e) => e.medicationId === med.id && e.status === "tomada"))?.date;
      const line = intakes.length === 0 ? (last ? `Última ${lastLabel(last, date)}` : "Ninguna hoy") : intakes.length === 1 ? `Tomada a las ${at}` : `${intakes.length} hoy · última a las ${at}`;
      items.push({ key: med.id, medication: med, state: "a-demanda", at, when: "Cuando haga falta", line, slot: null, intakes });
      continue;
    }
    const slots = day.slots.filter((s) => s.medicationId === med.id);
    for (const slot of slots) {
      const { state, line } = slotState(slot, now);
      items.push({ key: `${med.id}|${slot.slot}`, medication: med, state, at: slot.takenAt ? clock(slot.takenAt) : slot.time, when: slotWhen(slot), line, slot, intakes: [] });
    }
    for (const e of intakes) {
      items.push({ key: e.id, medication: med, state: "tomada", at: clock(e.takenAt!), when: "Fuera de horario", line: `Tomada a las ${clock(e.takenAt!)}`, slot: null, intakes: [e] });
    }
    if (slots.length === 0 && intakes.length === 0 && !(med.endDate && date > med.endDate)) {
      items.push({ key: med.id, medication: med, state: "no-toca", at: null, when: scheduleLine(med.schedule), line: offLine(med, date), slot: null, intakes: [] });
    }
  }
  // As-needed meds taken today sit on the clock with the rest; untaken ones wait below.
  const rank = (i: TodayItem) => (i.state === "a-demanda" && i.at ? 0 : ORDER[i.state]);
  return items.sort((a, b) => rank(a) - rank(b) || (a.at ?? "99").localeCompare(b.at ?? "99") || a.medication.name.localeCompare(b.medication.name));
}

// --- Spanish wording for schedules and slots, shared by the page and Hoy. ---

const MOMENT_TITLE: Record<Exclude<DoseMoment, "hora">, string> = {
  entreno: "Después de entrenar",
  desayuno: "Con el desayuno",
  comida: "Con la comida",
  cena: "Con la cena",
  dormir: "Antes de dormir",
  manana: "En la mañana",
  tarde: "En la tarde",
  noche: "En la noche",
  dia: "Cualquier hora",
};

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (items: string[]) => new Intl.ListFormat("es", { type: "conjunction" }).format(items);

/** A logged slot key as words: "las 09:00", "después de entrenar", "con el desayuno"… */
export function slotLabel(key: string): string {
  return key in MOMENT_TITLE ? lower(MOMENT_TITLE[key as keyof typeof MOMENT_TITLE]) : `las ${key}`;
}

const DAY_LETTERS = ["L", "M", "X", "J", "V", "S", "D"];

/** Which days, in words: "Semanal · jueves", "L X V", "Cada 3 días", "Cada 2 semanas · lunes", "Cada mes · día 5"; null for every day. */
export function frequencyLine(s: Pick<MedicationSchedule, "days" | "interval" | "monthDay">): string | null {
  const days = s.days.length === 1 ? WEEKDAY_NAMES[s.days[0]! - 1]! : s.days.map((d) => DAY_LETTERS[d - 1]).join(" ");
  if (s.monthDay) return `Cada mes · día ${s.monthDay}`;
  if (s.interval?.unit === "day") return `Cada ${s.interval.every} días`;
  if (s.interval) return `Cada ${s.interval.every} semanas · ${days}`;
  if (s.days.length === 1) return `Semanal · ${days}`;
  return s.days.length ? days : null;
}

/**
 * A schedule in one line: "Después de entrenar · días sin entreno 09:00", "Con la comida",
 * "L X V · 08:00 y 20:00", "Semanal · jueves · cualquier hora".
 */
export function scheduleLine(s: MedicationSchedule): string {
  if (s.asNeeded) return "Cuando haga falta";
  const parts: string[] = [];
  if (s.training) parts.push(`después de entrenar · ${s.training.restDayTime ? `días sin entreno ${s.training.restDayTime}` : "solo días de entreno"}`);
  if (s.meals.length) parts.push(`con ${list(s.meals.map((m) => ({ desayuno: "el desayuno", comida: "la comida", cena: "la cena" })[m]))}`);
  if (s.times.length) parts.push(list(s.times));
  if (s.windows.length) parts.push(list(s.windows.map((w) => lower(MOMENT_TITLE[w.part]))));
  if (s.bedtime) parts.push("antes de dormir");
  if (s.anyTime) parts.push("cualquier hora");
  const frequency = frequencyLine(s);
  if (frequency) parts.unshift(frequency);
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
  /** What to say under the name while it is pending (training and any-time slots); null otherwise. */
  line: string | null;
};

/** Today's slots under one moment: a fixed time, a meal, bedtime or "Después de entrenar". */
export type DoseGroup = {
  key: string;
  moment: DoseMoment;
  /** "08:00", "Con el desayuno", "Después de entrenar"… */
  title: string;
  /** The shared due time (a window's range), shown next to a moment's title; null for fixed times (the title is the time), training and any time. */
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
      const time = slot.window ? range(slot.window) : slot.moment === "hora" || slot.moment === "entreno" ? null : slot.time;
      group = { key, moment: slot.moment, title: slot.moment === "hora" ? slot.slot : MOMENT_TITLE[slot.moment], time, slots: [] };
      groups.set(key, group);
    }
    const pending = slot.status === "pendiente" || slot.status === "pospuesta";
    const line = !pending ? null : slot.training ? trainingLine(slot.training, now) : slot.moment === "dia" ? ANY_TIME_LINE : null;
    group.slots.push({ ...slot, line });
  }
  return [...groups.values()];
}
