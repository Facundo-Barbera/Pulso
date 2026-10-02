import type { Database } from "bun:sqlite";

/**
 * Sustancias: the substances the person tracks (Cannabis and Alcohol seeded,
 * any of their own), each use, and which web clients may show it
 * (`device_key` = a paired device's id, or "mac" for this Mac). Dates are
 * local "YYYY-MM-DD", times "HH:MM". `substance_settings` only holds the old
 * global goal until `migrateSubstances` moves it onto Cannabis.
 */
export const SUBSTANCES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS substances (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    symbol TEXT,
    unit TEXT NOT NULL,
    forms TEXT NOT NULL DEFAULT '[]',
    max_days_per_week INTEGER,
    archived INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    builtin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS substance_entries (
    id TEXT PRIMARY KEY,
    substance_id TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    form TEXT,
    amount TEXT NOT NULL,
    count REAL,
    thc_mg REAL,
    context TEXT,
    note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
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

const BUILTINS = [
  { id: "cannabis", name: "Cannabis", unit: "sesiones", forms: ["fumado", "vapeado", "comestible", "otro"] },
  { id: "alcohol", name: "Alcohol", unit: "tragos", forms: [] as string[] },
];

/**
 * Idempotent, on every boot. The first release kept the substance as an enum
 * in `substance_entries.substance`; it becomes `substance_id` pointing at a
 * row. Cannabis and Alcohol are seeded (an archived one stays archived); any
 * other id already used (nicotina) becomes an archived substance of its own so
 * its history stays readable; the old global goal moves onto Cannabis.
 */
export function migrateSubstances(database: Database, now = Date.now()): void {
  const columns = database.query<{ name: string }, []>("PRAGMA table_info(substance_entries)").all().map((c) => c.name);
  if (columns.includes("substance") && !columns.includes("substance_id")) database.exec("ALTER TABLE substance_entries RENAME COLUMN substance TO substance_id");
  database.exec("CREATE INDEX IF NOT EXISTS substance_entries_date ON substance_entries (substance_id, date, time)");

  const insert = database.query(
    "INSERT OR IGNORE INTO substances (id, name, symbol, unit, forms, archived, position, builtin, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)",
  );
  BUILTINS.forEach((b, i) => insert.run(b.id, b.name, b.unit, JSON.stringify(b.forms), 0, i, 1, now, now));

  const orphans = database
    .query<{ id: string }, []>("SELECT DISTINCT substance_id AS id FROM substance_entries WHERE substance_id NOT IN (SELECT id FROM substances)")
    .all();
  for (const { id } of orphans) {
    const next = database.query<{ p: number | null }, []>("SELECT MAX(position) AS p FROM substances").get()?.p ?? -1;
    insert.run(id, id.charAt(0).toUpperCase() + id.slice(1), "veces", "[]", 1, next + 1, 0, now, now);
  }

  const old = database.query<{ max: number | null }, []>("SELECT max_days_per_week AS max FROM substance_settings WHERE id = 1").get();
  if (old) {
    if (old.max !== null) database.query("UPDATE substances SET max_days_per_week = COALESCE(max_days_per_week, ?) WHERE id = 'cannabis'").run(old.max);
    database.exec("DELETE FROM substance_settings");
  }
}
