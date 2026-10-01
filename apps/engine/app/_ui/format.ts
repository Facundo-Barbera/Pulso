/** Spanish formatting for the web app. Server components format here, so the browser's timezone never changes what renders. */
const number = new Intl.NumberFormat("es");
const weekdayDate = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" });
const shortDate = new Intl.DateTimeFormat("es", { day: "numeric", month: "short" });
const shortWeekday = new Intl.DateTimeFormat("es", { weekday: "short", day: "numeric" });
const time = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" });
const relative = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

export const fmtNumber = (value: number, decimals = 0) => number.format(Number(value.toFixed(decimals)));

/** "miércoles, 1 de octubre" */
export const fmtLongDate = (at: Date | number) => weekdayDate.format(at);
/** "1 oct" */
export const fmtShortDate = (at: Date | number) => shortDate.format(at);
/** "mié 1" */
export const fmtDayLabel = (date: string) => shortWeekday.format(new Date(`${date}T12:00:00`));
/** "07:30" */
export const fmtTime = (at: Date | number) => time.format(at);

/** 452 → "7 h 32 min"; 45 → "45 min" */
export function fmtMinutes(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/** "hace 3 min", "ayer", "hace 2 días" */
export function fmtAgo(at: number, now = Date.now()): string {
  const seconds = Math.round((at - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86_400], ["hour", 3_600], ["minute", 60]];
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return "ahora mismo";
}

/** The greeting for the hour, on the Mac's clock. */
export function greeting(at = new Date()): string {
  const hour = at.getHours();
  return hour < 6 ? "Buenas noches" : hour < 13 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";
}
