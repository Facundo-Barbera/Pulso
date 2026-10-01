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
