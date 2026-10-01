/**
 * Busy blocks, calendar preferences (one JSON row), the training sessions and
 * meal times the Coach plans, and health events. Dates local "YYYY-MM-DD",
 * times "HH:MM".
 */
export const CALENDAR_SCHEMA = `
  CREATE TABLE IF NOT EXISTS busy_blocks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    all_day INTEGER NOT NULL,
    date TEXT NOT NULL,
    end_date TEXT,
    start_time TEXT,
    end_time TEXT,
    weekdays TEXT NOT NULL DEFAULT '[]',
    until TEXT,
    source TEXT NOT NULL,
    external_id TEXT UNIQUE,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS calendar_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS planned_sessions (
    id TEXT PRIMARY KEY,
    program_id TEXT,
    day_id TEXT,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    duration_min INTEGER NOT NULL,
    status TEXT NOT NULL,
    reason TEXT,
    conflict TEXT,
    moved_from TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS planned_sessions_date ON planned_sessions (date);
  CREATE TABLE IF NOT EXISTS meal_times (
    date TEXT NOT NULL,
    slot TEXT NOT NULL,
    time TEXT NOT NULL,
    PRIMARY KEY (date, slot)
  );
  CREATE TABLE IF NOT EXISTS health_events (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body_area TEXT,
    severity INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT,
    status TEXT NOT NULL,
    notes TEXT,
    affected_training TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS health_events_start ON health_events (start_date);
`;
