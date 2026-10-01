import type { Database } from "bun:sqlite";

/** One row per local date of Apple Health signals. Units as in `@pulso/contract` `DailyMetrics`. */
export const DAILY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS daily_metrics (
    date TEXT PRIMARY KEY,
    steps REAL,
    active_energy REAL,
    exercise_minutes REAL,
    resting_heart_rate REAL,
    hrv REAL,
    sleep_minutes REAL,
    sleep_deep REAL,
    sleep_core REAL,
    sleep_rem REAL,
    sleep_awake REAL,
    vo2max REAL,
    respiratory_rate REAL,
    updated_at INTEGER NOT NULL
  );
`;

/** Columns added after the first release of `daily_metrics`. */
const ADDED_COLUMNS = ["resting_heart_rate_estimated INTEGER NOT NULL DEFAULT 0", "exercise_minutes_estimated INTEGER NOT NULL DEFAULT 0"];

/** Idempotent, like `migrateWorkouts`: SQLite has no `ADD COLUMN IF NOT EXISTS`, so each column is checked first. */
export function migrateDaily(database: Database): void {
  const existing = new Set(database.query<{ name: string }, []>("PRAGMA table_info(daily_metrics)").all().map((c) => c.name));
  for (const column of ADDED_COLUMNS) {
    if (!existing.has(column.split(" ")[0]!)) database.exec(`ALTER TABLE daily_metrics ADD COLUMN ${column}`);
  }
}
