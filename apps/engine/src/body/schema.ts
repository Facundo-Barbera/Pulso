/**
 * Body scans (InBody and manual), HealthKit weight/fat samples, goals, and QR
 * payloads we could not parse. Scan value columns are the snake_case of
 * `BodyScanValues` (see `FIELDS` in store.ts); segmental values are JSON.
 */
export const BODY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS body_scans (
    id TEXT PRIMARY KEY,
    external_id TEXT UNIQUE,
    source TEXT NOT NULL,
    device TEXT,
    measured_at INTEGER NOT NULL,
    weight REAL,
    skeletal_muscle_mass REAL,
    body_fat_mass REAL,
    percent_body_fat REAL,
    bmi REAL,
    visceral_fat_level REAL,
    bmr REAL,
    total_body_water REAL,
    ecw_ratio REAL,
    inbody_score REAL,
    soft_lean_mass REAL,
    protein REAL,
    mineral REAL,
    bone_mineral_content REAL,
    body_cell_mass REAL,
    intracellular_water REAL,
    extracellular_water REAL,
    smi REAL,
    waist_hip_ratio REAL,
    waist_circumference REAL,
    visceral_fat_area REAL,
    phase_angle REAL,
    segmental_lean TEXT,
    segmental_fat TEXT,
    segmental_ecw TEXT,
    raw TEXT
  );
  CREATE INDEX IF NOT EXISTS body_scans_measured ON body_scans (measured_at DESC);
  CREATE TABLE IF NOT EXISTS body_samples (
    external_id TEXT PRIMARY KEY,
    metric TEXT NOT NULL,
    value REAL NOT NULL,
    measured_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS body_samples_metric ON body_samples (metric, measured_at);
  CREATE TABLE IF NOT EXISTS body_goals (
    metric TEXT PRIMARY KEY,
    target REAL NOT NULL,
    set_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS inbody_payloads (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL UNIQUE,
    error TEXT NOT NULL,
    received_at INTEGER NOT NULL
  );
`;
