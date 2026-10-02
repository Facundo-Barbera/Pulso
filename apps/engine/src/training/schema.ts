import type { Database } from "bun:sqlite";
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
  -- Which ExerciseDB exercise shows each library exercise. Only the id: their terms forbid storing media.
  -- source_id NULL with verified = 1 means the person rejected the match.
  CREATE TABLE IF NOT EXISTS exercise_media (
    exercise_id TEXT PRIMARY KEY REFERENCES exercises (id),
    source TEXT NOT NULL,
    source_id TEXT,
    attribution TEXT,
    score REAL NOT NULL DEFAULT 0,
    verified INTEGER NOT NULL DEFAULT 0,
    matched_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS exercise_notes (
    exercise_id TEXT PRIMARY KEY REFERENCES exercises (id),
    notes TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  -- "Solo hoy": a day's exercise list for one local date (YYYY-MM-DD), as ProgramExercise JSON.
  CREATE TABLE IF NOT EXISTS program_day_overrides (
    day_id TEXT NOT NULL REFERENCES program_days (id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    exercises TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (day_id, date)
  );
  CREATE TABLE IF NOT EXISTS training_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  -- The unit an exercise's machine or plates use ('kg' | 'lb'); missing = the default unit. Weights stay kg.
  CREATE TABLE IF NOT EXISTS exercise_units (
    exercise_id TEXT PRIMARY KEY REFERENCES exercises (id),
    unit TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cardio_logs (
    session_id TEXT NOT NULL REFERENCES training_sessions (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    exercise_id TEXT NOT NULL REFERENCES exercises (id),
    duration_seconds INTEGER NOT NULL,
    distance_km REAL,
    level REAL,
    incline_percent REAL,
    avg_hr REAL,
    kcal REAL,
    done_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, position)
  );
  -- The session in progress (at most one), as LiveSession JSON; the phone and the Coach both write it.
  CREATE TABLE IF NOT EXISTS live_sessions (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    version INTEGER NOT NULL,
    thread_id TEXT,
    updated_at INTEGER NOT NULL
  );
  -- A week of a block begun before its calendar Monday ("empezar la semana ya"). Missing = it starts on its Monday.
  CREATE TABLE IF NOT EXISTS program_week_starts (
    program_id TEXT NOT NULL REFERENCES programs (id) ON DELETE CASCADE,
    week INTEGER NOT NULL,
    starts_at INTEGER NOT NULL,
    PRIMARY KEY (program_id, week)
  );
  -- The Coach's review of the next workout. \`since\` is the last session before it (or ''), so a row
  -- belongs to one upcoming session; \`key\` is that session plus the signals that fired, for dedupe.
  CREATE TABLE IF NOT EXISTS session_adjustments (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    program_id TEXT NOT NULL,
    day_id TEXT NOT NULL,
    since TEXT NOT NULL,
    status TEXT NOT NULL,
    decided_by TEXT,
    no_change INTEGER NOT NULL DEFAULT 0,
    rationale TEXT,
    signals TEXT NOT NULL DEFAULT '[]',
    changes TEXT NOT NULL DEFAULT '[]',
    dismissed INTEGER NOT NULL DEFAULT 0,
    thread_id TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS session_adjustments_day ON session_adjustments (day_id, since, created_at DESC);
  CREATE INDEX IF NOT EXISTS program_days_program ON program_days (program_id, position);
  CREATE INDEX IF NOT EXISTS program_exercises_day ON program_exercises (day_id, position);
  CREATE INDEX IF NOT EXISTS training_sessions_started ON training_sessions (started_at DESC);
  CREATE INDEX IF NOT EXISTS set_logs_exercise ON set_logs (exercise_id);
  ${SEED}
`;

/** Columns added after the first release; SQLite has no ADD COLUMN IF NOT EXISTS. */
export function migrateTraining(database: Database): void {
  const existing = new Set(database.query<{ name: string }, []>("PRAGMA table_info(program_exercises)").all().map((c) => c.name));
  for (const column of ["cardio TEXT", "weight_kg REAL", "weight_set_at INTEGER", "superset_id TEXT"]) {
    if (!existing.has(column.split(" ")[0]!)) database.exec(`ALTER TABLE program_exercises ADD COLUMN ${column}`);
  }
  // A set's segments after the top one (weight_kg/reps), as SetSegment JSON; NULL = a plain set.
  const sets = new Set(database.query<{ name: string }, []>("PRAGMA table_info(set_logs)").all().map((c) => c.name));
  if (!sets.has("drops")) database.exec("ALTER TABLE set_logs ADD COLUMN drops TEXT");
  // Programs are blocks: switching ends one (ended_at, end_reason) instead of just deactivating it.
  const programs = new Set(database.query<{ name: string }, []>("PRAGMA table_info(programs)").all().map((c) => c.name));
  for (const column of ["ended_at INTEGER", "end_reason TEXT", "resumed_from TEXT"]) {
    if (!programs.has(column.split(" ")[0]!)) database.exec(`ALTER TABLE programs ADD COLUMN ${column}`);
  }
  // Programs replaced before blocks existed and trained on become ended blocks, ending when the next one began.
  database.exec(`
    UPDATE programs SET ended_at = COALESCE(
      (SELECT MIN(n.created_at) FROM programs n WHERE n.created_at > programs.created_at),
      (SELECT MAX(t.ended_at) FROM training_sessions t JOIN program_days d ON d.id = t.day_id WHERE d.program_id = programs.id))
    WHERE active = 0 AND ended_at IS NULL
      AND EXISTS (SELECT 1 FROM training_sessions t JOIN program_days d ON d.id = t.day_id WHERE d.program_id = programs.id)
  `);
}
