/**
 * How often, when, and soft comparisons with the person's own sleep and
 * recovery. `buildSummary` is pure (tested with synthetic data);
 * `substanceSummary` gathers the signals from the other features' stores.
 */
import type { DailyMetrics, Substance, SubstanceCorrelation, SubstanceEntry, SubstanceOverview, SubstanceSummary, SubstanceTimeBucket } from "@pulso/contract";
import { computeReadiness } from "../daily/readiness";
import { listDailyMetrics } from "../daily/store";
import { addDays, isoWeekday, localNow } from "../medication/schedule";
import { listMeals } from "../nutrition/store";
import { listSleepNights } from "../sleep/store";
import { CONTEXTS, FORMS, firstUseDate, getSettings, lastUse, listUses } from "./store";

/** Fewer nights than this on either side and a comparison says nothing. */
export const MIN_SAMPLE = 3;
export const WEEKS = 8;
const LATE_HOUR = 22;
const LEVEL = { poco: 1, normal: 2, mucho: 3 } as const;

/** What the person's data says about one night, keyed by the date they woke up. Null = no data. */
export type NightSignals = {
  night: string;
  sleepMinutes: number | null;
  sleepScore: number | null;
  hrv: number | null;
  restingHr: number | null;
  readiness: number | null;
  /** Ate after 22:00 (or before 04:00); null when nothing was logged that evening. */
  lateEating: boolean | null;
};

export const weekStart = (date: string) => addDays(date, 1 - isoWeekday(date));

/**
 * The night a use belongs to, as the date of waking up: from noon to 05:59 the
 * next morning. A morning use has no night.
 */
export function nightOfUse(date: string, time: string): string | null {
  if (time < "06:00") return date;
  if (time >= "12:00") return addDays(date, 1);
  return null;
}

function bucketOf(time: string): SubstanceTimeBucket["key"] {
  if (time < "06:00") return "madrugada";
  if (time < "12:00") return "manana";
  if (time < "18:00") return "tarde";
  return "noche";
}

const BUCKETS: { key: SubstanceTimeBucket["key"]; label: string }[] = [
  { key: "manana", label: "Mañana" },
  { key: "tarde", label: "Tarde" },
  { key: "noche", label: "Noche" },
  { key: "madrugada", label: "Madrugada" },
];

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const round = (value: number | null, decimals = 0) => (value === null ? null : Math.round(value * 10 ** decimals) / 10 ** decimals);

function duration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}

type Spec = {
  key: SubstanceCorrelation["key"];
  label: string;
  unit: string;
  pick: (n: NightSignals) => number | null;
  /** Small differences read as "about the same". */
  text: (diff: number, withUse: number, withoutUse: number) => string;
};

const SPECS: Spec[] = [
  {
    key: "sleep_minutes",
    label: "Tiempo dormido",
    unit: "min",
    pick: (n) => n.sleepMinutes,
    text: (diff) => (Math.abs(diff) < 5 ? "En noches con consumo dormiste más o menos lo mismo que en las demás" : `En noches con consumo dormiste ${duration(Math.abs(diff))} ${diff > 0 ? "más" : "menos"} en promedio`),
  },
  {
    key: "sleep_score",
    label: "Puntuación de sueño",
    unit: "pts",
    pick: (n) => n.sleepScore,
    text: (diff) => (Math.abs(diff) < 2 ? "En noches con consumo tu puntuación de sueño fue parecida a la de las demás" : `En noches con consumo tu puntuación de sueño fue ${Math.round(Math.abs(diff))} puntos ${diff > 0 ? "más alta" : "más baja"} en promedio`),
  },
  {
    key: "hrv",
    label: "VFC a la mañana siguiente",
    unit: "ms",
    pick: (n) => n.hrv,
    text: (diff) => (Math.abs(diff) < 2 ? "Tras noches con consumo tu VFC fue parecida a la de las demás" : `Tras noches con consumo tu VFC fue ${Math.round(Math.abs(diff))} ms ${diff > 0 ? "más alta" : "más baja"} en promedio`),
  },
  {
    key: "resting_hr",
    label: "Pulso en reposo a la mañana siguiente",
    unit: "lpm",
    pick: (n) => n.restingHr,
    text: (diff) => (Math.abs(diff) < 1 ? "Tras noches con consumo tu pulso en reposo fue parecido al de las demás" : `Tras noches con consumo tu pulso en reposo fue ${Math.round(Math.abs(diff))} lpm ${diff > 0 ? "más alto" : "más bajo"} en promedio`),
  },
  {
    key: "readiness",
    label: "Recuperación al día siguiente",
    unit: "pts",
    pick: (n) => n.readiness,
    text: (diff) => (Math.abs(diff) < 3 ? "Al día siguiente tu recuperación fue parecida a la de otros días" : `Al día siguiente tu recuperación fue ${Math.round(Math.abs(diff))} puntos ${diff > 0 ? "más alta" : "más baja"} en promedio`),
  },
  {
    key: "late_eating",
    label: "Comer tarde",
    unit: "%",
    pick: (n) => (n.lateEating === null ? null : n.lateEating ? 100 : 0),
    text: (_diff, withUse, withoutUse) => `Comiste después de las ${LATE_HOUR}:00 en el ${Math.round(withUse)} % de las noches con consumo y en el ${Math.round(withoutUse)} % de las demás`,
  },
];

export function correlate(nights: NightSignals[], usedNights: Set<string>): SubstanceCorrelation[] {
  return SPECS.map((spec) => {
    const withValues: number[] = [];
    const withoutValues: number[] = [];
    for (const n of nights) {
      const value = spec.pick(n);
      if (value === null) continue;
      (usedNights.has(n.night) ? withValues : withoutValues).push(value);
    }
    const withUse = mean(withValues);
    const withoutUse = mean(withoutValues);
    const diff = withUse !== null && withoutUse !== null ? withUse - withoutUse : null;
    const enough = withValues.length >= MIN_SAMPLE && withoutValues.length >= MIN_SAMPLE;
    const sample = ` (${withValues.length} con · ${withoutValues.length} sin)`;
    return {
      key: spec.key,
      label: spec.label,
      unit: spec.unit,
      withUse: round(withUse, 1),
      withoutUse: round(withoutUse, 1),
      diff: round(diff, 1),
      nWith: withValues.length,
      nWithout: withoutValues.length,
      enough,
      text: enough && diff !== null ? spec.text(diff, withUse!, withoutUse!) + sample : null,
    };
  });
}

export type SummaryInput = {
  substance: Substance;
  today: string;
  /** Every use of `substance` inside the window (any order). */
  entries: SubstanceEntry[];
  firstUse: string | null;
  lastUse: { date: string; time: string } | null;
  maxDaysPerWeek: number | null;
  nights: NightSignals[];
  drinkDays?: number;
};

export function buildSummary(input: SummaryInput): SubstanceSummary {
  const { today, entries, firstUse } = input;
  const thisWeek = weekStart(today);
  const from = addDays(thisWeek, -7 * (WEEKS - 1));

  const byDay = new Map<string, SubstanceEntry[]>();
  for (const e of entries) if (e.date >= from && e.date <= today) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);

  const days: SubstanceSummary["days"] = [];
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const uses = byDay.get(d) ?? [];
    days.push({ date: d, uses: uses.length, level: uses.reduce<0 | 1 | 2 | 3>((max, e) => Math.max(max, LEVEL[e.amount]) as 0 | 1 | 2 | 3, 0) });
  }

  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const start = addDays(from, 7 * i);
    const end = addDays(start, 6);
    return { weekStart: start, days: days.filter((d) => d.date >= start && d.date <= end && d.uses > 0).length };
  });
  const daysThisWeek = weeks[WEEKS - 1]!.days;
  // Full weeks since logging began; a week before the first use says nothing about frequency.
  const counted = firstUse ? weeks.slice(0, -1).filter((w) => addDays(w.weekStart, 6) >= firstUse) : [];
  const avgDaysPerWeek = round(mean(counted.map((w) => w.days)), 1);

  let daysWithout: number | null = null;
  if (input.lastUse) {
    daysWithout = 0;
    for (let d = today; d > input.lastUse.date; d = addDays(d, -1)) daysWithout++;
  }
  let longestWithout = 0;
  let run = 0;
  for (const d of days) {
    if (!firstUse || d.date < firstUse) continue;
    run = d.uses > 0 ? 0 : run + 1;
    longestWithout = Math.max(longestWithout, run);
  }

  const inWindow = entries.filter((e) => e.date >= from && e.date <= today);
  const timeOfDay = BUCKETS.map((b) => ({ ...b, uses: inWindow.filter((e) => bucketOf(e.time) === b.key).length }));
  const byForm = FORMS.map((form) => ({ form, uses: inWindow.filter((e) => e.form === form).length })).filter((f) => f.uses > 0);
  const byContext = CONTEXTS.map((context) => ({ context, uses: inWindow.filter((e) => e.context === context).length })).filter((c) => c.uses > 0);

  const usedNights = new Set(entries.map((e) => nightOfUse(e.date, e.time)).filter((n): n is string => n !== null));
  // Nights before the first logged use are not "without": the person was not logging yet.
  const nights = firstUse ? input.nights.filter((n) => n.night >= firstUse && n.night <= today) : [];

  return {
    substance: input.substance,
    today,
    days,
    weeks,
    avgDaysPerWeek,
    daysThisWeek,
    daysWithout,
    longestWithout,
    lastUse: input.lastUse,
    timeOfDay,
    byForm,
    byContext,
    goal: input.maxDaysPerWeek === null ? null : { maxDaysPerWeek: input.maxDaysPerWeek, daysThisWeek, within: daysThisWeek <= input.maxDaysPerWeek },
    correlations: correlate(nights, usedNights),
    ...(input.drinkDays === undefined ? {} : { drinkDays: input.drinkDays }),
  };
}

/** Sleep, recovery and late eating for every night from `from` to `to` (wake dates). */
export function nightSignals(from: string, to: string): NightSignals[] {
  const sleep = new Map(listSleepNights(from, to).map((n) => [n.night, n]));
  const metrics = listDailyMetrics(addDays(from, -28), to);
  const byDate = new Map<string, DailyMetrics>(metrics.map((d) => [d.date, d]));
  const evenings = new Set<string>();
  const late = new Set<string>();
  for (const meal of listMeals(addDays(from, -1), to)) {
    evenings.add(meal.date);
    const at = new Date(meal.eatenAt);
    const local = localNow(at);
    if (at.getHours() >= LATE_HOUR) late.add(addDays(local.date, 1));
    else if (at.getHours() < 4) late.add(local.date);
  }
  const out: NightSignals[] = [];
  for (let night = from; night <= to; night = addDays(night, 1)) {
    const day = byDate.get(night);
    const s = sleep.get(night);
    const readiness = day ? computeReadiness(night, day, metrics).score : null;
    out.push({
      night,
      sleepMinutes: s?.minutes.asleep ?? day?.sleepMinutes ?? null,
      sleepScore: s?.score.value ?? null,
      hrv: day?.hrv ?? null,
      restingHr: day?.restingHeartRate ?? null,
      readiness,
      lateEating: late.has(night) ? true : evenings.has(addDays(night, -1)) ? false : null,
    });
  }
  return out;
}

/** Days with an alcoholic drink logged in Dieta, so drinks are not logged twice. */
function drinkDaysBetween(from: string, to: string): number {
  return new Set(listMeals(from, to).filter((m) => (m.alcoholG ?? 0) > 0).map((m) => m.date)).size;
}

export function substanceSummary(substance: Substance = "cannabis", today = localNow().date): SubstanceSummary {
  const from = addDays(weekStart(today), -7 * (WEEKS - 1));
  return buildSummary({
    substance,
    today,
    entries: listUses(from, today, substance),
    firstUse: firstUseDate(substance),
    lastUse: lastUse(substance),
    maxDaysPerWeek: getSettings().maxDaysPerWeek,
    nights: nightSignals(from, today),
    drinkDays: substance === "alcohol" ? drinkDaysBetween(from, today) : undefined,
  });
}

/** What the phone and the web page draw. */
export function substanceOverview(substance: Substance = "cannabis", today = localNow().date): SubstanceOverview {
  return { summary: substanceSummary(substance, today), entries: listUses(addDays(today, -59), today, substance), settings: getSettings() };
}
