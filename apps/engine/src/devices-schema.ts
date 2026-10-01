import type { Database } from "bun:sqlite";

/** Columns added when browsers could pair. Rows from before read as phones (the column default). */
const ADDED: [table: string, column: string][] = [
  ["devices", "kind TEXT NOT NULL DEFAULT 'phone'"],
  ["devices", "scopes TEXT"],
  ["pairing_codes", "kind TEXT NOT NULL DEFAULT 'phone'"],
];

/** SQLite has no `ADD COLUMN IF NOT EXISTS`, so each column is checked first. Runs on every boot. */
export function migrateDevices(database: Database): void {
  for (const [table, column] of ADDED) {
    const existing = database.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
    if (!existing.some((c) => c.name === column.split(" ")[0])) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
  }
}
