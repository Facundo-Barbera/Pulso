/** Devices, pairing codes and workouts synced from HealthKit. */
export const CORE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    paired_at INTEGER NOT NULL,
    last_seen_at INTEGER,
    kind TEXT NOT NULL DEFAULT 'phone',
    scopes TEXT
  );
  CREATE TABLE IF NOT EXISTS pairing_codes (
    code TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'phone'
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
