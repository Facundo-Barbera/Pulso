/**
 * Sustancias: uses of cannabis, alcohol or nicotine, the person's own weekly
 * limit, and which web clients may show it (`device_key` = a paired device's
 * id, or "mac" for this Mac). Dates are local "YYYY-MM-DD", times "HH:MM".
 */
export const SUBSTANCES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS substance_entries (
    id TEXT PRIMARY KEY,
    substance TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    form TEXT,
    amount TEXT NOT NULL,
    count INTEGER,
    thc_mg REAL,
    context TEXT,
    note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS substance_entries_date ON substance_entries (substance, date, time);
  CREATE TABLE IF NOT EXISTS substance_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    max_days_per_week INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS substance_visibility (
    device_key TEXT PRIMARY KEY,
    visible INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;
