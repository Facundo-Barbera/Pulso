/**
 * Suggestions to put a schedule on an as-needed medication that is really
 * taken on a rhythm: logged at about the same time every day, or about once a
 * week, or a drug usually taken that way. Pure: reads meds and logged events,
 * never changes anything — the person decides in the editor.
 */
import { DEFAULT_ANY_TIME_REMINDER, type DoseEvent, type Medication, type MedicationSchedule, type ScheduleNudge } from "@pulso/contract";
import { addDays, fromMinutes, isoWeekday, localNow, toMinutes } from "./schedule";

/** How far back the patterns look. */
export const NUDGE_LOOKBACK_DAYS = 35;

/** Daily: taken on at least this many of the last DAILY_WINDOW days, each within DAILY_SPREAD of the usual time. */
const DAILY_WINDOW = 10;
const DAILY_MIN_DAYS = 5;
const DAILY_SPREAD = 90;
/** Weekly: at least this many intakes, each 6–8 days after the one before. */
const WEEKLY_MIN = 3;

/** `anyTime`: the drug is taken some time on its day, not at an hour (weekly injections). */
type Known = { cadence: "daily" | "weekly"; time: string; anyTime?: boolean; instructions: string | null; detail: (time: string, day: number) => string };

const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábados", "domingos"];
const WEEKDAY = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const weekly = (time: string, day: number) => `Una vez por semana · los ${WEEKDAYS[day - 1]} a las ${time}`;

/** Drugs whose usual rhythm is well known, matched on the name (brand or generic). */
const KNOWN: { match: RegExp; unless?: RegExp; rule: Known }[] = [
  {
    match: /levotirox|eutirox|levothyrox|synthroid|tirosint|\btiroxina/i,
    rule: { cadence: "daily", time: "07:30", instructions: "en ayunas", detail: (time) => `En ayunas al despertar · ${time}` },
  },
  {
    // Oral semaglutide (Rybelsus) is daily: leave it to the pattern.
    match: /semaglut|ozempic|wegovy|tirzepat|mounjaro|zepbound|dulaglut|trulicity/i,
    unless: /rybelsus|comprimido|oral/i,
    rule: { cadence: "weekly", time: "10:00", anyTime: true, instructions: null, detail: (_, day) => `Semanal · ${WEEKDAY[day - 1]} · cualquier hora` },
  },
];

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const roundTo5 = (minutes: number) => Math.round(minutes / 5) * 5;

/** The most frequent weekday among dates; ties go to the most recent. */
function usualWeekday(dates: string[]): number {
  const counts = new Map<number, number>();
  for (const d of dates) counts.set(isoWeekday(d), (counts.get(isoWeekday(d)) ?? 0) + 1);
  const latest = isoWeekday([...dates].sort().at(-1)!);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] === latest ? -1 : b[0] === latest ? 1 : 0))[0]![0];
}

type Intake = { date: string; minutes: number };

function dailyPattern(intakes: Intake[], today: string): string | null {
  const recent = intakes.filter((i) => i.date > addDays(today, -DAILY_WINDOW));
  const firstPerDay = [...new Map(recent.map((i) => [i.date, i])).values()];
  if (firstPerDay.length < DAILY_MIN_DAYS) return null;
  const usual = median(firstPerDay.map((i) => i.minutes));
  if (firstPerDay.some((i) => Math.abs(i.minutes - usual) > DAILY_SPREAD)) return null;
  return fromMinutes(roundTo5(usual));
}

function weeklyPattern(intakes: Intake[]): { day: number; time: string } | null {
  const days = [...new Set(intakes.map((i) => i.date))].sort();
  if (days.length < WEEKLY_MIN) return null;
  for (let i = 1; i < days.length; i++) {
    const gap = (Date.parse(days[i]!) - Date.parse(days[i - 1]!)) / 86_400_000;
    if (gap < 6 || gap > 8) return null;
  }
  return { day: usualWeekday(days), time: fromMinutes(roundTo5(median(intakes.map((i) => i.minutes)))) };
}

const NONE: MedicationSchedule = { asNeeded: false, times: [], days: [], interval: null, monthDay: null, training: null, meals: [], bedtime: false, windows: [], anyTime: false, reminder: null };
const scheduleFor = (time: string, days: number[]): MedicationSchedule => ({ ...NONE, times: [time], days });
/** Due all day on its days, with the gentle evening reminder. */
const anyTimeOn = (days: number[]): MedicationSchedule => ({ ...NONE, days, anyTime: true, reminder: DEFAULT_ANY_TIME_REMINDER });

/**
 * One nudge per active as-needed medication that looks scheduled. `events` are
 * the logged doses of the last NUDGE_LOOKBACK_DAYS days (any status; only
 * taken ones count).
 */
export function scheduleNudges(meds: Medication[], events: DoseEvent[], today: string): ScheduleNudge[] {
  const nudges: ScheduleNudge[] = [];
  for (const med of meds) {
    if (!med.active || !med.schedule.asNeeded) continue;
    const intakes: Intake[] = events
      .filter((e) => e.medicationId === med.id && e.status === "tomada" && e.takenAt !== null && e.date > addDays(today, -NUDGE_LOOKBACK_DAYS))
      .map((e) => ({ date: e.date, minutes: toMinutes(localNow(new Date(e.takenAt!)).time) }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.minutes - b.minutes);
    const typical = intakes.length ? fromMinutes(roundTo5(median(intakes.map((i) => i.minutes)))) : null;
    const base = { medicationId: med.id, name: med.name };

    const known = KNOWN.find((k) => k.match.test(med.name) && !(k.unless && k.unless.test(`${med.name} ${med.form ?? ""} ${med.unit}`)))?.rule;
    if (known) {
      const time = typical ?? known.time;
      const day = intakes.length ? usualWeekday(intakes.map((i) => i.date)) : isoWeekday(today);
      nudges.push({
        ...base,
        cadence: known.cadence,
        reason: "known",
        title: `${med.name} ${known.cadence === "daily" ? "parece diaria" : "parece semanal"}. ¿Ponerle horario?`,
        detail: known.detail(time, day),
        schedule: known.anyTime ? anyTimeOn([day]) : scheduleFor(time, known.cadence === "weekly" ? [day] : []),
        instructions: med.instructions ? null : known.instructions,
      });
      continue;
    }

    const daily = dailyPattern(intakes, today);
    if (daily) {
      nudges.push({ ...base, cadence: "daily", reason: "pattern", title: `${med.name} parece diaria. ¿Ponerle horario?`, detail: `Todos los días a las ${daily}, como la vienes tomando`, schedule: scheduleFor(daily, []), instructions: null });
      continue;
    }
    const week = weeklyPattern(intakes);
    if (week) {
      nudges.push({ ...base, cadence: "weekly", reason: "pattern", title: `${med.name} parece semanal. ¿Ponerle horario?`, detail: weekly(week.time, week.day), schedule: scheduleFor(week.time, [week.day]), instructions: null });
    }
  }
  return nudges;
}
