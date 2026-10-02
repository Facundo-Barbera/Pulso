import type { Database } from "bun:sqlite";
import { linkDuplicates } from "./workouts-dedupe";

/** Columns added after the first release of `workouts`. */
const ADDED_COLUMNS = ["source_bundle TEXT", "source_name TEXT", "duplicate_of TEXT", "external_ref TEXT", "avg_hr REAL", "max_hr REAL", "heart_rate TEXT"];

/**
 * Brings `workouts` up to date on every boot, for fresh and existing databases
 * alike: SQLite has no `ADD COLUMN IF NOT EXISTS`, so each column is checked
 * first. Then links duplicates already stored (the person's own database has
 * years of double-recorded sessions).
 */
export function migrateWorkouts(database: Database): void {
  const existing = new Set(database.query<{ name: string }, []>("PRAGMA table_info(workouts)").all().map((c) => c.name));
  for (const column of ADDED_COLUMNS) {
    if (!existing.has(column.split(" ")[0]!)) database.exec(`ALTER TABLE workouts ADD COLUMN ${column}`);
  }
  database.exec("CREATE INDEX IF NOT EXISTS workouts_canonical ON workouts (started_at DESC) WHERE duplicate_of IS NULL");
  linkDuplicates(database);
}
