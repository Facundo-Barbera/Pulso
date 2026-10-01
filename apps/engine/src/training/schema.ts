import { LIBRARY } from "./library";

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

// Upsert, not ignore: renaming an exercise in library.ts reaches existing databases on the next boot.
const SEED = LIBRARY.map(
  (e) =>
    `INSERT INTO exercises (id, name, muscle, secondary, equipment, kind) VALUES (${[e.id, e.name, e.muscle, JSON.stringify(e.secondary), e.equipment, e.kind].map(quote).join(", ")})
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, muscle = excluded.muscle, secondary = excluded.secondary, equipment = excluded.equipment, kind = excluded.kind;`,
).join("\n");

/** Exercise library, programs (days → prescribed exercises) and logged sessions with their sets. */
export const TRAINING_SCHEMA = `
  CREATE TABLE IF NOT EXISTS exercises (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    muscle TEXT NOT NULL,
    secondary TEXT NOT NULL DEFAULT '[]',
    equipment TEXT NOT NULL,
    kind TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS programs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    goal TEXT NOT NULL,
    weeks INTEGER NOT NULL,
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS program_days (
    id TEXT PRIMARY KEY,
    program_id TEXT NOT NULL REFERENCES programs (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    focus TEXT,
    weekday INTEGER
  );
  CREATE TABLE IF NOT EXISTS program_exercises (
    id TEXT PRIMARY KEY,
    day_id TEXT NOT NULL REFERENCES program_days (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    exercise_id TEXT NOT NULL REFERENCES exercises (id),
    sets INTEGER NOT NULL,
    rep_min INTEGER NOT NULL,
    rep_max INTEGER NOT NULL,
    target_rpe REAL,
    target_rir INTEGER,
    rest_seconds INTEGER NOT NULL,
    notes TEXT
  );
  CREATE TABLE IF NOT EXISTS training_sessions (
    id TEXT PRIMARY KEY,
    program_id TEXT,
    day_id TEXT,
    name TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    notes TEXT
  );
  CREATE TABLE IF NOT EXISTS set_logs (
    session_id TEXT NOT NULL REFERENCES training_sessions (id) ON DELETE CASCADE,
    exercise_id TEXT NOT NULL REFERENCES exercises (id),
    set_index INTEGER NOT NULL,
    weight_kg REAL NOT NULL,
    reps INTEGER NOT NULL,
    rpe REAL,
    done_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, exercise_id, set_index)
  );
  CREATE INDEX IF NOT EXISTS program_days_program ON program_days (program_id, position);
  CREATE INDEX IF NOT EXISTS program_exercises_day ON program_exercises (day_id, position);
  CREATE INDEX IF NOT EXISTS training_sessions_started ON training_sessions (started_at DESC);
  CREATE INDEX IF NOT EXISTS set_logs_exercise ON set_logs (exercise_id);
  ${SEED}
`;
