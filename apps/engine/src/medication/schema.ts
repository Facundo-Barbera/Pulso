/** Medications/supplements and what happened to each dose. Dates are local "YYYY-MM-DD", times "HH:MM". */
export const MEDICATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS medications (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    dose REAL NOT NULL,
    unit TEXT NOT NULL,
    form TEXT,
    instructions TEXT,
    schedule TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT,
    stock REAL,
    low_stock_threshold REAL,
    active INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS medication_doses (
    id TEXT PRIMARY KEY,
    medication_id TEXT NOT NULL REFERENCES medications (id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    scheduled_time TEXT,
    status TEXT NOT NULL,
    taken_at INTEGER,
    logged_at INTEGER NOT NULL,
    UNIQUE (medication_id, date, scheduled_time)
  );
  CREATE INDEX IF NOT EXISTS medication_doses_date ON medication_doses (date);
`;
