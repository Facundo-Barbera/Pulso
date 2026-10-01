export const DAY_MS = 86_400_000;

/** The engine's local calendar day for an instant. The Mac and the phone share a timezone. */
export function localDate(ms = Date.now()): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * When something happened, from what the person said: "14:30" / "14.30" / "14h30" on
 * `date` (default today), or an ISO 8601 date-time (local unless it has an offset).
 * Null when it can't be read.
 */
export function parseTime(at: string, date?: string): { at: number; date: string } | null {
  const clock = /^(\d{1,2})[:.h](\d{2})$/.exec(at.trim());
  if (clock) {
    const [hour, minute] = [Number(clock[1]), Number(clock[2])];
    if (hour > 23 || minute > 59) return null;
    const [y, m, d] = (date ?? localDate()).split("-").map(Number) as [number, number, number];
    const ms = new Date(y, m - 1, d, hour, minute).getTime();
    return { at: ms, date: date ?? localDate(ms) };
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(at.trim())) return null;
  const ms = Date.parse(at.trim());
  return Number.isNaN(ms) ? null : { at: ms, date: date ?? localDate(ms) };
}
