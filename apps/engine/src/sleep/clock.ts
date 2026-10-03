/**
 * Turns "23:30"-style local clock times into instants for a night, the way a
 * person says them the morning after: the wake time is today (or the latest
 * past one), and the bedtime is the last time that clock read before waking,
 * so 23:30 before a 07:00 wake is the previous day. The Mac's timezone is the
 * person's.
 */
import { isDate, localDate } from "../daily/dates";

export const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)$/;

const parse = (clock: string): [number, number] => {
  const m = CLOCK.exec(clock.trim());
  if (!m) throw new Error(`"${clock}" is not a HH:MM time`);
  return [Number(m[1]), Number(m[2])];
};

/** Epoch ms of `clock` on the local calendar `date` (DST-safe: built from local fields). */
export function atLocal(date: string, clock: string): number {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = parse(clock);
  return new Date(y, mo - 1, d, h, mi).getTime();
}

const shiftDays = (date: string, days: number) => {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return localDate(new Date(y, mo - 1, d + days, 12));
};

/** The last moment the clock read `clock` strictly before `end`. */
export function lastBefore(end: number, clock: string): number {
  const day = localDate(new Date(end));
  const same = atLocal(day, clock);
  return same < end ? same : atLocal(shiftDays(day, -1), clock);
}

/**
 * Wake instant: `now` when no time is given; else `clock` on `date` (local
 * YYYY-MM-DD), or without a date the latest past time the clock read it.
 */
export function wakeAt(clock: string | undefined, date: string | undefined, now: number): number {
  if (date !== undefined && !isDate(date)) throw new Error(`"${date}" is not YYYY-MM-DD`);
  if (!clock) {
    if (date && date !== localDate(new Date(now))) throw new Error("wakeTime is needed for a day other than today");
    return now;
  }
  if (date) return atLocal(date, clock);
  const today = atLocal(localDate(new Date(now)), clock);
  // A few minutes ahead is a rounded "just now", not yesterday.
  return today <= now + 5 * 60_000 ? today :atLocal(shiftDays(localDate(new Date(now)), -1), clock);
}

/** Start and end of a night from what the person said. */
export function resolveNight(input: { asleepTime: string; wakeTime?: string; wakeDate?: string }, now: number): { start: number; end: number } {
  const end = wakeAt(input.wakeTime, input.wakeDate, now);
  return { start: lastBefore(end, input.asleepTime), end };
}
