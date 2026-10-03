import { randomUUID } from "node:crypto";
import type { CardioLog, CardioTarget, Exercise, LiveCardioClock, LiveExercise, LiveSession, LiveSet, SessionInput, TrainingSession } from "@pulso/contract";
import { db } from "../db";
import { getExercise, getSession, listSessions, saveSession, suggestLoad, TrainingError, unitOf } from "./store";
import { formatSet, hasDrops, segmentsOf, withSegments } from "./segments";
import { withSupersets } from "./superset";
import { formatBoth, formatWeight, snapKg } from "./units";

/**
 * The session in progress, mirrored from the phone so the Coach can change it.
 * One at a time; every write bumps `version`, and the phone's write is refused
 * when the Coach moved the copy past the version the phone last saw.
 */

type Row = { id: string; data: string; version: number; thread_id: string | null; updated_at: number };

const toSession = (r: Row): LiveSession => {
  const data = JSON.parse(r.data) as LiveSession;
  // Copies stored before supersets, segments (or the synced clock) lack those fields.
  const exercises = data.exercises.map((e) => ({ ...e, sets: e.sets.map(withSegments), supersetId: e.supersetId ?? null }));
  return { ...data, exercises, cardioClock: data.cardioClock ?? null, version: r.version, threadId: r.thread_id, updatedAt: r.updated_at };
};

export function getLive(): LiveSession | null {
  const row = db().query<Row, []>("SELECT * FROM live_sessions ORDER BY updated_at DESC LIMIT 1").get();
  return row ? toSession(row) : null;
}

function write(written: LiveSession, version: number, threadId: string | null, now: number): LiveSession {
  // Every set leaves with its segments, the top one rebuilt from weightKg/reps.
  const session = { ...written, exercises: written.exercises.map((e) => ({ ...e, sets: e.sets.map(withSegments) })) };
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
  return { ok: true, session: write({ ...session, exercises: withSupersets(session.exercises) }, version, threadId, now) };
}

export function clearLive(id?: string): boolean {
  return (id ? db().run("DELETE FROM live_sessions WHERE id = ?", [id]) : db().run("DELETE FROM live_sessions")).changes > 0;
}

/** The work done in a live session, as the finished session the phone would post: done sets and logged cardio, in the order done. */
export function sessionFromLive(live: LiveSession, endedAt: number): SessionInput {
  const finite = (n: number | null | undefined) => (n != null && Number.isFinite(n) ? n : null);
  const sets = live.exercises
    .filter((ex) => ex.kind !== "cardio")
    .flatMap((ex) => ex.sets.filter((s) => s.doneAt != null && Number.isFinite(s.weightKg) && Number.isFinite(s.reps)).map((s) => ({ exerciseId: ex.exerciseId, weightKg: s.weightKg, reps: s.reps, rpe: finite(s.rpe), doneAt: s.doneAt!, segments: segmentsOf(s) })))
    .sort((a, b) => a.doneAt - b.doneAt)
    .map((s, setIndex) => ({ ...s, setIndex }));
  const cardio: CardioLog[] = live.exercises
    .flatMap((ex) => (ex.cardioLog ? [ex.cardioLog] : []))
    .filter((c) => Number.isFinite(c.durationSeconds))
    .map((c) => ({ ...c, distanceKm: finite(c.distanceKm), level: finite(c.level), inclinePercent: finite(c.inclinePercent), avgHr: finite(c.avgHr), kcal: finite(c.kcal) }))
    .sort((a, b) => a.doneAt - b.doneAt);
  return { id: live.id, programId: live.programId, dayId: live.dayId, name: live.name, startedAt: live.startedAt, endedAt: Math.max(endedAt, live.startedAt), notes: null, sets, cardio };
}

/**
 * Ends the session in progress. Unless it is a discard, work done in it that
 * the phone hasn't saved yet is saved now (same id, so the phone's own post
 * later just replaces it): Terminar must never lose a workout, even when the
 * phone's save never arrives. A save the store refuses keeps the live copy.
 */
export function endLive(discard: boolean, now = Date.now()): { saved: TrainingSession | null } {
  const live = getLive();
  if (live && !discard && !getSession(live.id)) {
    const input = sessionFromLive(live, now);
    if (input.sets.length > 0 || (input.cardio?.length ?? 0) > 0) {
      try {
        return { saved: saveSession(input).session };
      } catch (error) {
        if (error instanceof TrainingError) return { saved: null };
        throw error;
      }
    }
  }
  clearLive();
  return { saved: null };
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
      /** A label to pair it with the neighbours that share it; null takes it out of its superset. */
      supersetId?: string | null;
    }
  | {
      op: "add";
      exerciseId: string;
      position?: number;
      sets?: number;
      repMin?: number;
      repMax?: number;
      restSeconds?: number;
      weightKg?: number;
      cardio?: CardioTarget;
      supersetId?: string | null;
    }
  | { op: "remove"; exercise: ExerciseRef }
  | { op: "skip"; exercise: ExerciseRef }
  | { op: "move"; exercise: ExerciseRef; to: number }
  | { op: "focus"; exercise: ExerciseRef }
  | { op: "finish_cardio"; exercise: ExerciseRef; reason?: string }
  /** The load dropped mid-set: one more segment on a done set (default: the last one done in the session, or in `exercise`). */
  | { op: "drop"; exercise?: ExerciseRef; set?: number; weightKg: number; reps: number };

// A cardio block cut short is done even before the phone writes its log.
const done = (ex: LiveExercise) => (ex.kind === "cardio" ? ex.cardioLog != null || ex.cutShort != null : ex.sets.length > 0 && ex.sets.every((s) => s.doneAt != null));
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

/** A load for the Coach: kg as is; on a pound machine the pounds first, then the kg the tools take. */
function load(kg: number, exerciseId: string): string {
  const unit = unitOf(exerciseId);
  return unit === "kg" ? formatWeight(kg, unit) : formatBoth(kg, unit);
}

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
    supersetId: null,
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

/** Seconds on a cardio clock at `now`. */
export function clockSeconds(clock: LiveCardioClock, now: number): number {
  return clock.accumulatedSeconds + (clock.runningSince == null ? 0 : Math.max(0, (now - clock.runningSince) / 1000));
}

/**
 * Before a swap, remove or skip: the exercise's clock stops with it, but time
 * already on it is never thrown away; finish_cardio keeps it.
 */
function releaseClock(session: LiveSession, ex: LiveExercise, now: number): void {
  const clock = session.cardioClock;
  if (!clock || clock.exerciseId !== ex.id) return;
  if (clockSeconds(clock, now) >= 1) {
    throw new TrainingError(`${ex.name} has ${Math.round(clockSeconds(clock, now) / 60)} min on its running clock: end it with finish_cardio (keeps what was done) before you skip, remove or swap it.`);
  }
  session.cardioClock = null;
}

/** Superset ids the Coach asked for, by live exercise id: checked once all ops ran. */
type Requested = Map<string, { name: string; supersetId: string | null }>;

const supersetLine = (id: string | null | undefined) => (id === undefined ? "" : id ? ` · superserie ${id}` : " · sin superserie");

/** Applies one change; returns a short Spanish line saying what changed. */
function apply(session: LiveSession, op: LiveOp, requested: Requested, now: number): string {
  const list = session.exercises;
  switch (op.op) {
    case "swap": {
      const i = indexOf(session, op.exercise);
      const old = list[i]!;
      const exercise = libraryExercise(op.toExerciseId);
      releaseClock(session, old, now);
      if ((exercise.kind === "cardio") !== (old.kind === "cardio")) throw new TrainingError("Swap strength for strength and cardio for cardio; use add and remove to change one into the other.");
      const doneSets = old.sets.filter((s) => s.doneAt != null);
      const remaining = Math.max(old.sets.length - doneSets.length, 1);
      // The swapped-in exercise takes the old one's place in its superset.
      const next = { ...liveExercise(exercise, { sets: remaining, repMin: old.repMin, repMax: old.repMax, restSeconds: old.restSeconds }, old), supersetId: old.supersetId };
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
      if (op.supersetId !== undefined) {
        ex.supersetId = op.supersetId?.trim() || null;
        requested.set(ex.id, { name: ex.name, supersetId: ex.supersetId });
      }
      if (ex.kind === "cardio") {
        if (op.cardio) ex.cardio = { ...ex.cardio, ...op.cardio };
        return `${ex.name}: objetivo cambiado`;
      }
      if (op.repMin != null) ex.repMin = op.repMin;
      if (op.repMax != null) ex.repMax = op.repMax;
      if (ex.repMin > ex.repMax) throw new TrainingError(`repMin (${ex.repMin}) is above repMax (${ex.repMax}).`);
      if (op.restSeconds != null) ex.restSeconds = op.restSeconds;
      const open = ex.sets.filter((s) => s.doneAt == null);
      // The Coach thinks in kg; the sets land on the steps of the exercise's machine.
      if (op.weightKg != null) for (const s of open) s.weightKg = snapKg(op.weightKg, unitOf(ex.exerciseId));
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
      return `${ex.name}: ${ex.sets.length} × ${ex.repMin === ex.repMax ? ex.repMin : `${ex.repMin}–${ex.repMax}`}${open[0] ? ` · ${load(open[0].weightKg, ex.exerciseId)}` : ""}${supersetLine(op.supersetId === undefined ? undefined : ex.supersetId)}`;
    }
    case "add": {
      const exercise = libraryExercise(op.exerciseId);
      const next = liveExercise(exercise, {
        sets: op.sets ?? 3,
        repMin: op.repMin ?? 8,
        repMax: op.repMax ?? op.repMin ?? 12,
        restSeconds: op.restSeconds ?? 90,
        weightKg: op.weightKg == null ? undefined : snapKg(op.weightKg, unitOf(exercise.id)),
        cardio: op.cardio,
      });
      next.supersetId = op.supersetId?.trim() || null;
      if (next.supersetId) requested.set(next.id, { name: next.name, supersetId: next.supersetId });
      const at = op.position == null ? list.length : Math.min(Math.max(op.position - 1, 0), list.length);
      list.splice(at, 0, next);
      if (at <= session.focus && list.length > 1) session.focus++;
      return `Añadido: ${exercise.name}${supersetLine(next.supersetId ?? undefined)}`;
    }
    case "remove": {
      const i = indexOf(session, op.exercise);
      const ex = list[i]!;
      if (ex.sets.some((s) => s.doneAt != null) || ex.cardioLog) throw new TrainingError(`${ex.name} already has work logged; skip it instead of removing it.`);
      releaseClock(session, ex, now);
      list.splice(i, 1);
      if (i < session.focus) session.focus--;
      return `Quitado: ${ex.name}`;
    }
    case "skip": {
      const i = indexOf(session, op.exercise);
      releaseClock(session, list[i]!, now);
      list[i]!.skipped = true;
      // A skipped exercise leaves its superset; a partner left alone is cleared on write.
      list[i]!.supersetId = null;
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
    case "drop": {
      const candidates = (op.exercise == null ? list : [list[indexOf(session, op.exercise)]!]).filter((e) => e.kind !== "cardio");
      const doneSets = candidates.flatMap((ex) => ex.sets.filter((s) => s.doneAt != null).map((s) => ({ ex, s })));
      const pick = op.set != null ? candidates.length === 1 && candidates[0]!.sets[op.set - 1]?.doneAt != null ? { ex: candidates[0]!, s: candidates[0]!.sets[op.set - 1]! } : undefined : doneSets.sort((a, b) => b.s.doneAt! - a.s.doneAt!)[0];
      if (!pick) {
        throw new TrainingError(op.set != null ? `Set ${op.set} is not a done set of ${candidates[0]?.name ?? "that exercise"}; give the exercise and the 1-based number of a done set.` : "No done strength set to add the drop to yet.");
      }
      const weightKg = snapKg(op.weightKg, unitOf(pick.ex.exerciseId));
      pick.s.segments = [...segmentsOf(pick.s), { weightKg, reps: op.reps }];
      return `${pick.ex.name}: ${formatSet(pick.s, unitOf(pick.ex.exerciseId))}`;
    }
    case "finish_cardio": {
      const i = indexOf(session, op.exercise);
      const ex = list[i]!;
      if (ex.kind !== "cardio") throw new TrainingError(`${ex.name} is not cardio; finish_cardio ends a cardio block early.`);
      if (ex.cardioLog) throw new TrainingError(`${ex.name} is already done.`);
      ex.cutShort = { at: now, reason: op.reason?.trim() || null };
      ex.skipped = false;
      const clock = session.cardioClock?.exerciseId === ex.id ? session.cardioClock : null;
      const planned = ex.cardio?.durationMinutes;
      if (!clock) return `${ex.name}: terminado antes${planned ? ` (de ${planned} min)` : ""}`;
      // The phone, adopting this, times it to `at` with its own clock and keeps what was typed.
      const seconds = Math.round(clockSeconds(clock, now));
      ex.cardioLog = { exerciseId: ex.exerciseId, durationSeconds: seconds, distanceKm: null, level: null, inclinePercent: null, avgHr: null, kcal: null, doneAt: now };
      session.cardioClock = null;
      return `${ex.name}: terminado antes, ${Math.round(seconds / 60)}${planned ? ` de ${planned}` : ""} min`;
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
  if (!current) throw new TrainingError("There is no session in progress. Changes to the program go through edit_program_days or swap_program_exercise.");
  const session: LiveSession = structuredClone(current);
  const requested: Requested = new Map();
  const changes = ops.map((op) => apply(session, op, requested, now));
  if (session.exercises.length === 0) throw new TrainingError("A session needs at least one exercise.");
  // Normalized once all ops ran, so pairing two exercises can take two updates;
  // a move, remove or skip that leaves a member alone or apart clears it.
  session.exercises = withSupersets(session.exercises);
  for (const [id, want] of requested) {
    const ex = session.exercises.find((e) => e.id === id);
    if (!want.supersetId || !ex || ex.supersetId === want.supersetId) continue;
    throw new TrainingError(
      ex.kind === "cardio"
        ? `${want.name} is cardio and can't be in a superset.`
        : `${want.name} can't be in superset "${want.supersetId}": a superset is 2+ consecutive strength exercises sharing a supersetId not used elsewhere in the session. Give its neighbour the same id (or move them next to each other) in the same call.`,
    );
  }
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
      const clock = session.cardioClock?.exerciseId === ex.id ? session.cardioClock : null;
      const timing = clock ? ` · ${clock.runningSince == null ? "en pausa" : "en marcha"} ${Math.floor(clockSeconds(clock, now) / 60)} min` : "";
      const cut = ex.cutShort ? ` (terminado antes${ex.cardioLog ? `, ${Math.round(ex.cardioLog.durationSeconds / 60)} min` : ""})` : "";
      return `${i + 1}. ${ex.name} [${ex.exerciseId}] — cardio ${target}${timing}${cut || status}${mark}`;
    }
    const doneSets = ex.sets.filter((s) => s.doneAt != null);
    const weight = ex.sets.find((s) => s.doneAt == null) ?? ex.sets.at(-1);
    // Sets where the load dropped mid-set, as one set each ("serie 2: 80 kg × 5 → 60 kg × 3").
    const logged = ex.sets.flatMap((s, n) => (s.doneAt != null && hasDrops(s) ? [` · serie ${n + 1}: ${formatSet(s, unitOf(ex.exerciseId))}`] : [])).join("");
    return `${i + 1}. ${ex.name} [${ex.exerciseId}, ${ex.equipment}] — ${ex.sets.length}×${ex.repMin}–${ex.repMax}${weight ? ` · ${load(weight.weightKg, ex.exerciseId)}` : ""} · ${doneSets.length}/${ex.sets.length} series${logged}${ex.supersetId ? ` · superserie ${ex.supersetId}` : ""}${status}${mark}`;
  });
  return [`Sesión "${session.name}", ${minutes} min en marcha.`, ...lines].join("\n");
}
