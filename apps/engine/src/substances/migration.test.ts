import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { migrateSubstances, SUBSTANCES_SCHEMA } from "./schema";

/** The tables as the first release left them: the substance as an enum and one global goal. */
const FIRST_RELEASE = `
  CREATE TABLE substance_entries (
    id TEXT PRIMARY KEY, substance TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, form TEXT, amount TEXT NOT NULL,
    count INTEGER, thc_mg REAL, context TEXT, note TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX substance_entries_date ON substance_entries (substance, date, time);
  CREATE TABLE substance_settings (id INTEGER PRIMARY KEY CHECK (id = 1), max_days_per_week INTEGER, updated_at INTEGER NOT NULL);
  INSERT INTO substance_entries VALUES ('a', 'cannabis', '2026-09-20', '22:00', 'fumado', 'normal', 2, NULL, NULL, NULL, 1, 1);
  INSERT INTO substance_entries VALUES ('b', 'nicotina', '2026-09-21', '10:00', NULL, 'poco', NULL, NULL, NULL, 'un cigarro', 1, 1);
  INSERT INTO substance_entries VALUES ('c', 'alcohol', '2026-09-22', '21:00', NULL, 'mucho', NULL, NULL, 'social', NULL, 1, 1);
  INSERT INTO substance_settings VALUES (1, 2, 1);
`;

function upgrade(database: Database) {
  // What every boot does: the schema (idempotent), then the migration.
  database.exec(SUBSTANCES_SCHEMA);
  migrateSubstances(database, 5);
}

test("the first release's enum and global goal become rows, keeping every entry", () => {
  const database = new Database(":memory:", { strict: true });
  database.exec(FIRST_RELEASE);
  upgrade(database);
  upgrade(database);

  const substances = database.query<{ id: string; name: string; archived: number; builtin: number; max_days_per_week: number | null }, []>(
    "SELECT id, name, archived, builtin, max_days_per_week FROM substances ORDER BY archived, position",
  ).all();
  expect(substances).toEqual([
    { id: "cannabis", name: "Cannabis", archived: 0, builtin: 1, max_days_per_week: 2 },
    { id: "alcohol", name: "Alcohol", archived: 0, builtin: 1, max_days_per_week: null },
    // Nicotina is no longer a default; its history stays as an archived substance of its own.
    { id: "nicotina", name: "Nicotina", archived: 1, builtin: 0, max_days_per_week: null },
  ]);
  expect(database.query<{ id: string; substance_id: string; count: number | null }, []>("SELECT id, substance_id, count FROM substance_entries ORDER BY id").all()).toEqual([
    { id: "a", substance_id: "cannabis", count: 2 },
    { id: "b", substance_id: "nicotina", count: null },
    { id: "c", substance_id: "alcohol", count: null },
  ]);
  expect(database.query("SELECT * FROM substance_settings").all()).toEqual([]);
  expect(database.query<{ name: string }, []>("PRAGMA index_list(substance_entries)").all().map((i) => i.name)).toContain("substance_entries_date");
});

test("a fresh install gets the two built-ins; an archived built-in stays archived on the next boot", () => {
  const database = new Database(":memory:", { strict: true });
  upgrade(database);
  expect(database.query<{ id: string }, []>("SELECT id FROM substances ORDER BY position").all().map((r) => r.id)).toEqual(["cannabis", "alcohol"]);
  database.exec("UPDATE substances SET archived = 1 WHERE id = 'alcohol'");
  upgrade(database);
  expect(database.query<{ archived: number }, []>("SELECT archived FROM substances WHERE id = 'alcohol'").get()?.archived).toBe(1);
});
