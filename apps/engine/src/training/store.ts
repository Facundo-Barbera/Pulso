import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type {
  ActiveProgramResponse,
  CardioLog,
  CardioTarget,
  DayEdit,
  DayExerciseInput,
  EditScope,
  Equipment,
  Exercise,
  ExerciseDetail,
  ExerciseChange,
  ExerciseHistory,
  ExercisePerformance,
  HistoryPoint,
  HrZone,
  HrZoneRange,
  LoadSuggestion,
  NextAdjustment,
  PersonalRecord,
  Program,
  ProgramDay,
  ProgramExercise,
  ProgramExerciseInput,
  ProgramInput,
  SessionInput,
  SessionSaved,
  SetLog,
  SetSegment,
  TrainingBlock,
  TrainingSession,
  TrainingSettings,
  WeightUnit,
} from "@pulso/contract";
import { getProfile } from "../agent/profile";
import { addDays, localDate } from "../daily/dates";
import { listDailyMetrics } from "../daily/store";
import { db } from "../db";
import { ANATOMY } from "./anatomy";
import { CARDIO, INCREMENT_KG } from "./library";
import { bests, nextLoad, performance, recordsFor, type Prescription } from "./math";
import { mediaFor, mediaSourceOf } from "./media";
import { repsOf, segmentsOf, volumeOf } from "./segments";
import { supersetIds } from "./superset";
import { TECHNIQUE } from "./technique";
import { VIDEOS } from "./videos";
import { AdjustmentError, adjustmentFor, adjustmentThread, applyChanges, decide, getAdjustment, insertDecided, lastSessionId, type Lookup, setDismissed, validateChanges } from "./adjust";
import { programWeeks } from "./weeks";

/** A caller error: the message says what to fix. */
export class TrainingError extends Error {}
/** Deshacer refused: the program changed since the change being undone. */
export class ProgramConflictError extends TrainingError {}

// ── Exercises ────────────────────────────────────────────────────────────────

type ExerciseRow = Omit<Exercise, "secondary"> & { secondary: string };
const toExercise = (r: ExerciseRow): Exercise => ({ ...r, secondary: JSON.parse(r.secondary), ...(CARDIO[r.id] ? { modality: CARDIO[r.id]!.modality } : {}) });

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

/** A prescription as stored: strength exercises need sets, reps and rest; cardio blocks a target. */
type Rx = Pick<ProgramExercise, "sets" | "repMin" | "repMax" | "targetRpe" | "targetRir" | "restSeconds" | "notes" | "cardio" | "supersetId"> & { weightKg: number | null };

/** Fills in and checks one prescribed exercise against the library row it names. */
function prescribe(ex: ProgramExerciseInput, exercise: Exercise, where: string): Rx {
  const base = { targetRpe: ex.targetRpe ?? null, targetRir: ex.targetRir ?? null, notes: ex.notes ?? null, supersetId: ex.supersetId ?? null };
  if (exercise.kind === "cardio") {
    // A cardio block with no target gets the usual easy default rather than failing a swap.
    const cardio = ex.cardio && Object.values(ex.cardio).some((v) => v != null) ? ex.cardio : { durationMinutes: 20, zone: 2 as const };
    return { ...base, sets: 1, repMin: 1, repMax: 1, restSeconds: 0, cardio, weightKg: null };
  }
  const { sets, repMin, repMax, restSeconds } = ex;
  if (sets == null || repMin == null || repMax == null || restSeconds == null) {
    throw new TrainingError(`${where}${exercise.id}: strength exercises need sets, repMin, repMax and restSeconds.`);
  }
  if (repMin > repMax) throw new TrainingError(`${where}${exercise.id}: repMin (${repMin}) is above repMax (${repMax}).`);
  return { ...base, sets, repMin, repMax, restSeconds, cardio: null, weightKg: ex.weightKg ?? null };
}

/** Checks a day's exercises and returns them with their library rows, superset ids normalized. */
function prescribeDay(name: string, exercises: ProgramExerciseInput[], library: Map<string, Exercise>): { exercise: Exercise; rx: Rx }[] {
  if (exercises.length === 0) throw new TrainingError(`Day "${name}" has no exercises.`);
  const unknown = [...new Set(exercises.map((e) => e.exerciseId).filter((id) => !library.has(id)))];
  if (unknown.length) throw new TrainingError(`Unknown exercise ids: ${unknown.join(", ")}. Use ids from list_exercises.`);
  const checked = exercises.map((ex) => {
    const exercise = library.get(ex.exerciseId)!;
    return { exercise, rx: prescribe(ex, exercise, `Day "${name}": `) };
  });
  const supersets = supersetIds(checked.map(({ exercise, rx }) => ({ kind: exercise.kind, supersetId: rx.supersetId })));
  return checked.map(({ exercise, rx }, i) => ({ exercise, rx: { ...rx, supersetId: supersets[i]! } }));
}

const libraryMap = () => new Map(listExercises().map((e) => [e.id, e]));

/** Checks a program before anything is written, so a bad one leaves no trace. */
function validateProgram(input: ProgramInput): void {
  if (!input.name.trim()) throw new TrainingError("The program needs a name.");
  if (input.days.length === 0) throw new TrainingError("The program needs at least one day.");
  const library = libraryMap();
  for (const day of input.days) {
    if (day.weekday != null && (day.weekday < 1 || day.weekday > 7)) throw new TrainingError(`Day "${day.name}": weekday must be 1 (Monday) to 7 (Sunday).`);
    prescribeDay(day.name, day.exercises, library);
  }
}

function insertProgramExercise(database: Database, id: string, dayId: string, position: number, exerciseId: string, rx: Rx, now: number): void {
  database.run(
    `INSERT INTO program_exercises (id, day_id, position, exercise_id, sets, rep_min, rep_max, target_rpe, target_rir, rest_seconds, notes, cardio, weight_kg, weight_set_at, superset_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, dayId, position, exerciseId, rx.sets, rx.repMin, rx.repMax, rx.targetRpe, rx.targetRir, rx.restSeconds, rx.notes, rx.cardio ? JSON.stringify(rx.cardio) : null, rx.weightKg, rx.weightKg == null ? null : now, rx.supersetId],
  );
}

/**
 * Writes a whole program. With `activate` it becomes the active block: the
 * one before ends (`ended_at`, `input.reason`) and keeps everything it did.
 * Nothing is deleted; history and suggestions are per exercise, so they carry on.
 */
export function createProgram(input: ProgramInput, activate = true, now = Date.now(), resumedFrom: string | null = null): Program {
  validateProgram(input);
  const library = libraryMap();
  const database = db();
  const id = randomUUID();
  database.transaction(() => {
    if (activate) database.run("UPDATE programs SET active = 0, ended_at = ?, end_reason = ? WHERE active = 1", [now, input.reason?.trim() || null]);
    database.run("INSERT INTO programs (id, name, goal, weeks, notes, active, created_at, resumed_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
      id,
      input.name.trim(),
      input.goal,
      input.weeks,
      input.notes ?? null,
      activate ? 1 : 0,
      now,
      resumedFrom,
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
      prescribeDay(day.name, day.exercises, library).forEach(({ exercise, rx }, p) => insertProgramExercise(database, randomUUID(), dayId, p, exercise.id, rx, now));
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
  kind: Exercise["kind"];
  sets: number;
  rep_min: number;
  rep_max: number;
  target_rpe: number | null;
  target_rir: number | null;
  rest_seconds: number;
  notes: string | null;
  cardio: string | null;
  weight_kg: number | null;
  weight_set_at: number | null;
  superset_id: string | null;
  /** Set when the exercise was logged after the hand-set load: the load is spent. */
  logged_since: number | null;
};

const toProgramExercise = (r: ProgramExerciseRow): ProgramExercise => ({
  id: r.id,
  exerciseId: r.exercise_id,
  exerciseName: r.exercise_name,
  equipment: r.equipment,
  kind: r.kind,
  modality: CARDIO[r.exercise_id]?.modality ?? null,
  sets: r.sets,
  repMin: r.rep_min,
  repMax: r.rep_max,
  targetRpe: r.target_rpe,
  targetRir: r.target_rir,
  restSeconds: r.rest_seconds,
  notes: r.notes,
  cardio: r.cardio ? (JSON.parse(r.cardio) as CardioTarget) : null,
  weightKg: r.weight_kg != null && !r.logged_since ? r.weight_kg : null,
  supersetId: r.superset_id,
});

export function getProgram(id: string): Program | undefined {
  const row = db().query<ProgramRow, [string]>("SELECT * FROM programs WHERE id = ?").get(id);
  if (!row) return undefined;
  const days = db().query<DayRow, [string]>("SELECT id, name, focus, weekday FROM program_days WHERE program_id = ? ORDER BY position").all(id);
  const exercises = db()
    .query<ProgramExerciseRow, [string]>(
      `SELECT pe.*, e.name AS exercise_name, e.equipment, e.kind,
         (SELECT 1 FROM set_logs s JOIN training_sessions t ON t.id = s.session_id
          WHERE pe.weight_set_at IS NOT NULL AND s.exercise_id = pe.exercise_id AND t.started_at > pe.weight_set_at LIMIT 1) AS logged_since
       FROM program_exercises pe
       JOIN program_days d ON d.id = pe.day_id JOIN exercises e ON e.id = pe.exercise_id
       WHERE d.program_id = ? ORDER BY pe.position`,
    )
    .all(id);
  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    weeks: row.weeks,
    notes: row.notes,
    active: row.active === 1,
    createdAt: row.created_at,
    days: days.map((d): ProgramDay => ({ ...d, exercises: exercises.filter((e) => e.day_id === d.id).map(toProgramExercise) })),
  };
}

export function getActiveProgram(): Program | undefined {
  const row = db().query<{ id: string }, []>("SELECT id FROM programs WHERE active = 1 ORDER BY created_at DESC LIMIT 1").get();
  return row ? getProgram(row.id) : undefined;
}

// ── Editing a day ────────────────────────────────────────────────────────────

/** The program a day belongs to, or a caller error naming the id. */
function programOfDay(dayId: string): Program {
  const row = db().query<{ program_id: string }, [string]>("SELECT program_id FROM program_days WHERE id = ?").get(dayId);
  const program = row && getProgram(row.program_id);
  if (!program) throw new TrainingError(`Unknown program day id: ${dayId}. Use day ids from get_active_program.`);
  return program;
}

/**
 * Rewrites a day's exercise list in its new order. "always" changes the
 * program: inputs with the `id` of one of the day's exercises update it (its
 * load suggestion follows), others are added, missing ones removed; today's
 * override of the day is dropped so the list shown is the list kept. "today"
 * stores the list as today's override and leaves the program alone.
 */
export function updateProgramDay(dayId: string, edit: DayEdit, now = Date.now()): ActiveProgramResponse {
  editDay(dayId, edit, now);
  return activeProgramView(now);
}

/**
 * Rewrites several days of one program in one write, all or nothing (see
 * updateProgramDay for each day). Returns the program as it is now.
 */
export function updateProgramDays(edits: { dayId: string; exercises: DayExerciseInput[] }[], scope: EditScope, now = Date.now()): Program {
  const ids = new Set(edits.map((e) => e.dayId));
  if (ids.size !== edits.length) throw new TrainingError("Each day can appear only once: put all of a day's changes in its one exercise list.");
  const programs = new Set(edits.map((e) => programOfDay(e.dayId).id));
  if (programs.size > 1) throw new TrainingError("All days must belong to the same program.");
  db().transaction(() => {
    for (const e of edits) editDay(e.dayId, { scope, exercises: e.exercises }, now);
  })();
  return withOverrides(getProgram([...programs][0]!)!, now);
}

/** Days of a program as they are, to put back with restoreProgramDays: each one's own list and today's one-off list. */
export type ProgramDaysSnapshot = {
  programId: string;
  /** The local date `override` is for. */
  date: string;
  days: { dayId: string; exercises: DayExerciseInput[]; override: ProgramExercise[] | null }[];
};

const asInput = (e: ProgramExercise): DayExerciseInput => ({
  id: e.id,
  exerciseId: e.exerciseId,
  sets: e.sets,
  repMin: e.repMin,
  repMax: e.repMax,
  targetRpe: e.targetRpe,
  targetRir: e.targetRir,
  restSeconds: e.restSeconds,
  notes: e.notes,
  cardio: e.cardio,
  weightKg: e.weightKg ?? null,
  supersetId: e.supersetId,
});

/** `dayIds` of the active program (all of its days when omitted) as they are now; undefined without an active program. */
export function snapshotProgramDays(dayIds?: string[], now = Date.now()): ProgramDaysSnapshot | undefined {
  const program = getActiveProgram();
  if (!program) return undefined;
  const date = localDate(new Date(now));
  const today = new Map(withOverrides(program, now).days.filter((d) => d.overridden).map((d) => [d.id, d.exercises]));
  const days = program.days.filter((d) => !dayIds || dayIds.includes(d.id));
  return { programId: program.id, date, days: days.map((d) => ({ dayId: d.id, exercises: d.exercises.map(asInput), override: today.get(d.id) ?? null })) };
}

/** What a snapshot's days say, to tell whether they changed since (hand-set loads aside: logging a session spends them). */
export const daysFingerprint = (s: ProgramDaysSnapshot): string =>
  JSON.stringify(s.days.map((d) => [d.dayId, d.exercises.map(({ weightKg: _w, ...e }) => e), d.override?.map(({ weightKg: _w, ...e }) => e) ?? null]));

/**
 * Puts days back as `snapshot` had them (Deshacer on a program change).
 * `expected` is the fingerprint of the days right after that change: when they
 * changed since, nothing is touched and it throws, so a later change is never lost.
 */
export function restoreProgramDays(snapshot: ProgramDaysSnapshot, expected: string | null, now = Date.now()): void {
  const current = snapshotProgramDays(snapshot.days.map((d) => d.dayId), now);
  if (!current || current.programId !== snapshot.programId) throw new ProgramConflictError("That program is no longer the active one.");
  if (expected !== null && daysFingerprint(current) !== expected) throw new ProgramConflictError("A later change touched these days.");
  const database = db();
  database.transaction(() => {
    for (const d of snapshot.days) {
      editDay(d.dayId, { scope: "always", exercises: d.exercises }, now);
      if (d.override && snapshot.date === localDate(new Date(now))) {
        database.run("INSERT INTO program_day_overrides (day_id, date, exercises, updated_at) VALUES (?, ?, ?, ?)", [d.dayId, snapshot.date, JSON.stringify(d.override), now]);
      }
    }
  })();
}

function editDay(dayId: string, edit: DayEdit, now: number): void {
  const program = programOfDay(dayId);
  const day = program.days.find((d) => d.id === dayId)!;
  const checked = prescribeDay(day.name, edit.exercises, libraryMap());
  const database = db();
  const date = localDate(new Date(now));

  if (edit.scope === "today") {
    const exercises: ProgramExercise[] = checked.map(({ exercise, rx }, i) => {
      return {
        id: edit.exercises[i]!.id ?? randomUUID(),
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        equipment: exercise.equipment,
        kind: exercise.kind,
        modality: exercise.modality ?? null,
        ...rx,
      };
    });
    database.transaction(() => {
      database.run("DELETE FROM program_day_overrides WHERE date < ?", [date]);
      database.run(
        "INSERT INTO program_day_overrides (day_id, date, exercises, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (day_id, date) DO UPDATE SET exercises = excluded.exercises, updated_at = excluded.updated_at",
        [dayId, date, JSON.stringify(exercises), now],
      );
    })();
    return;
  }

  const existing = new Map(
    database.query<{ id: string; weight_kg: number | null; weight_set_at: number | null }, [string]>("SELECT id, weight_kg, weight_set_at FROM program_exercises WHERE day_id = ?").all(dayId).map((r) => [r.id, r]),
  );
  database.transaction(() => {
    const kept = new Set<string>();
    checked.forEach(({ exercise, rx }, position) => {
      const id = edit.exercises[position]!.id;
      const old = id ? existing.get(id) : undefined;
      if (!old || kept.has(old.id)) return insertProgramExercise(database, randomUUID(), dayId, position, exercise.id, rx, now);
      kept.add(old.id);
      // A load typed again unchanged keeps its date, so it stays spent once logged.
      const weightSetAt = rx.weightKg == null ? null : rx.weightKg === old.weight_kg ? old.weight_set_at : now;
      database.run(
        `UPDATE program_exercises SET position = ?, exercise_id = ?, sets = ?, rep_min = ?, rep_max = ?, target_rpe = ?, target_rir = ?, rest_seconds = ?,
           notes = ?, cardio = ?, weight_kg = ?, weight_set_at = ?, superset_id = ? WHERE id = ?`,
        [position, exercise.id, rx.sets, rx.repMin, rx.repMax, rx.targetRpe, rx.targetRir, rx.restSeconds, rx.notes, rx.cardio ? JSON.stringify(rx.cardio) : null, rx.weightKg, weightSetAt, rx.supersetId, old.id],
      );
    });
    for (const id of existing.keys()) if (!kept.has(id)) database.run("DELETE FROM program_exercises WHERE id = ?", [id]);
    database.run("DELETE FROM program_day_overrides WHERE day_id = ? AND date = ?", [dayId, date]);
  })();
}

/** Drops today's one-off changes to a day. */
export function clearDayOverride(dayId: string, now = Date.now()): ActiveProgramResponse {
  programOfDay(dayId);
  db().run("DELETE FROM program_day_overrides WHERE day_id = ? AND date = ?", [dayId, localDate(new Date(now))]);
  return activeProgramView(now);
}

/** The program with today's overrides in place of the days they change. */
function withOverrides(program: Program, now: number): Program {
  const rows = db()
    .query<{ day_id: string; exercises: string }, [string]>("SELECT day_id, exercises FROM program_day_overrides WHERE date = ?")
    .all(localDate(new Date(now)));
  if (rows.length === 0) return program;
  // Overrides written before supersets have no supersetId.
  const today = new Map(rows.map((r) => [r.day_id, (JSON.parse(r.exercises) as ProgramExercise[]).map((e) => ({ ...e, supersetId: e.supersetId ?? null }))]));
  return { ...program, days: program.days.map((d) => (today.has(d.id) ? { ...d, exercises: today.get(d.id)!, overridden: true } : d)) };
}

/** ISO weekday (1 = Monday … 7 = Sunday) in the Mac's local time, which is the person's. */
const isoWeekday = (at: number) => ((new Date(at).getDay() + 6) % 7) + 1;

/**
 * The day to train next: the first not done this week, which is one pinned
 * to today's weekday, else the one after the last day done this week (skipping
 * days done), else the week's first. With the week complete it is the day
 * after the last one done, as next week would start; past the program's last
 * week, the day after the last one done at all.
 */
export function nextDay(program: Program, now = Date.now()): ProgramDay | undefined {
  if (program.days.length === 0) return undefined;
  const block = programWeeks(program, now);
  const week = block.finished ? undefined : block.weeks[block.currentWeek - 1];
  const done = new Set(week?.days.filter((d) => d.sessions.length > 0).map((d) => d.dayId) ?? []);
  const open = program.days.filter((d) => !done.has(d.id));
  const pinned = open.find((d) => d.weekday === isoWeekday(now));
  if (pinned) return pinned;
  const last = week
    ? week.days.flatMap((d) => d.sessions).sort((a, b) => b.startedAt - a.startedAt)[0]?.dayId
    : db().query<{ day_id: string }, [string]>("SELECT t.day_id FROM training_sessions t JOIN program_days d ON d.id = t.day_id WHERE d.program_id = ? ORDER BY t.started_at DESC LIMIT 1").get(program.id)?.day_id;
  const index = program.days.findIndex((d) => d.id === last);
  if (index === -1) return open[0] ?? program.days[0];
  for (let k = 1; k <= program.days.length; k++) {
    const day = program.days[(index + k) % program.days.length]!;
    if (!done.has(day.id)) return day;
  }
  return program.days[(index + 1) % program.days.length];
}

// ── Blocks ───────────────────────────────────────────────────────────────────

/** Every block (a program that was active at some point), oldest first, each week by week. */
export function trainingBlocks(now = Date.now()): TrainingBlock[] {
  return db()
    .query<{ id: string }, []>("SELECT id FROM programs WHERE active = 1 OR ended_at IS NOT NULL ORDER BY created_at")
    .all()
    .map((r) => programWeeks(getProgram(r.id)!, now));
}

/** Begins the active block's next week now, once every day of this one is done. */
export function startNextWeek(now = Date.now()): ActiveProgramResponse {
  const program = getActiveProgram();
  if (!program) throw new TrainingError("There is no active program.");
  const block = programWeeks(program, now);
  if (!block.canStartNextWeek) {
    throw new TrainingError(block.weekComplete ? "This is the program's last week." : `Week ${block.currentWeek} still has days to do.`);
  }
  db().run("INSERT INTO program_week_starts (program_id, week, starts_at) VALUES (?, ?, ?) ON CONFLICT (program_id, week) DO UPDATE SET starts_at = excluded.starts_at", [
    program.id,
    block.currentWeek + 1,
    now,
  ]);
  return activeProgramView(now);
}

/** "Retomar": a new active block with an earlier block's days, from week 1. The block it replaces ends. */
export function resumeBlock(programId: string, now = Date.now()): ActiveProgramResponse {
  const old = getProgram(programId);
  if (!old) throw new TrainingError(`Unknown program id: ${programId}.`);
  if (old.active) throw new TrainingError("That block is the active one already.");
  createProgram(
    {
      name: old.name,
      goal: old.goal,
      weeks: old.weeks,
      notes: old.notes,
      reason: `Retomas ${old.name}`,
      days: old.days.map((d) => ({ name: d.name, focus: d.focus, weekday: d.weekday, exercises: d.exercises.map((ex) => programExerciseInput(ex)) })),
    },
    true,
    now,
    old.id,
  );
  return activeProgramView(now);
}

const programExerciseInput = (ex: ProgramExercise): ProgramExerciseInput => ({
  exerciseId: ex.exerciseId,
  sets: ex.sets,
  repMin: ex.repMin,
  repMax: ex.repMax,
  targetRpe: ex.targetRpe,
  targetRir: ex.targetRir,
  restSeconds: ex.restSeconds,
  notes: ex.notes,
  cardio: ex.cardio,
  weightKg: ex.weightKg ?? null,
  supersetId: ex.supersetId,
});

// ── Sessions ─────────────────────────────────────────────────────────────────

type SessionRow = { id: string; program_id: string | null; day_id: string | null; name: string; started_at: number; ended_at: number; notes: string | null };
type SetRow = { session_id: string; exercise_id: string; set_index: number; weight_kg: number; reps: number; rpe: number | null; done_at: number; drops: string | null };
type CardioRow = {
  session_id: string;
  exercise_id: string;
  duration_seconds: number;
  distance_km: number | null;
  level: number | null;
  incline_percent: number | null;
  avg_hr: number | null;
  kcal: number | null;
  done_at: number;
};

const toCardio = (r: CardioRow): CardioLog => ({
  exerciseId: r.exercise_id,
  durationSeconds: r.duration_seconds,
  distanceKm: r.distance_km,
  level: r.level,
  inclinePercent: r.incline_percent,
  avgHr: r.avg_hr,
  kcal: r.kcal,
  doneAt: r.done_at,
});

const toSet = (r: SetRow): SetLog => {
  const top = { weightKg: r.weight_kg, reps: r.reps };
  const drops = r.drops ? (JSON.parse(r.drops) as SetSegment[]) : [];
  return { exerciseId: r.exercise_id, setIndex: r.set_index, ...top, rpe: r.rpe, doneAt: r.done_at, segments: segmentsOf({ ...top, segments: [top, ...drops] }) };
};

function withSets(rows: SessionRow[]): TrainingSession[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const sets = db()
    .query<SetRow, string[]>(`SELECT * FROM set_logs WHERE session_id IN (${ids.map(() => "?").join(",")}) ORDER BY done_at, set_index`)
    .all(...ids);
  const cardio = db()
    .query<CardioRow, string[]>(`SELECT * FROM cardio_logs WHERE session_id IN (${ids.map(() => "?").join(",")}) ORDER BY position`)
    .all(...ids);
  return rows.map((r) => {
    const blocks = cardio.filter((c) => c.session_id === r.id).map(toCardio);
    return {
    id: r.id,
    programId: r.program_id,
    dayId: r.day_id,
    name: r.name,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    notes: r.notes,
    sets: sets.filter((s) => s.session_id === r.id).map(toSet),
    cardio: blocks,
    cardioMinutes: Math.round(blocks.reduce((n, c) => n + c.durationSeconds, 0) / 6) / 10,
    };
  });
}

export function listSessions(limit = 20, exerciseId?: string): TrainingSession[] {
  const rows = exerciseId
    ? db()
        .query<SessionRow, [string, number]>(
          `SELECT * FROM training_sessions WHERE id IN (SELECT session_id FROM set_logs WHERE exercise_id = ?1 UNION SELECT session_id FROM cardio_logs WHERE exercise_id = ?1)
           ORDER BY started_at DESC LIMIT ?2`,
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
  const cardio = input.cardio ?? [];
  const unknown = [...new Set([...input.sets, ...cardio].map((s) => s.exerciseId).filter((id) => !known.has(id)))];
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
      const drops = segmentsOf(s).slice(1);
      database.run("INSERT INTO set_logs (session_id, exercise_id, set_index, weight_kg, reps, rpe, done_at, drops) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
        input.id,
        s.exerciseId,
        index,
        s.weightKg,
        s.reps,
        s.rpe ?? null,
        s.doneAt,
        drops.length ? JSON.stringify(drops) : null,
      ]);
    }
    cardio.forEach((c, position) => {
      database.run(
        "INSERT INTO cardio_logs (session_id, position, exercise_id, duration_seconds, distance_km, level, incline_percent, avg_hr, kcal, done_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [input.id, position, c.exerciseId, Math.round(c.durationSeconds), c.distanceKm, c.level, c.inclinePercent, c.avgHr, c.kcal, c.doneAt],
      );
    });
    // The session is over: the engine's copy of it in progress goes.
    database.run("DELETE FROM live_sessions WHERE id = ?", [input.id]);
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
        totalReps: sets.reduce((n, s) => n + repsOf(s), 0),
        volumeKg: sets.reduce((n, s) => n + volumeOf(s), 0),
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
  return nextLoad(exerciseId, rx, lastWork, INCREMENT_KG[exercise.equipment], unitOf(exerciseId));
}

/** A load the person set by hand wins over progression until the exercise is logged again. */
function suggestFor(ex: ProgramExercise): LoadSuggestion {
  const suggestion = suggestLoad(ex.exerciseId, ex);
  if (ex.weightKg == null) return suggestion;
  return { ...suggestion, weightKg: ex.weightKg, reps: ex.repMin, reason: "El peso que elegiste para esta vez." };
}

/** Suggestions for every strength exercise of a day, keyed by `ProgramExercise.id`. Cardio has none. */
export function suggestDay(day: ProgramDay): Record<string, LoadSuggestion> {
  return Object.fromEntries(day.exercises.filter((ex) => ex.kind !== "cardio").map((ex) => [ex.id, suggestFor(ex)]));
}

/** The active program as it stands today (with "solo hoy" changes), or undefined. */
export function activeProgramToday(now = Date.now()): Program | undefined {
  const program = getActiveProgram();
  return program && withOverrides(program, now);
}

/** What the phone's Entreno tab opens with. */
export function activeProgramView(now = Date.now()): ActiveProgramResponse {
  const program = activeProgramToday(now);
  const blocks = trainingBlocks(now);
  const extras = { hrZones: hrZones(now), settings: trainingSettings(), blocks };
  if (!program) return { program: null, nextDayId: null, suggestions: {}, ...extras };
  const complete = blocks.find((b) => b.programId === program.id)?.weekComplete ?? false;
  const next = complete ? undefined : nextDay(program, now);
  const suggestions: Record<string, LoadSuggestion> = Object.assign({}, ...program.days.map(suggestDay));
  return { program, nextDayId: next?.id ?? null, suggestions, ...extras, adjustment: next ? nextAdjustment(program.id, next, suggestions) : null };
}

// ── Adjusting the next session ───────────────────────────────────────────────

/** The top load of an exercise's last session, kg (top segments: a drop never sets it); null without one. */
function lastTopKg(exerciseId: string): number | null {
  const [last] = listSessions(1, exerciseId);
  const loads = last?.sets.filter((s) => s.exerciseId === exerciseId).map((s) => s.weightKg) ?? [];
  return loads.length ? Math.max(...loads) : null;
}

const LOOKUP: Lookup = {
  exercise: (id) => getExercise(id),
  lastTopKg,
  suggest: (ex) => suggestFor(ex),
  unit: (id) => unitOf(id),
};

/** The upcoming session of `day` with its adjustment applied, when there is one. */
function nextAdjustment(programId: string, day: ProgramDay, suggestions: Record<string, LoadSuggestion>): NextAdjustment | null {
  const adjustment = adjustmentFor(programId, day.id);
  if (!adjustment) return null;
  const own = Object.fromEntries(day.exercises.filter((e) => suggestions[e.id]).map((e) => [e.id, suggestions[e.id]!]));
  const applied = adjustment.status === "ready" && !adjustment.noChange ? applyChanges(day, own, adjustment.changes, LOOKUP) : { day, suggestions: own };
  return { ...adjustment, ...applied };
}

/**
 * The Coach's decision on the next session of `dayId` (its review, or asked
 * in a chat): checked against the guardrails, then stored for that session
 * only. Returns it applied.
 */
export function setSessionAdjustment(input: { dayId: string; noChange: boolean; rationale: string; changes: ExerciseChange[] }, now = Date.now()): NextAdjustment {
  const program = activeProgramToday(now);
  const day = program?.days.find((d) => d.id === input.dayId);
  if (!program || !day) throw new TrainingError(`Day ${input.dayId} is not in the active program. Use day ids from get_active_program.`);
  const rationale = input.rationale.trim();
  if (!rationale) throw new TrainingError("rationale: one sentence for the person.");
  const suggestions = suggestDay(day);
  try {
    if (!input.noChange) validateChanges(day, input.changes, suggestions, LOOKUP);
  } catch (error) {
    if (error instanceof AdjustmentError) throw new TrainingError(error.message);
    throw error;
  }
  const decision = { decidedBy: "coach" as const, noChange: input.noChange || input.changes.length === 0, rationale, changes: input.changes };
  const since = lastSessionId();
  const current = adjustmentFor(program.id, day.id, since);
  const saved = current ? decide(current.id, decision, now) : insertDecided(program.id, day.id, since, decision, now);
  return nextAdjustment(program.id, day, suggestions) ?? { ...saved, day, suggestions };
}

// ── Preferences and heart-rate zones ─────────────────────────────────────────

const setting = (key: string) => db().query<{ value: string }, [string]>("SELECT value FROM training_settings WHERE key = ?").get(key)?.value;
const putSetting = (key: string, value: string) =>
  db().query("INSERT INTO training_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);

export function trainingSettings(): TrainingSettings {
  const preferred = setting("preferredEquipment");
  const units = db().query<{ exercise_id: string; unit: WeightUnit }, []>("SELECT exercise_id, unit FROM exercise_units ORDER BY exercise_id").all();
  return {
    preferredEquipment: preferred ? (JSON.parse(preferred) as Equipment[]) : [],
    defaultUnit: setting("defaultUnit") === "lb" ? "lb" : "kg",
    exerciseUnits: Object.fromEntries(units.map((u) => [u.exercise_id, u.unit])),
  };
}

/** Changes the settings given (preferred equipment: most preferred first, duplicates dropped); the rest stay. */
export function setTrainingSettings(settings: Partial<Pick<TrainingSettings, "preferredEquipment" | "defaultUnit">>): TrainingSettings {
  if (settings.preferredEquipment) putSetting("preferredEquipment", JSON.stringify([...new Set(settings.preferredEquipment)]));
  if (settings.defaultUnit) putSetting("defaultUnit", settings.defaultUnit);
  return trainingSettings();
}

/** The unit an exercise is shown, typed and suggested in. */
export function unitOf(exerciseId: string): WeightUnit {
  const own = db().query<{ unit: WeightUnit }, [string]>("SELECT unit FROM exercise_units WHERE exercise_id = ?").get(exerciseId)?.unit;
  return own ?? (setting("defaultUnit") === "lb" ? "lb" : "kg");
}

/** Pins an exercise to a unit (its machine's), or with null lets it follow the default again. */
export function setExerciseUnit(exerciseId: string, unit: WeightUnit | null): TrainingSettings {
  if (!getExercise(exerciseId)) throw new TrainingError(`Unknown exercise id: ${exerciseId}. Use ids from list_exercises.`);
  if (unit) db().query("INSERT INTO exercise_units (exercise_id, unit) VALUES (?, ?) ON CONFLICT (exercise_id) DO UPDATE SET unit = excluded.unit").run(exerciseId, unit);
  else db().query("DELETE FROM exercise_units WHERE exercise_id = ?").run(exerciseId);
  return trainingSettings();
}

/** Zone bands as fractions of heart-rate reserve (or of max without a resting HR). */
const ZONES: [HrZone, number, number][] = [
  [1, 0.5, 0.6],
  [2, 0.6, 0.7],
  [3, 0.7, 0.8],
  [4, 0.8, 0.9],
  [5, 0.9, 1],
];

/**
 * Heart-rate zones from the profile's age (max HR by Tanaka: 208 − 0.7 × age)
 * and, when the phone has synced one in the last two weeks, the resting heart
 * rate (Karvonen: resting + fraction × (max − resting)). Null without an age.
 */
export function hrZones(now = Date.now()): HrZoneRange[] | null {
  const age = getProfile().age;
  if (!age) return null;
  const max = Math.round(208 - 0.7 * age);
  const today = localDate(new Date(now));
  const resting = listDailyMetrics(addDays(today, -14), today)
    .map((m) => m.restingHeartRate)
    .filter((v): v is number => v != null)
    .at(-1);
  const floor = resting ?? 0;
  return ZONES.map(([zone, lo, hi]) => ({ zone, minBpm: Math.round(floor + lo * (max - floor)), maxBpm: Math.round(floor + hi * (max - floor)) }));
}

/** "Entrenar normal" (`dismissed`) or back to the Coach's plan, for the next session. Returns the program view. */
export function dismissAdjustment(id: string, dismissed: boolean, now = Date.now()): ActiveProgramResponse {
  if (!getAdjustment(id)) throw new TrainingError(`No adjustment ${id}.`);
  setDismissed(id, dismissed, now);
  return activeProgramView(now);
}

/** "Ver por qué": the Coach thread about the next session's adjustment, made on first use. */
export function adjustmentThreadId(id: string, now = Date.now()): string {
  const view = activeProgramView(now);
  if (!view.adjustment || view.adjustment.id !== id) throw new TrainingError("That adjustment is not the next session's any more.");
  return adjustmentThread(view.adjustment);
}
