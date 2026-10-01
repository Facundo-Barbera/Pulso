import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";

/** `PULSO_DATA_DIR`, or `data/` at the repo root (Next's cwd is apps/engine). */
export function dataDir(): string {
  const configured = process.env.PULSO_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), "..", "..", "data");
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    paired_at INTEGER NOT NULL,
    last_seen_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS pairing_codes (
    code TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workouts (
    id TEXT PRIMARY KEY,
    external_id TEXT UNIQUE,
    source TEXT NOT NULL,
    activity TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    energy REAL,
    distance REAL
  );
  CREATE INDEX IF NOT EXISTS workouts_started ON workouts (started_at DESC);
`;

// One connection per process; Next's dev reloads re-evaluate modules, so it lives on globalThis.
const KEY = "__pulso_db__";

export function db(): Database {
  const g = globalThis as Record<string, unknown>;
  if (g[KEY]) return g[KEY] as Database;
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const database = new Database(path.join(dir, "pulso.sqlite"), { create: true, strict: true });
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  database.exec(SCHEMA);
  g[KEY] = database;
  return database;
}
