/**
 * Pure date math: schedules into dose slots, and slots plus logged events into
 * adherence and streaks. Everything works on local "YYYY-MM-DD" / "HH:MM"
 * strings that the phone sends, so the engine never guesses a time zone.
 */
import type { AdherenceDay, AdherenceWindow, DoseMeal, DoseMoment, DoseStatus, DoseWindow, Medication, MedicationAdherence, MedicationSchedule, TrainingRule, TrainingSlot } from "@pulso/contract";

export const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const toUTC = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
};

export function addDays(date: string, days: number): string {
  return new Date(toUTC(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** 1 = lunes … 7 = domingo. */
export function isoWeekday(date: string): number {
  return new Date(toUTC(date)).getUTCDay() || 7;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string) => Math.round((toUTC(to) - toUTC(from)) / 86_400_000);

/** The last day of the month of `date`, 28–31. */
const daysInMonth = (date: string) => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();

/**
 * Whether a schedule's frequency falls on `date` (ignoring start/end dates):
 * every N days from the interval's start, every N weeks (counted Monday to
 * Monday from the start's week) on `days`, a day of the month (clamped to the
 * month's last day), or the weekdays in `days` (all when empty).
 */
export function isDueOn(schedule: Pick<MedicationSchedule, "days" | "interval" | "monthDay">, date: string): boolean {
  const { interval, monthDay, days } = schedule;
  if (monthDay) return Number(date.slice(8, 10)) === Math.min(monthDay, daysInMonth(date));
  if (interval) {
    if (date < interval.start) return false;
    if (interval.unit === "day") return daysBetween(interval.start, date) % interval.every === 0;
    const weeks = daysBetween(addDays(interval.start, 1 - isoWeekday(interval.start)), date) / 7;
    if (Math.floor(weeks) % interval.every !== 0) return false;
    // Weeks with no days given fall on the start's weekday.
    return (days.length ? days : [isoWeekday(interval.start)]).includes(isoWeekday(date));
  }
  return days.length === 0 || days.includes(isoWeekday(date));
}

/** The local date and "HH:MM" of an instant, in this process's time zone. */
export function localNow(at = new Date()): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  };
}

/** Minutes since midnight of "HH:MM", and back (clamped to the day). */
export const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const fromMinutes = (minutes: number) => {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Used when the calendar has no time for a meal. */
export const DEFAULT_MEAL_TIMES: Record<DoseMeal, string> = { desayuno: "08:00", comida: "14:00", cena: "21:00" };
/** "Antes de dormir" reminds this long before the sleep time. */
export const BEDTIME_LEAD_MINUTES = 30;

/**
 * What a day looks like for the slots tied to moments, read from training,
 * Health and the calendar by the store. Times are local "HH:MM".
 */
export type DayFacts = {
  /** When each workout of the day ended: Pulso sessions and Health workouts. */
  workoutEnds: string[];
  /** A Pulso session is in progress right now (only ever true for today). */
  live: boolean;
  /** Calendar sessions still planned that day (not skipped or moved). */
  planned: { start: string; end: string }[];
  meals: Partial<Record<DoseMeal, string>>;
  sleepTime: string;
};

export const NO_FACTS: DayFacts = { workoutEnds: [], live: false, planned: [], meals: {}, sleepTime: "23:00" };

/**
 * One slot of one med on one date, before its logged status is attached.
 * `remindAt`: when to remind while pending (see DoseSlot).
 */
export type ResolvedSlot = { slot: string; moment: DoseMoment; time: string | null; training: TrainingSlot | null; window: DoseWindow | null; remindAt: string | null };

/** Moments whose dose is due over a stretch of the day, so they only count as missed once that day is over. */
export const isFlexible = (moment: DoseMoment) => moment === "dia" || moment === "manana" || moment === "tarde" || moment === "noche";

type Schedulable = Pick<Medication, "schedule" | "startDate" | "endDate" | "active">;

/**
 * The training slot of a day (see TrainingSlot), or null when there is none:
 * 1. A workout ended that day → due at the first one's end, to take within the window.
 * 2. Today, a session in progress → wait for it.
 * 3. A planned session still ahead (today: its end hasn't passed; future days: any) → wait for it.
 * 4. Otherwise it is a rest day: due at restDayTime, or no slot with "No tomar". A planned
 *    session that never happened pushes the rest-day time to its end, so the reminder that
 *    was waiting for it fires once it is clearly not happening.
 * While waiting, `fallback` is that rest-day time, so the phone can set a reminder that a
 * workout later replaces.
 */
export function resolveTraining(rule: TrainingRule, date: string, facts: DayFacts, today: string, now: string): TrainingSlot | null {
  const none = { workoutEnd: null, until: null, plannedAt: null, fallback: null };
  const ended = [...facts.workoutEnds].sort()[0];
  if (ended) return { ...none, state: "trained", workoutEnd: ended, until: fromMinutes(toMinutes(ended) + rule.withinMinutes) };

  const latestPlanEnd = facts.planned.map((p) => p.end).sort().at(-1);
  const fallback = rule.restDayTime && latestPlanEnd && latestPlanEnd > rule.restDayTime ? latestPlanEnd : rule.restDayTime;
  if (date === today && facts.live) return { ...none, state: "training", fallback };
  const ahead = date < today ? [] : facts.planned.filter((p) => date > today || p.end > now).sort((a, b) => a.start.localeCompare(b.start));
  if (ahead[0]) return { ...none, state: "planned", plannedAt: ahead[0].start, fallback };
  return fallback ? { ...none, state: "rest", fallback } : null;
}

/** Every slot of one med on one date, sorted by time (any-time and waiting ones last); none for as-needed, inactive, out-of-range or off days. */
export function resolveSlots(med: Schedulable, date: string, facts: DayFacts = NO_FACTS, today = date, now = "00:00"): ResolvedSlot[] {
  const { schedule } = med;
  if (!med.active || schedule.asNeeded) return [];
  if (date < med.startDate || (med.endDate && date > med.endDate)) return [];
  if (!isDueOn(schedule, date)) return [];

  const at = (slot: string, moment: DoseMoment, time: string | null): ResolvedSlot => ({ slot, moment, time, training: null, window: null, remindAt: time });
  const slots: ResolvedSlot[] = [...new Set(schedule.times)].map((t) => at(t, "hora", t));
  for (const meal of new Set(schedule.meals)) slots.push(at(meal, meal, facts.meals[meal] ?? DEFAULT_MEAL_TIMES[meal]));
  if (schedule.bedtime) {
    // A sleep time past midnight belongs to the night before; remind before midnight instead.
    const sleep = facts.sleepTime < "12:00" ? "24:00" : facts.sleepTime;
    slots.push(at("dormir", "dormir", fromMinutes(toMinutes(sleep) - BEDTIME_LEAD_MINUTES)));
  }
  for (const window of schedule.windows) slots.push({ ...at(window.part, window.part, window.start), window });
  if (schedule.anyTime) slots.push({ ...at("dia", "dia", null), remindAt: schedule.reminder });
  if (schedule.training) {
    const training = resolveTraining(schedule.training, date, facts, today, now);
    if (training) {
      const time = training.state === "trained" ? training.workoutEnd : training.state === "rest" ? training.fallback : null;
      slots.push({ ...at("entreno", "entreno", time), training, remindAt: time ?? training.fallback });
    }
  }
  return slots.sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99") || a.slot.localeCompare(b.slot));
}

/** Slot keys: "HH:MM" or a moment. */
export const SLOT_MOMENTS = ["entreno", "desayuno", "comida", "cena", "dormir", "manana", "tarde", "noche", "dia"] as const;
export const isSlotKey = (key: string) => TIME.test(key) || (SLOT_MOMENTS as readonly string[]).includes(key);

/** `medicationId|date|slot` → status, for the events of scheduled slots. */
export type StatusIndex = Map<string, DoseStatus>;
export const slotKey = (medicationId: string, date: string, slot: string) => `${medicationId}|${date}|${slot}`;

type DayCount = { due: number; taken: number; /** every slot of the day, due or not, is taken */ allTaken: boolean; slots: number };

function countDay(med: Medication, date: string, statuses: StatusIndex, today: string, now: string, facts: DayFacts): DayCount {
  const slots = resolveSlots(med, date, facts, today, now);
  let due = 0;
  let taken = 0;
  let allTaken = true;
  for (const { slot, moment, time } of slots) {
    const isTaken = statuses.get(slotKey(med.id, date, slot)) === "tomada";
    if (!isTaken) allTaken = false;
    // A dose taken early counts as soon as it's taken; otherwise only once its time has come
    // (a slot still waiting for a workout isn't due yet). Any-time and day-part slots count by
    // day: missed only once the day is over.
    if (date < today || isTaken || (!isFlexible(moment) && time !== null && time <= now)) {
      due += 1;
      if (isTaken) taken += 1;
    }
  }
  return { due, taken, allTaken, slots: slots.length };
}

const window = (due: number, taken: number): AdherenceWindow => ({ due, taken, rate: due ? taken / due : null });

/**
 * Streaks over days oldest → newest. A day with no slots neither counts nor
 * breaks; today counts once complete and never breaks while in progress.
 */
function streaks(days: DayCount[]): { current: number; best: number } {
  let run = 0;
  let best = 0;
  days.forEach((day, i) => {
    const isToday = i === days.length - 1;
    if (day.slots === 0) return;
    if (day.allTaken) run += 1;
    else if (!isToday) run = 0;
    best = Math.max(best, run);
  });
  return { current: run, best };
}

/** How far back streaks look. */
export const HISTORY_DAYS = 365;

export function computeAdherence(meds: Medication[], statuses: StatusIndex, today: string, now: string, factsOf: (date: string) => DayFacts = () => NO_FACTS) {
  const dates = Array.from({ length: HISTORY_DAYS }, (_, i) => addDays(today, i - HISTORY_DAYS + 1));
  const facts = dates.map(factsOf);
  const perMed = meds.map((med) => ({ med, days: dates.map((date, i) => countDay(med, date, statuses, today, now, facts[i]!)) }));

  const sum = (days: DayCount[], last: number) => {
    const slice = days.slice(-last);
    return window(
      slice.reduce((n, d) => n + d.due, 0),
      slice.reduce((n, d) => n + d.taken, 0),
    );
  };

  const medications: MedicationAdherence[] = perMed
    .filter(({ days }) => days.some((d) => d.slots > 0))
    .map(({ med, days }) => {
      const { current, best } = streaks(days);
      return { medicationId: med.id, name: med.name, last7: sum(days, 7), last30: sum(days, 30), currentStreak: current, bestStreak: best };
    });

  const combined: DayCount[] = dates.map((_, i) => {
    const day = { due: 0, taken: 0, allTaken: true, slots: 0 };
    for (const { days } of perMed) {
      const d = days[i]!;
      day.due += d.due;
      day.taken += d.taken;
      day.slots += d.slots;
      if (!d.allTaken) day.allTaken = false;
    }
    return day;
  });
  const { current, best } = streaks(combined);
  const days: AdherenceDay[] = dates.slice(-30).map((date, i) => {
    const d = combined[combined.length - 30 + i]!;
    return { date, due: d.due, taken: d.taken };
  });

  return {
    overall: { last7: sum(combined, 7), last30: sum(combined, 30), currentStreak: current, bestStreak: best },
    medications,
    days,
  };
}
