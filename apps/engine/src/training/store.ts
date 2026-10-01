import { randomUUID } from "node:crypto";
import type {
  ActiveProgramResponse,
  Exercise,
  ExerciseDetail,
  ExerciseHistory,
  ExercisePerformance,
  HistoryPoint,
  LoadSuggestion,
  PersonalRecord,
  Program,
  ProgramDay,
  ProgramExercise,
  ProgramInput,
  SessionInput,
  SessionSaved,
  SetLog,
  TrainingSession,
} from "@pulso/contract";
import { db } from "../db";
import { ANATOMY } from "./anatomy";
import { INCREMENT_KG } from "./library";
import { bests, nextLoad, performance, recordsFor, type Prescription } from "./math";
import { mediaFor, mediaSourceOf } from "./media";
import { TECHNIQUE } from "./technique";
import { VIDEOS } from "./videos";

/** A caller error: the message says what to fix. */
export class TrainingError extends Error {}

// ── Exercises ────────────────────────────────────────────────────────────────

type ExerciseRow = Omit<Exercise, "secondary"> & { secondary: string };
const toExercise = (r: ExerciseRow): Exercise => ({ ...r, secondary: JSON.parse(r.secondary) });

export function listExercises(filter: { muscle?: string; equipment?: string; query?: string } = {}): Exercise[] {
  const rows = db().query<ExerciseRow, []>("SELECT id, name, muscle, secondary, equipment, kind FROM exercises ORDER BY muscle, name").all();
  const q = filter.query?.trim().toLowerCase();
  return rows
    .map(toExercise)
    .filter((e) => !filter.muscle || e.muscle === filter.muscle || e.secondary.includes(filter.muscle as Exercise["muscle"]))
    .filter((e) => !filter.equipment || e.equipment === filter.equipment)
    .filter((e) => !q || e.name.toLowerCase().includes(q) || e.id.includes(q));
}

export function getExercise(id: string): Exercise | undefined {
  const row = db().query<ExerciseRow, [string]>("SELECT id, name, muscle, secondary, equipment, kind FROM exercises WHERE id = ?").get(id);
  return row ? toExercise(row) : undefined;
}

// ── Exercise screen ──────────────────────────────────────────────────────────

/** Everything the exercise screen shows: curated muscles, technique and videos, media, the person's notes. */
export function exerciseDetail(id: string): ExerciseDetail | undefined {
  const exercise = getExercise(id);
  if (!exercise) return undefined;
  const anatomy = ANATOMY[id];
  return {
    ...exercise,
    nameEn: anatomy?.nameEn ?? null,
    primaryMuscles: anatomy?.primary ?? [],
    secondaryMuscles: anatomy?.secondary ?? [],
    instructions: TECHNIQUE[id]?.instructions ?? [],
    tips: TECHNIQUE[id]?.tips ?? [],
    media: mediaFor(id, mediaSourceOf(id) !== undefined),
    videos: VIDEOS[id] ?? [],
    notes: db().query<{ notes: string }, [string]>("SELECT notes FROM exercise_notes WHERE exercise_id = ?").get(id)?.notes ?? null,
  };
}

/** Replaces the person's notes on an exercise; blank clears them. Returns what is stored. */
export function setExerciseNotes(id: string, notes: string | null, now = Date.now()): string | null {
  if (!getExercise(id)) throw new TrainingError(`Unknown exercise id: ${id}.`);
  const text = notes?.trim() || null;
  if (text) {
    db()
      .query("INSERT INTO exercise_notes (exercise_id, notes, updated_at) VALUES (?, ?, ?) ON CONFLICT (exercise_id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at")
      .run(id, text, now);
  } else {
    db().query("DELETE FROM exercise_notes WHERE exercise_id = ?").run(id);
  }
  return text;
}

/** Records and per-session history on one exercise, from every logged session. */
export function exercisePerformance(id: string): ExercisePerformance | undefined {
  if (!getExercise(id)) return undefined;
  const sessions = listSessions(Number.MAX_SAFE_INTEGER, id).map((s) => ({ at: s.startedAt, sets: s.sets.filter((set) => set.exerciseId === id) }));
  return performance(id, sessions);
}

// ── Programs ─────────────────────────────────────────────────────────────────

/** Checks a program before anything is written, so a bad one leaves no trace. */
function validateProgram(input: ProgramInput): void {
  if (!input.name.trim()) throw new TrainingError("The program needs a name.");
  if (input.days.length === 0) throw new TrainingError("The program needs at least one day.");
  const known = new Set(listExercises().map((e) => e.id));
  const unknown = new Set<string>();
  for (const day of input.days) {
    if (day.exercises.length === 0) throw new TrainingError(`Day "${day.name}" has no exercises.`);
    if (day.weekday != null && (day.weekday < 1 || day.weekday > 7)) throw new TrainingError(`Day "${day.name}": weekday must be 1 (Monday) to 7 (Sunday).`);
    for (const ex of day.exercises) {
      if (!known.has(ex.exerciseId)) unknown.add(ex.exerciseId);
      if (ex.repMin > ex.repMax) throw new TrainingError(`${ex.exerciseId}: repMin (${ex.repMin}) is above repMax (${ex.repMax}).`);
    }
  }
  if (unknown.size) throw new TrainingError(`Unknown exercise ids: ${[...unknown].join(", ")}. Use ids from list_exercises.`);
}

/** Writes a whole program. With `activate`, it becomes the only active one. */
export function createProgram(input: ProgramInput, activate = true, now = Date.now()): Program {
  validateProgram(input);
  const database = db();
  const id = randomUUID();
  database.transaction(() => {
    if (activate) database.run("UPDATE programs SET active = 0 WHERE active = 1");
    database.run("INSERT INTO programs (id, name, goal, weeks, notes, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      id,
      input.name.trim(),
      input.goal,
      input.weeks,
      input.notes ?? null,
      activate ? 1 : 0,
      now,
    ]);
    input.days.forEach((day, d) => {
      const dayId = randomUUID();
      database.run("INSERT INTO program_days (id, program_id, position, name, focus, weekday) VALUES (?, ?, ?, ?, ?, ?)", [
        dayId,
        id,
        d,
        day.name,
        day.focus ?? null,
        day.weekday ?? null,
      ]);
      day.exercises.forEach((ex, p) => {
        database.run(
          `INSERT INTO program_exercises (id, day_id, position, exercise_id, sets, rep_min, rep_max, target_rpe, target_rir, rest_seconds, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [randomUUID(), dayId, p, ex.exerciseId, ex.sets, ex.repMin, ex.repMax, ex.targetRpe ?? null, ex.targetRir ?? null, ex.restSeconds, ex.notes ?? null],
        );
      });
    });
  })();
  return getProgram(id)!;
}

type ProgramRow = { id: string; name: string; goal: string; weeks: number; notes: string | null; active: number; created_at: number };
type DayRow = { id: string; name: string; focus: string | null; weekday: number | null };
type ProgramExerciseRow = {
  id: string;
  day_id: string;
  exercise_id: string;
  exercise_name: string;
  equipment: Exercise["equipment"];
  sets: number;
  rep_min: number;
  rep_max: number;
  target_rpe: number | null;
  target_rir: number | null;
  rest_seconds: number;
  notes: string | null;
};

export function getProgram(id: string): Program | undefined {
  const row = db().query<ProgramRow, [string]>("SELECT * FROM programs WHERE id = ?").get(id);
  if (!row) return undefined;
  const days = db().query<DayRow, [string]>("SELECT id, name, focus, weekday FROM program_days WHERE program_id = ? ORDER BY position").all(id);
  const exercises = db()
    .query<ProgramExerciseRow, [string]>(
      `SELECT pe.*, e.name AS exercise_name, e.equipment FROM program_exercises pe
       JOIN program_days d ON d.id = pe.day_id JOIN exercises e ON e.id = pe.exercise_id
       WHERE d.program_id = ? ORDER BY pe.position`,
    )
    .all(id);
  const toExercise = (r: ProgramExerciseRow): ProgramExercise => ({
    id: r.id,
    exerciseId: r.exercise_id,
    exerciseName: r.exercise_name,
    equipment: r.equipment,
    sets: r.sets,
    repMin: r.rep_min,
    repMax: r.rep_max,
    targetRpe: r.target_rpe,
    targetRir: r.target_rir,
    restSeconds: r.rest_seconds,
    notes: r.notes,
  });
  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    weeks: row.weeks,
    notes: row.notes,
    active: row.active === 1,
    createdAt: row.created_at,
    days: days.map((d): ProgramDay => ({ ...d, exercises: exercises.filter((e) => e.day_id === d.id).map(toExercise) })),
  };
}

export function getActiveProgram(): Program | undefined {
  const row = db().query<{ id: string }, []>("SELECT id FROM programs WHERE active = 1 ORDER BY created_at DESC LIMIT 1").get();
  return row ? getProgram(row.id) : undefined;
}

/** ISO weekday (1 = Monday … 7 = Sunday) in the Mac's local time, which is the person's. */
const isoWeekday = (at: number) => ((new Date(at).getDay() + 6) % 7) + 1;

/**
 * The day to train next: one pinned to today's weekday, else the day after
 * the last one done from this program, else the first.
 */
export function nextDay(program: Program, now = Date.now()): ProgramDay | undefined {
  const pinned = program.days.find((d) => d.weekday === isoWeekday(now));
  if (pinned) return pinned;
  const last = db()
    .query<{ day_id: string }, [string]>("SELECT day_id FROM training_sessions WHERE program_id = ? AND day_id IS NOT NULL ORDER BY started_at DESC LIMIT 1")
    .get(program.id);
  const index = program.days.findIndex((d) => d.id === last?.day_id);
  return program.days[index === -1 ? 0 : (index + 1) % program.days.length];
}

// ── Sessions ─────────────────────────────────────────────────────────────────

type SessionRow = { id: string; program_id: string | null; day_id: string | null; name: string; started_at: number; ended_at: number; notes: string | null };
type SetRow = { session_id: string; exercise_id: string; set_index: number; weight_kg: number; reps: number; rpe: number | null; done_at: number };

const toSet = (r: SetRow): SetLog => ({ exerciseId: r.exercise_id, setIndex: r.set_index, weightKg: r.weight_kg, reps: r.reps, rpe: r.rpe, doneAt: r.done_at });

function withSets(rows: SessionRow[]): TrainingSession[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const sets = db()
    .query<SetRow, string[]>(`SELECT * FROM set_logs WHERE session_id IN (${ids.map(() => "?").join(",")}) ORDER BY done_at, set_index`)
    .all(...ids);
  return rows.map((r) => ({
    id: r.id,
    programId: r.program_id,
    dayId: r.day_id,
    name: r.name,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    notes: r.notes,
    sets: sets.filter((s) => s.session_id === r.id).map(toSet),
  }));
}

export function listSessions(limit = 20, exerciseId?: string): TrainingSession[] {
  const rows = exerciseId
    ? db()
        .query<SessionRow, [string, number]>(
          "SELECT * FROM training_sessions WHERE id IN (SELECT session_id FROM set_logs WHERE exercise_id = ?) ORDER BY started_at DESC LIMIT ?",
        )
        .all(exerciseId, limit)
    : db().query<SessionRow, [number]>("SELECT * FROM training_sessions ORDER BY started_at DESC LIMIT ?").all(limit);
  return withSets(rows);
}

export function getSession(id: string): TrainingSession | undefined {
  const row = db().query<SessionRow, [string]>("SELECT * FROM training_sessions WHERE id = ?").get(id);
  return row ? withSets([row])[0] : undefined;
}

/** Every set on an exercise from sessions that started before `before`. */
function setsBefore(exerciseId: string, before: number): SetLog[] {
  return db()
    .query<SetRow, [string, number]>(
      "SELECT s.* FROM set_logs s JOIN training_sessions t ON t.id = s.session_id WHERE s.exercise_id = ? AND t.started_at < ?",
    )
    .all(exerciseId, before)
    .map(toSet);
}

/**
 * Saves a finished session, replacing any earlier copy with the same id (the
 * phone retries), and returns the records it set against older sessions.
 */
export function saveSession(input: SessionInput): SessionSaved {
  const known = new Set(listExercises().map((e) => e.id));
  const unknown = [...new Set(input.sets.map((s) => s.exerciseId).filter((id) => !known.has(id)))];
  if (unknown.length) throw new TrainingError(`Unknown exercise ids: ${unknown.join(", ")}. Use ids from list_exercises.`);
  if (input.endedAt < input.startedAt) throw new TrainingError("endedAt is before startedAt.");

  const database = db();
  database.transaction(() => {
    database.run("DELETE FROM training_sessions WHERE id = ?", [input.id]);
    database.run("INSERT INTO training_sessions (id, program_id, day_id, name, started_at, ended_at, notes) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      input.id,
      input.programId ?? null,
      input.dayId ?? null,
      input.name,
      input.startedAt,
      input.endedAt,
      input.notes ?? null,
    ]);
    // Re-index per exercise so (session, exercise, set_index) is unique whatever the client sent.
    const counts = new Map<string, number>();
    for (const s of input.sets) {
      const index = counts.get(s.exerciseId) ?? 0;
      counts.set(s.exerciseId, index + 1);
      database.run("INSERT INTO set_logs (session_id, exercise_id, set_index, weight_kg, reps, rpe, done_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
        input.id,
        s.exerciseId,
        index,
        s.weightKg,
        s.reps,
        s.rpe ?? null,
        s.doneAt,
      ]);
    }
  })();

  const session = getSession(input.id)!;
  const prs: PersonalRecord[] = [];
  for (const exerciseId of new Set(session.sets.map((s) => s.exerciseId))) {
    const exercise = getExercise(exerciseId)!;
    prs.push(...recordsFor(exercise, session.sets.filter((s) => s.exerciseId === exerciseId), setsBefore(exerciseId, session.startedAt)));
  }
  return { session, prs };
}

// ── History and suggestions ──────────────────────────────────────────────────

export function exerciseHistory(exerciseId: string, limit = 50): ExerciseHistory | undefined {
  const exercise = getExercise(exerciseId);
  if (!exercise) return undefined;
  const points = listSessions(limit, exerciseId)
    .map((session): HistoryPoint => {
      const sets = session.sets.filter((s) => s.exerciseId === exerciseId);
      const best = bests(sets);
      return {
        sessionId: session.id,
        date: session.startedAt,
        topWeightKg: best.weight,
        bestE1rm: best.e1rm,
        totalReps: sets.reduce((n, s) => n + s.reps, 0),
        volumeKg: sets.reduce((n, s) => n + s.weightKg * s.reps, 0),
        sets,
      };
    })
    .reverse();
  const all = bests(setsBefore(exerciseId, Number.MAX_SAFE_INTEGER));
  return { exercise, points, bestE1rm: all.e1rm || null, heaviestKg: all.weight || null };
}

export function suggestLoad(exerciseId: string, rx: Prescription): LoadSuggestion {
  const exercise = getExercise(exerciseId);
  if (!exercise) throw new TrainingError(`Unknown exercise id: ${exerciseId}.`);
  const [last] = listSessions(1, exerciseId);
  const lastWork = last ? { at: last.startedAt, sets: last.sets.filter((s) => s.exerciseId === exerciseId) } : null;
  return nextLoad(exerciseId, rx, lastWork, INCREMENT_KG[exercise.equipment]);
}

/** Suggestions for every exercise of a day, keyed by `ProgramExercise.id`. */
export function suggestDay(day: ProgramDay): Record<string, LoadSuggestion> {
  return Object.fromEntries(day.exercises.map((ex) => [ex.id, suggestLoad(ex.exerciseId, ex)]));
}

/** What the phone's Entreno tab opens with. */
export function activeProgramView(now = Date.now()): ActiveProgramResponse {
  const program = getActiveProgram();
  if (!program) return { program: null, nextDayId: null, suggestions: {} };
  return {
    program,
    nextDayId: nextDay(program, now)?.id ?? null,
    suggestions: Object.assign({}, ...program.days.map(suggestDay)),
  };
}
