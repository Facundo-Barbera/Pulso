import { randomUUID } from "node:crypto";
import type { CardioTarget, Exercise, LiveExercise, LiveSession, LiveSet } from "@pulso/contract";
import { db } from "../db";
import { getExercise, listSessions, suggestLoad, TrainingError } from "./store";

/**
 * The session in progress, mirrored from the phone so the Coach can change it.
 * One at a time; every write bumps `version`, and the phone's write is refused
 * when the Coach moved the copy past the version the phone last saw.
 */

type Row = { id: string; data: string; version: number; thread_id: string | null; updated_at: number };

const toSession = (r: Row): LiveSession => ({ ...(JSON.parse(r.data) as LiveSession), version: r.version, threadId: r.thread_id, updatedAt: r.updated_at });

export function getLive(): LiveSession | null {
  const row = db().query<Row, []>("SELECT * FROM live_sessions ORDER BY updated_at DESC LIMIT 1").get();
  return row ? toSession(row) : null;
}

function write(session: LiveSession, version: number, threadId: string | null, now: number): LiveSession {
  const database = db();
  database.transaction(() => {
    database.run("DELETE FROM live_sessions WHERE id <> ?", [session.id]);
    database.run(
      `INSERT INTO live_sessions (id, data, version, thread_id, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data, version = excluded.version, thread_id = excluded.thread_id, updated_at = excluded.updated_at`,
      [session.id, JSON.stringify(session), version, threadId, now],
    );
  })();
  return { ...session, version, threadId, updatedAt: now };
}

export type PutResult = { ok: true; session: LiveSession } | { ok: false; session: LiveSession };

/**
 * Stores the phone's copy. Refused (with the engine's copy) when it is the same
 * session and the engine's version moved past `baseVersion`: the Coach changed
 * it after the phone last synced. A different session id replaces the old one.
 */
export function putLive(session: LiveSession, baseVersion: number, now = Date.now()): PutResult {
  const current = getLive();
  if (current && current.id === session.id && baseVersion < current.version) return { ok: false, session: current };
  const version = Math.max(current?.id === session.id ? current.version : 0, baseVersion) + 1;
  const threadId = current?.id === session.id ? (current.threadId ?? session.threadId) : session.threadId;
  return { ok: true, session: write(session, version, threadId, now) };
}

export function clearLive(id?: string): boolean {
  return (id ? db().run("DELETE FROM live_sessions WHERE id = ?", [id]) : db().run("DELETE FROM live_sessions")).changes > 0;
}

/** Binds a Coach thread to the session in progress (kept across the phone's writes). */
export function setLiveThread(sessionId: string, threadId: string): void {
  db().run("UPDATE live_sessions SET thread_id = ? WHERE id = ?", [threadId, sessionId]);
}

export function liveByThread(threadId: string): LiveSession | null {
  const row = db().query<Row, [string]>("SELECT * FROM live_sessions WHERE thread_id = ?").get(threadId);
  return row ? toSession(row) : null;
}

// ── Changes the Coach makes ──────────────────────────────────────────────────

/** Which exercise: "current" (the one on screen), its 1-based position, or its live id. */
export type ExerciseRef = "current" | number | string;

export type LiveOp =
  | { op: "swap"; exercise: ExerciseRef; toExerciseId: string }
  | {
      op: "update";
      exercise: ExerciseRef;
      sets?: number;
      repMin?: number;
      repMax?: number;
      weightKg?: number;
      reps?: number;
      restSeconds?: number;
      cardio?: CardioTarget;
    }
  | { op: "add"; exerciseId: string; position?: number; sets?: number; repMin?: number; repMax?: number; restSeconds?: number; weightKg?: number; cardio?: CardioTarget }
  | { op: "remove"; exercise: ExerciseRef }
  | { op: "skip"; exercise: ExerciseRef }
  | { op: "move"; exercise: ExerciseRef; to: number }
  | { op: "focus"; exercise: ExerciseRef };

const done = (ex: LiveExercise) => (ex.kind === "cardio" ? ex.cardioLog != null : ex.sets.length > 0 && ex.sets.every((s) => s.doneAt != null));
const pending = (ex: LiveExercise) => !ex.skipped && !done(ex);

function indexOf(session: LiveSession, ref: ExerciseRef): number {
  const n = session.exercises.length;
  const i =
    ref === "current"
      ? Math.min(Math.max(session.focus, 0), n - 1)
      : typeof ref === "number"
        ? ref - 1
        : /^\d+$/.test(ref)
          ? Number(ref) - 1
          : session.exercises.findIndex((e) => e.id === ref || e.exerciseId === ref);
  if (i < 0 || i >= n) throw new TrainingError(`No exercise ${JSON.stringify(ref)} in the session: use "current", a position 1–${n} or an id from get_live_session.`);
  return i;
}

function libraryExercise(id: string): Exercise {
  const exercise = getExercise(id);
  if (!exercise) throw new TrainingError(`Unknown exercise id: ${id}. Use ids from list_exercises or find_similar_exercises.`);
  return exercise;
}

/** Load for a fresh exercise: the progression suggestion, else the last weight logged, else 0. */
function startingLoad(exerciseId: string, repMin: number, repMax: number, sets: number): { weightKg: number; reps: number; hint: string | null } {
  const suggestion = suggestLoad(exerciseId, { sets, repMin, repMax });
  if (suggestion.weightKg != null) return { weightKg: suggestion.weightKg, reps: suggestion.reps, hint: suggestion.reason };
  const last = listSessions(1, exerciseId)[0]?.sets.filter((s) => s.exerciseId === exerciseId).at(-1);
  return { weightKg: last?.weightKg ?? 0, reps: repMin, hint: null };
}

const freshSets = (count: number, weightKg: number, reps: number): LiveSet[] =>
  Array.from({ length: count }, () => ({ id: randomUUID(), weightKg, reps, rpe: null, doneAt: null }));

const DEFAULT_CARDIO: CardioTarget = { durationMinutes: 15, zone: 2 };

/** A new live exercise from the library, taking targets from `like` (the one it replaces) when given. */
function liveExercise(
  exercise: Exercise,
  target: { sets: number; repMin: number; repMax: number; restSeconds: number; weightKg?: number; cardio?: CardioTarget | null },
  like?: LiveExercise,
): LiveExercise {
  const cardio = exercise.kind === "cardio";
  const load = cardio ? null : startingLoad(exercise.id, target.repMin, target.repMax, target.sets);
  return {
    id: randomUUID(),
    exerciseId: exercise.id,
    name: exercise.name,
    equipment: exercise.equipment,
    kind: exercise.kind,
    modality: exercise.modality ?? null,
    repMin: cardio ? 1 : target.repMin,
    repMax: cardio ? 1 : target.repMax,
    targetRpe: cardio ? null : (like?.targetRpe ?? null),
    targetRir: cardio ? null : (like?.targetRir ?? null),
    restSeconds: cardio ? 0 : target.restSeconds,
    notes: null,
    hint: load?.hint ?? null,
    sets: cardio ? [] : freshSets(target.sets, target.weightKg ?? load!.weightKg, load!.reps),
    cardio: cardio ? (target.cardio ?? (like?.kind === "cardio" ? like.cardio : null) ?? DEFAULT_CARDIO) : null,
    cardioLog: null,
    skipped: false,
  };
}

/** Moves the focus off a finished or skipped exercise to the next one still to do. */
function refocus(session: LiveSession): void {
  const list = session.exercises;
  if (list.length === 0) return void (session.focus = 0);
  session.focus = Math.min(Math.max(session.focus, 0), list.length - 1);
  if (pending(list[session.focus]!)) return;
  const next = [...list.keys()].find((i) => i > session.focus && pending(list[i]!)) ?? list.findIndex(pending);
  if (next !== -1) session.focus = next;
}

/** Applies one change; returns a short Spanish line saying what changed. */
function apply(session: LiveSession, op: LiveOp): string {
  const list = session.exercises;
  switch (op.op) {
    case "swap": {
      const i = indexOf(session, op.exercise);
      const old = list[i]!;
      const exercise = libraryExercise(op.toExerciseId);
      if ((exercise.kind === "cardio") !== (old.kind === "cardio")) throw new TrainingError("Swap strength for strength and cardio for cardio; use add and remove to change one into the other.");
      const doneSets = old.sets.filter((s) => s.doneAt != null);
      const remaining = Math.max(old.sets.length - doneSets.length, 1);
      const next = liveExercise(exercise, { sets: remaining, repMin: old.repMin, repMax: old.repMax, restSeconds: old.restSeconds }, old);
      if (doneSets.length) {
        // What was lifted stays logged under the exercise actually done.
        list[i] = { ...old, sets: doneSets };
        list.splice(i + 1, 0, next);
        if (session.focus === i) session.focus = i + 1;
      } else {
        list[i] = { ...next, id: old.id, notes: null };
      }
      return `${old.name} → ${exercise.name}`;
    }
    case "update": {
      const i = indexOf(session, op.exercise);
      const ex = list[i]!;
      if (ex.kind === "cardio") {
        if (op.cardio) ex.cardio = { ...ex.cardio, ...op.cardio };
        return `${ex.name}: objetivo cambiado`;
      }
      if (op.repMin != null) ex.repMin = op.repMin;
      if (op.repMax != null) ex.repMax = op.repMax;
      if (ex.repMin > ex.repMax) throw new TrainingError(`repMin (${ex.repMin}) is above repMax (${ex.repMax}).`);
      if (op.restSeconds != null) ex.restSeconds = op.restSeconds;
      const open = ex.sets.filter((s) => s.doneAt == null);
      if (op.weightKg != null) for (const s of open) s.weightKg = op.weightKg;
      if (op.reps != null) for (const s of open) s.reps = op.reps;
      if (op.sets != null) {
        const doneCount = ex.sets.length - open.length;
        const want = Math.max(op.sets, doneCount);
        const template = open.at(-1) ?? ex.sets.at(-1) ?? { weightKg: op.weightKg ?? 0, reps: op.reps ?? ex.repMin };
        if (want > ex.sets.length) ex.sets.push(...freshSets(want - ex.sets.length, template.weightKg, template.reps));
        else {
          // Only sets not done yet go, from the end.
          let drop = ex.sets.length - want;
          for (let s = ex.sets.length - 1; s >= 0 && drop > 0; s--) if (ex.sets[s]!.doneAt == null) (ex.sets.splice(s, 1), drop--);
        }
      }
      return `${ex.name}: ${ex.sets.length} × ${ex.repMin === ex.repMax ? ex.repMin : `${ex.repMin}–${ex.repMax}`}${open[0] ? ` · ${open[0].weightKg} kg` : ""}`;
    }
    case "add": {
      const exercise = libraryExercise(op.exerciseId);
      const next = liveExercise(exercise, {
        sets: op.sets ?? 3,
        repMin: op.repMin ?? 8,
        repMax: op.repMax ?? op.repMin ?? 12,
        restSeconds: op.restSeconds ?? 90,
        weightKg: op.weightKg,
        cardio: op.cardio,
      });
      const at = op.position == null ? list.length : Math.min(Math.max(op.position - 1, 0), list.length);
      list.splice(at, 0, next);
      if (at <= session.focus && list.length > 1) session.focus++;
      return `Añadido: ${exercise.name}`;
    }
    case "remove": {
      const i = indexOf(session, op.exercise);
      const ex = list[i]!;
      if (ex.sets.some((s) => s.doneAt != null) || ex.cardioLog) throw new TrainingError(`${ex.name} already has work logged; skip it instead of removing it.`);
      list.splice(i, 1);
      if (i < session.focus) session.focus--;
      return `Quitado: ${ex.name}`;
    }
    case "skip": {
      const i = indexOf(session, op.exercise);
      list[i]!.skipped = true;
      return `Saltado: ${list[i]!.name}`;
    }
    case "move": {
      const i = indexOf(session, op.exercise);
      const to = Math.min(Math.max(op.to - 1, 0), list.length - 1);
      const focused = list[session.focus]?.id;
      const [ex] = list.splice(i, 1);
      list.splice(to, 0, ex!);
      session.focus = Math.max(0, list.findIndex((e) => e.id === focused));
      return `${ex!.name} → posición ${to + 1}`;
    }
    case "focus": {
      session.focus = indexOf(session, op.exercise);
      return `Ahora: ${list[session.focus]!.name}`;
    }
  }
}

/**
 * The Coach's changes to the session in progress, applied in order on the
 * engine's copy (all or nothing). The phone sees the new version on its next
 * pull and adopts it. Returns the session and one line per change.
 */
export function editLive(ops: LiveOp[], now = Date.now()): { session: LiveSession; changes: string[] } {
  const current = getLive();
  if (!current) throw new TrainingError("There is no session in progress. Changes to the program go through edit_program_day or swap_program_exercise.");
  const session: LiveSession = structuredClone(current);
  const changes = ops.map((op) => apply(session, op));
  if (session.exercises.length === 0) throw new TrainingError("A session needs at least one exercise.");
  if (ops.some((o) => o.op !== "focus")) refocus(session);
  // Rest belongs to the set that started it; a changed list ends it.
  if (ops.some((o) => o.op === "swap" || o.op === "remove" || o.op === "skip")) {
    session.restStartedAt = null;
    session.restEndsAt = null;
  }
  return { session: write(session, current.version + 1, current.threadId, now), changes };
}

/** A compact view for the Coach: positions, what's done, the one on screen. */
export function describeLive(session: LiveSession, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - session.startedAt) / 60_000));
  const lines = session.exercises.map((ex, i) => {
    const mark = i === session.focus ? " ← en pantalla" : "";
    const status = ex.skipped ? " (saltado)" : done(ex) ? " (hecho)" : "";
    if (ex.kind === "cardio") {
      const t = ex.cardio;
      const target = [t?.durationMinutes ? `${t.durationMinutes} min` : null, t?.zone ? `Z${t.zone}` : null, t?.intervals ? `${t.intervals.rounds}×${t.intervals.workSeconds}s/${t.intervals.restSeconds}s` : null].filter(Boolean).join(" · ");
      return `${i + 1}. ${ex.name} [${ex.exerciseId}] — cardio ${target}${status}${mark}`;
    }
    const doneSets = ex.sets.filter((s) => s.doneAt != null).length;
    const load = ex.sets.find((s) => s.doneAt == null) ?? ex.sets.at(-1);
    return `${i + 1}. ${ex.name} [${ex.exerciseId}, ${ex.equipment}] — ${ex.sets.length}×${ex.repMin}–${ex.repMax}${load ? ` · ${load.weightKg} kg` : ""} · ${doneSets}/${ex.sets.length} series${status}${mark}`;
  });
  return [`Sesión "${session.name}", ${minutes} min en marcha.`, ...lines].join("\n");
}
