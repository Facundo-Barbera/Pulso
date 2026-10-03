import type { CoachBriefKind } from "@pulso/contract";

/** The morning brief is not written before this local hour. */
export const BRIEF_HOUR = 6;
/** Until this hour the morning brief waits for last night's sleep to arrive from the phone. */
export const SLEEP_WAIT_HOUR = 10;
/** Once written, the day's brief is rewritten every hour so it follows the day (meals, training, doses)… */
export const DAILY_REFRESH_MS = 60 * 60_000;
/** …until this local hour; after it the evening is left alone. */
export const DAILY_REFRESH_UNTIL_HOUR = 22;
/** A missed Sunday check-in is still written on the following days, up to this many. */
export const WEEKLY_GRACE_DAYS = 1;

const pad = (n: number) => String(n).padStart(2, "0");

/** The Mac's local date, YYYY-MM-DD. */
export const localDate = (at: Date) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The most recent local Sunday on or before `at`: the last day of the Monday–Sunday week a check-in covers. */
export const lastSunday = (at: Date) => addDays(localDate(at), -at.getDay());

/** The period a brief of `kind` written at `at` belongs to. */
export const periodFor = (kind: CoachBriefKind, at: Date) => (kind === "daily" ? localDate(at) : lastSunday(at));

/**
 * Which briefs should exist by `at`. `sleptToday` says last night's sleep has
 * reached the Mac, so the morning brief can read it.
 */
export function dueBriefs(at: Date, { sleptToday }: { sleptToday: boolean }): { kind: CoachBriefKind; period: string }[] {
  const due: { kind: CoachBriefKind; period: string }[] = [];
  const hour = at.getHours();
  if (hour >= BRIEF_HOUR && (sleptToday || hour >= SLEEP_WAIT_HOUR)) due.push({ kind: "daily", period: localDate(at) });
  const sinceSunday = at.getDay();
  if ((sinceSunday === 0 && hour >= BRIEF_HOUR) || (sinceSunday > 0 && sinceSunday <= WEEKLY_GRACE_DAYS)) {
    due.push({ kind: "weekly", period: lastSunday(at) });
  }
  return due;
}
