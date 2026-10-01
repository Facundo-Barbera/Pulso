/**
 * Pure date math: schedules into dose slots, and slots plus logged events into
 * adherence and streaks. Everything works on local "YYYY-MM-DD" / "HH:MM"
 * strings that the phone sends, so the engine never guesses a time zone.
 */
import type { AdherenceDay, AdherenceWindow, DoseStatus, Medication, MedicationAdherence } from "@pulso/contract";

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

/** The local date and "HH:MM" of an instant, in this process's time zone. */
export function localNow(at = new Date()): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  };
}

type Schedulable = Pick<Medication, "schedule" | "startDate" | "endDate" | "active">;

/** Sorted slot times for one med on one date; none for as-needed, inactive or out-of-range meds. */
export function slotTimes(med: Schedulable, date: string): string[] {
  const { schedule } = med;
  if (!med.active || schedule.asNeeded) return [];
  if (date < med.startDate || (med.endDate && date > med.endDate)) return [];
  if (schedule.days.length > 0 && !schedule.days.includes(isoWeekday(date))) return [];
  return [...new Set(schedule.times)].sort();
}

/** `medicationId|date|time` → status, for the events of scheduled slots. */
export type StatusIndex = Map<string, DoseStatus>;
export const slotKey = (medicationId: string, date: string, time: string) => `${medicationId}|${date}|${time}`;

type DayCount = { due: number; taken: number; /** every slot of the day, due or not, is taken */ allTaken: boolean; slots: number };

function countDay(med: Medication, date: string, statuses: StatusIndex, today: string, now: string): DayCount {
  const times = slotTimes(med, date);
  let due = 0;
  let taken = 0;
  let allTaken = true;
  for (const time of times) {
    const isTaken = statuses.get(slotKey(med.id, date, time)) === "tomada";
    if (!isTaken) allTaken = false;
    // A dose taken early counts as soon as it's taken; otherwise only once its time has come.
    if (date < today || time <= now || isTaken) {
      due += 1;
      if (isTaken) taken += 1;
    }
  }
  return { due, taken, allTaken, slots: times.length };
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

export function computeAdherence(meds: Medication[], statuses: StatusIndex, today: string, now: string) {
  const dates = Array.from({ length: HISTORY_DAYS }, (_, i) => addDays(today, i - HISTORY_DAYS + 1));
  const perMed = meds.map((med) => ({ med, days: dates.map((date) => countDay(med, date, statuses, today, now)) }));

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
