import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import { SCHEMAS } from "./schemas";

/** `PULSO_DATA_DIR`, or `data/` at the repo root (Next's cwd is apps/engine). */
export function dataDir(): string {
  const configured = process.env.PULSO_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), "..", "..", "data");
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
  g[KEY] = database;
  return database;
}
