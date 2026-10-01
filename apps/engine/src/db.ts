import { Database } from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SCHEMAS } from "./schemas";
import { migrateWorkouts } from "./workouts-schema";

/** Pulso's home, like Telar's: `PULSO_HOME`, or ~/Library/Application Support/Pulso (shared with the Electron shell's userData). */
export function pulsoHome(): string {
  const configured = process.env.PULSO_HOME?.trim();
  return configured ? path.resolve(configured) : path.join(os.homedir(), "Library", "Application Support", "Pulso");
}

/** Where the engine keeps its data: `PULSO_DATA_DIR` (tests, scratch copies), or `<home>/engine`. */
export function dataDir(): string {
  const configured = process.env.PULSO_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(pulsoHome(), "engine");
}

// One connection per process; Next's dev reloads re-evaluate modules, so it lives on globalThis.
const KEY = "__pulso_db__";

export function db(): Database {
  const g = globalThis as Record<string, unknown>;
  if (g[KEY]) return g[KEY] as Database;
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const database = new Database(path.join(dir, "pulso.sqlite"), { create: true, strict: true });
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  for (const schema of SCHEMAS) database.exec(schema);
  migrateWorkouts(database);
  g[KEY] = database;
  return database;
}
