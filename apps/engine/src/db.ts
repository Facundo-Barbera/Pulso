import { Database } from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrateDaily } from "./daily/schema";
import { migrateDevices } from "./devices-schema";
import { migrateMcp } from "./mcp/schema";
import { SCHEMAS } from "./schemas";
import { migrateTraining } from "./training/schema";
import { migrateWorkouts } from "./workouts-schema";

/** Pulso's home, like Telar's: `PULSO_HOME`, or ~/Library/Application Support/Pulso (shared with the Electron shell's userData). */
export function pulsoHome(): string {
  const configured = process.env.PULSO_HOME?.trim();
  return configured ? path.resolve(configured) : path.join(os.homedir(), "Library", "Application Support", "Pulso");
}

/** Where the engine keeps its data: `PULSO_DATA_DIR` (tests, scratch copies), or `<home>/engine`. */
export function dataDir(): string {
  const configured = process.env.PULSO_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  // `bun test` started outside apps/engine skips its bunfig preload; it once wrote test threads into the person's data.
  if (process.env.NODE_ENV === "test") throw new Error("tests need PULSO_DATA_DIR: run them from apps/engine (bunfig.toml preloads a temp dir)");
  return path.join(pulsoHome(), "engine");
}

// One connection per process; Next's dev reloads re-evaluate modules, so it lives on globalThis.
const KEY = "__pulso_db__";
// A reload that brings new schemas must apply them to the connection it inherits,
// or new code queries tables that don't exist yet. All of it is idempotent.
const APPLIED = "__pulso_db_schemas__";

export function db(): Database {
  const g = globalThis as Record<string, unknown>;
  let database = g[KEY] as Database | undefined;
  if (!database) {
    const dir = dataDir();
    fs.mkdirSync(dir, { recursive: true });
    database = new Database(path.join(dir, "pulso.sqlite"), { create: true, strict: true });
    database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    g[KEY] = database;
  }
  const applied = g[APPLIED] as { database: Database; schemas: string[] } | undefined;
  if (applied?.database !== database || applied.schemas !== SCHEMAS) {
    for (const schema of SCHEMAS) database.exec(schema);
    migrateDevices(database);
    migrateWorkouts(database);
    migrateDaily(database);
    migrateTraining(database);
    migrateMcp(database);
    g[APPLIED] = { database, schemas: SCHEMAS };
  }
  return database;
}
