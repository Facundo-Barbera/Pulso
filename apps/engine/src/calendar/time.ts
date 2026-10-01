/**
 * Local date and time strings. The phone sends the person's own dates and
 * times; instants stored by other features (epoch ms) are read in the Mac's
 * time zone, which is the person's.
 */
export const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const DAY_MS = 86_400_000;
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const pad = (n: number) => String(n).padStart(2, "0");

export const addDays = (date: string, days: number) => new Date(utc(date) + days * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / DAY_MS);

/** 1 = lunes … 7 = domingo. */
export const isoWeekday = (date: string) => new Date(utc(date)).getUTCDay() || 7;

/** Monday of the week holding `date`. */
export const weekStart = (date: string) => addDays(date, 1 - isoWeekday(date));

/** Every date from `from` to `to`, inclusive. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "HH:MM" → minutes after midnight. */
export const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
/** Minutes after midnight → "HH:MM" (clamped to the day). */
export const clock = (min: number) => {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)));
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

/** The local date and "HH:MM" of an instant. */
export function local(at: number | Date = new Date()): { date: string; time: string } {
  const d = typeof at === "number" ? new Date(at) : at;
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** "YYYY-MM-DDTHH:MM" of an instant. */
export const localDateTime = (at: number) => {
  const { date, time } = local(at);
  return `${date}T${time}`;
};

/** Local midnight of `date`, as epoch ms. */
export const startOfDay = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!).getTime();
};

/** True when [aStart, aEnd) and [bStart, bEnd) overlap, all in minutes. */
export const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;
