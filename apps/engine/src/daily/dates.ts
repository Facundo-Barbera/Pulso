import type { DateString } from "@pulso/contract";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (value: unknown): value is DateString =>
  typeof value === "string" && DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

/** Local calendar date of `at` (the Mac's timezone, which is the person's). */
export function localDate(at: Date = new Date()): DateString {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** `date` shifted by `days` calendar days. */
export function addDays(date: DateString, days: number): DateString {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
