import type { DailyMetrics, DailyMetricsInput, DateString, Readiness } from "@pulso/contract";
import { db } from "../db";
import { addDays, isDate } from "./dates";
import { BASELINE_DAYS, computeReadiness } from "./readiness";

type Row = {
  date: string;
  steps: number | null;
  active_energy: number | null;
  exercise_minutes: number | null;
  resting_heart_rate: number | null;
  hrv: number | null;
  sleep_minutes: number | null;
  sleep_deep: number | null;
  sleep_core: number | null;
  sleep_rem: number | null;
  sleep_awake: number | null;
  vo2max: number | null;
  respiratory_rate: number | null;
  resting_heart_rate_estimated: number;
  exercise_minutes_estimated: number;
  updated_at: number;
};

/** Contract field → column, in insert order. */
const COLUMNS = {
  steps: "steps",
  activeEnergy: "active_energy",
  exerciseMinutes: "exercise_minutes",
  restingHeartRate: "resting_heart_rate",
  hrv: "hrv",
  sleepMinutes: "sleep_minutes",
  sleepDeep: "sleep_deep",
  sleepCore: "sleep_core",
  sleepRem: "sleep_rem",
  sleepAwake: "sleep_awake",
  vo2max: "vo2max",
  respiratoryRate: "respiratory_rate",
} as const satisfies Record<Exclude<keyof DailyMetricsInput, "date" | "restingHeartRateEstimated" | "exerciseMinutesEstimated">, keyof Row>;

const FIELDS = Object.keys(COLUMNS) as (keyof typeof COLUMNS)[];

/** Estimated flag → its column, and the field and column of the value it qualifies. */
const FLAGS = {
  restingHeartRateEstimated: { column: "resting_heart_rate_estimated", field: "restingHeartRate", value: "resting_heart_rate" },
  exerciseMinutesEstimated: { column: "exercise_minutes_estimated", field: "exerciseMinutes", value: "exercise_minutes" },
} as const satisfies Record<string, { column: keyof Row; field: keyof typeof COLUMNS; value: keyof Row }>;

const FLAG_FIELDS = Object.keys(FLAGS) as (keyof typeof FLAGS)[];

const toMetrics = (row: Row): DailyMetrics => {
  const metrics = { date: row.date, updatedAt: row.updated_at } as DailyMetrics;
  for (const field of FIELDS) metrics[field] = row[COLUMNS[field]];
  for (const flag of FLAG_FIELDS) metrics[flag] = row[FLAGS[flag].column] === 1;
  return metrics;
};

/** Days in [from, to], oldest first. */
export function listDailyMetrics(from: DateString, to: DateString): DailyMetrics[] {
  return db()
    .query<Row, [string, string]>("SELECT * FROM daily_metrics WHERE date BETWEEN ? AND ? ORDER BY date")
    .all(from, to)
    .map(toMetrics);
}

/**
 * Upsert by date. A null field keeps the stored value, so a partial sync (say,
 * the watch hadn't uploaded HRV yet) never erases what an earlier one wrote.
 * An estimated flag travels with its value: a new value replaces the flag, no value keeps it.
 */
export function upsertDailyMetrics(inputs: DailyMetricsInput[], now = Date.now()): number {
  const columns = FIELDS.map((f) => COLUMNS[f]);
  const flags = FLAG_FIELDS.map((f) => FLAGS[f]);
  const all = [...columns, ...flags.map((f) => f.column)];
  const statement = db().query(
    `INSERT INTO daily_metrics (date, ${all.join(", ")}, updated_at)
     VALUES (${["?", ...all.map(() => "?"), "?"].join(", ")})
     ON CONFLICT (date) DO UPDATE SET
       ${columns.map((c) => `${c} = COALESCE(excluded.${c}, daily_metrics.${c})`).join(", ")},
       ${flags.map((f) => `${f.column} = CASE WHEN excluded.${f.value} IS NULL THEN daily_metrics.${f.column} ELSE excluded.${f.column} END`).join(", ")},
       updated_at = excluded.updated_at`,
  );
  const write = db().transaction((items: DailyMetricsInput[]) => {
    for (const item of items) statement.run(item.date, ...FIELDS.map((f) => item[f]), ...FLAG_FIELDS.map((f) => (item[f] ? 1 : 0)), now);
    return items.length;
  });
  return write(inputs);
}

/** Validates an untrusted `{ days: DailyMetricsInput[] }` from the phone. Undefined when any item is malformed. */
export function parseDailyInputs(body: unknown): DailyMetricsInput[] | undefined {
  const items = (body as { days?: unknown })?.days;
  if (!Array.isArray(items) || items.length > 400) return undefined;
  const parsed: DailyMetricsInput[] = [];
  for (const item of items as Record<string, unknown>[]) {
    if (!isDate(item?.date)) return undefined;
    const day = { date: item.date } as DailyMetricsInput;
    for (const field of FIELDS) {
      const value = item[field];
      if (value === null || value === undefined) day[field] = null;
      else if (typeof value === "number" && Number.isFinite(value) && value >= 0) day[field] = value;
      else return undefined;
    }
    for (const flag of FLAG_FIELDS) {
      const value = item[flag];
      if (value !== undefined && value !== null && typeof value !== "boolean") return undefined;
      day[flag] = value === true && day[FLAGS[flag].field] !== null;
    }
    parsed.push(day);
  }
  return parsed;
}

/** Readiness for `date` from the stored days. */
export function readinessFor(date: DateString): Readiness {
  const days = listDailyMetrics(addDays(date, -BASELINE_DAYS), date);
  return computeReadiness(date, days.find((d) => d.date === date), days);
}
