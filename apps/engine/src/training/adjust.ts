import { randomUUID } from "node:crypto";
import type { AdjustmentSignal, ExerciseChange, LoadSuggestion, NextAdjustment, ProgramDay, ProgramExercise, SessionAdjustment } from "@pulso/contract";
import { addMessage, createThread, getThread } from "../agent/threads";
import { db } from "../db";
import { CARDIO } from "./library";
import type { Detected } from "./signals";
import { publicSignals } from "./signals";
import { supersetIds } from "./superset";
import { formatWeight, nearestStepKg } from "./units";

/**
 * The bounds any adjustment of the next session must keep, whoever writes it
 * (the Coach's review, or the Coach in a chat). `set_session_adjustment`
 * refuses changes outside them with a message saying what to fix.
 */
export const GUARDRAILS = {
  /** Lightest load: this share of what progression suggests, and of the last load lifted. */
  minLoadShare: 0.6,
  /** Sets one exercise may lose; it never gains any. */
  maxSetsRemoved: 2,
  /** Share of the day's exercises that may be skipped. */
  maxSkipShare: 0.5,
  maxWarmups: 1,
  maxWarmupMinutes: 15,
  rationaleChars: 240,
};

/**
 * Used only when the Coach can't review (provider down, timeout, no
 * decision), and marked `decidedBy: "fallback"`. By signal level: load change
 * (%), sets removed and whether reps drop to the bottom of the range. Health
 * events, block switches and missed days change nothing on their own here:
 * those need the Coach.
 */
export const FALLBACK: Record<string, { loadPercent: number; setsRemoved: number; repsToMin: boolean }> = {
  moderate: { loadPercent: -10, setsRemoved: 0, repsToMin: false },
  long: { loadPercent: -20, setsRemoved: 0, repsToMin: true },
  very_long: { loadPercent: -30, setsRemoved: 1, repsToMin: true },
  returning: { loadPercent: -15, setsRemoved: 0, repsToMin: false },
  low: { loadPercent: -10, setsRemoved: 0, repsToMin: false },
  sleep: { loadPercent: -10, setsRemoved: 0, repsToMin: false },
};

/** A `running` review this old died with its run: it may be claimed again. */
export const REVIEW_STALE_MS = 10 * 60_000;

export class AdjustmentError extends Error {}

// ── Validation and applying ──────────────────────────────────────────────────

/** What the guardrails measure against: the exercise's library row and its last top load. */
export type Lookup = {
  exercise: (id: string) => { id: string; name: string; equipment: ProgramExercise["equipment"]; kind: ProgramExercise["kind"] } | undefined;
  lastTopKg: (exerciseId: string) => number | null;
  suggest: (ex: ProgramExercise) => LoadSuggestion;
  unit: (exerciseId: string) => "kg" | "lb";
};

/** Throws an AdjustmentError naming what breaks a guardrail. */
export function validateChanges(day: ProgramDay, changes: ExerciseChange[], suggestions: Record<string, LoadSuggestion>, lookup: Lookup): void {
  const byId = new Map(day.exercises.map((e) => [e.id, e]));
  const seen = new Set<string>();
  let skips = 0;
  let warmups = 0;
  for (const change of changes) {
    if (change.action === "add") {
      const library = change.toExerciseId ? lookup.exercise(change.toExerciseId) : undefined;
      if (!library || library.kind !== "cardio") throw new AdjustmentError(`"add" is for a cardio warm-up: toExerciseId must be a cardio library id (got ${change.toExerciseId ?? "none"}).`);
      if (++warmups > GUARDRAILS.maxWarmups) throw new AdjustmentError(`At most ${GUARDRAILS.maxWarmups} warm-up.`);
      const minutes = change.cardio?.durationMinutes ?? 10;
      if (minutes <= 0 || minutes > GUARDRAILS.maxWarmupMinutes) throw new AdjustmentError(`A warm-up lasts at most ${GUARDRAILS.maxWarmupMinutes} min (got ${minutes}).`);
      continue;
    }
    const ex = change.programExerciseId ? byId.get(change.programExerciseId) : undefined;
    if (!ex) throw new AdjustmentError(`${change.programExerciseId ?? "(none)"} is not an exercise of ${day.name}: use the programExerciseId ids of that day.`);
    if (seen.has(ex.id)) throw new AdjustmentError(`${ex.exerciseName} appears twice: put all its changes in one entry.`);
    seen.add(ex.id);
    if (change.action === "skip") {
      skips++;
      continue;
    }
    let kg = suggestions[ex.id]?.weightKg ?? null;
    if (change.action === "swap") {
      const to = change.toExerciseId ? lookup.exercise(change.toExerciseId) : undefined;
      if (!to) throw new AdjustmentError(`Unknown exercise id: ${change.toExerciseId ?? "none"}. Use ids from find_similar_exercises.`);
      if ((to.kind === "cardio") !== (ex.kind === "cardio")) throw new AdjustmentError(`${ex.exerciseName} can only be swapped for the same kind (strength or cardio).`);
      kg = lookup.suggest({ ...ex, exerciseId: to.id }).weightKg;
    }
    if (change.sets != null) {
      if (!Number.isInteger(change.sets) || change.sets < 1 || change.sets > ex.sets) throw new AdjustmentError(`${ex.exerciseName}: sets must be 1–${ex.sets} (never more than prescribed).`);
      if (ex.sets - change.sets > GUARDRAILS.maxSetsRemoved) throw new AdjustmentError(`${ex.exerciseName}: at most ${GUARDRAILS.maxSetsRemoved} sets fewer (${ex.sets} → ${ex.sets - GUARDRAILS.maxSetsRemoved}).`);
    }
    if (change.reps != null && (change.reps < ex.repMin || change.reps > ex.repMax)) {
      throw new AdjustmentError(`${ex.exerciseName}: reps must stay within ${ex.repMin}–${ex.repMax}.`);
    }
    if (change.loadPercent != null) {
      const floor = (GUARDRAILS.minLoadShare - 1) * 100;
      if (change.loadPercent > 0) throw new AdjustmentError(`${ex.exerciseName}: loadPercent can't be positive (never heavier than progression).`);
      if (change.loadPercent < floor) throw new AdjustmentError(`${ex.exerciseName}: loadPercent can't go under ${floor} %.`);
      const last = change.action === "swap" ? null : lookup.lastTopKg(ex.exerciseId);
      if (kg != null && last != null && kg * (1 + change.loadPercent / 100) < GUARDRAILS.minLoadShare * last - 0.01) {
        throw new AdjustmentError(`${ex.exerciseName}: that is under ${GUARDRAILS.minLoadShare * 100} % of the last load (${last} kg).`);
      }
    }
  }
  const strength = day.exercises.length;
  if (skips > 0 && skips > Math.max(1, Math.floor(strength * GUARDRAILS.maxSkipShare))) {
    throw new AdjustmentError(`Skip at most half of ${day.name}'s exercises (${Math.max(1, Math.floor(strength * GUARDRAILS.maxSkipShare))}).`);
  }
  if (skips > 0 && skips >= strength) throw new AdjustmentError("Leave at least one exercise.");
}

/** The day and its suggestions as the adjusted session will be done. The program is untouched. */
export function applyChanges(day: ProgramDay, suggestions: Record<string, LoadSuggestion>, changes: ExerciseChange[], lookup: Lookup): { day: ProgramDay; suggestions: Record<string, LoadSuggestion> } {
  const out: Record<string, LoadSuggestion> = {};
  const exercises: ProgramExercise[] = [];
  changes
    .filter((c) => c.action === "add" && c.toExerciseId)
    .forEach((c, i) => {
      const library = lookup.exercise(c.toExerciseId!)!;
      exercises.push({
        id: `warmup-${i + 1}`,
        exerciseId: library.id,
        exerciseName: library.name,
        equipment: library.equipment,
        kind: "cardio",
        modality: CARDIO[library.id]?.modality ?? null,
        sets: 1,
        repMin: 1,
        repMax: 1,
        targetRpe: null,
        targetRir: null,
        restSeconds: 0,
        notes: "Calentamiento",
        cardio: c.cardio ?? { durationMinutes: 10, zone: 2 },
        supersetId: null,
      });
    });
  for (const ex of day.exercises) {
    const change = changes.find((c) => c.programExerciseId === ex.id && c.action !== "add");
    if (change?.action === "skip") continue;
    let next: ProgramExercise = { ...ex };
    if (change?.action === "swap" && change.toExerciseId) {
      const to = lookup.exercise(change.toExerciseId)!;
      next = { ...next, exerciseId: to.id, exerciseName: to.name, equipment: to.equipment, kind: to.kind, modality: CARDIO[to.id]?.modality ?? null, weightKg: null };
    }
    if (change?.sets != null) next.sets = change.sets;
    exercises.push(next);
    if (ex.kind === "cardio") continue;
    const normal = change?.action === "swap" ? lookup.suggest(next) : (suggestions[ex.id] ?? lookup.suggest(next));
    if (!change) {
      out[ex.id] = normal;
      continue;
    }
    const unit = lookup.unit(next.exerciseId);
    const weightKg = normal.weightKg != null && change.loadPercent ? nearestStepKg(normal.weightKg * (1 + change.loadPercent / 100), unit) : normal.weightKg;
    const reps = change.reps ?? normal.reps;
    const parts = [weightKg != null && weightKg > 0 ? formatWeight(weightKg, unit) : null, `${reps} repeticiones`, change.sets != null && change.sets < ex.sets ? `${change.sets} series` : null];
    out[ex.id] = {
      ...normal,
      weightKg,
      reps,
      reason: `Ajuste para hoy: ${parts.filter(Boolean).join(", ")}${change.loadPercent ? ` (${change.loadPercent} %)` : ""}.`,
      normal: { weightKg: normal.weightKg, reps: normal.reps },
    };
  }
  // Skipping or swapping can leave a superset with one member: normalize like any day.
  const ids = supersetIds(exercises.map((e) => ({ kind: e.kind, supersetId: e.supersetId })));
  return { day: { ...day, exercises: exercises.map((e, i) => ({ ...e, supersetId: ids[i]! })) }, suggestions: out };
}

/** The fixed table's changes for these signals: the strongest per exercise. */
export function fallbackChanges(day: ProgramDay, signals: AdjustmentSignal[]): ExerciseChange[] {
  const dayWide = signals.filter((s) => s.kind === "inactivity" || s.kind === "readiness").map((s) => FALLBACK[s.level ?? ""]).filter(Boolean);
  const changes: ExerciseChange[] = [];
  for (const ex of day.exercises) {
    if (ex.kind === "cardio") continue;
    const own = signals.filter((s) => s.kind === "exercise_gap" && s.programExerciseId === ex.id).map((s) => FALLBACK[s.level ?? ""]).filter(Boolean);
    const rules = [...dayWide, ...own];
    if (rules.length === 0) continue;
    const loadPercent = Math.min(...rules.map((r) => r!.loadPercent));
    const removed = Math.min(GUARDRAILS.maxSetsRemoved, Math.max(...rules.map((r) => r!.setsRemoved)));
    const sets = removed > 0 && ex.sets > 2 ? ex.sets - removed : null;
    changes.push({ action: "adjust", programExerciseId: ex.id, loadPercent, sets, reps: rules.some((r) => r!.repsToMin) ? ex.repMin : null });
  }
  return changes;
}

/** One sentence for the card, from the signals, saying it was automatic. */
export function fallbackRationale(signals: AdjustmentSignal[], changes: ExerciseChange[]): string {
  const first = signals[0]?.detail ?? "Algo cambió desde tu última sesión";
  const percent = Math.min(0, ...changes.map((c) => c.loadPercent ?? 0));
  const what = changes.length === 0 ? "revísalo con el Coach antes de empezar" : `hoy ${Math.abs(percent)} % menos de peso`;
  return `${first}: ${what}. (Ajuste automático: el Coach no pudo revisarlo.)`;
}

// ── Store ────────────────────────────────────────────────────────────────────

type Row = {
  id: string;
  key: string;
  program_id: string;
  day_id: string;
  since: string;
  status: SessionAdjustment["status"];
  decided_by: SessionAdjustment["decidedBy"];
  no_change: number;
  rationale: string | null;
  signals: string;
  changes: string;
  dismissed: number;
  thread_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
};

const toAdjustment = (r: Row): SessionAdjustment => ({
  id: r.id,
  programId: r.program_id,
  dayId: r.day_id,
  status: r.status,
  decidedBy: r.decided_by,
  noChange: r.no_change === 1,
  rationale: r.rationale,
  signals: JSON.parse(r.signals),
  changes: JSON.parse(r.changes),
  dismissed: r.dismissed === 1,
  threadId: r.thread_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function getAdjustment(id: string): SessionAdjustment | undefined {
  const row = db().query<Row, [string]>("SELECT * FROM session_adjustments WHERE id = ?").get(id);
  return row ? toAdjustment(row) : undefined;
}

/** The last session's id: an adjustment belongs to the session after it. */
export const lastSessionId = (): string => db().query<{ id: string }, []>("SELECT id FROM training_sessions ORDER BY started_at DESC LIMIT 1").get()?.id ?? "";

/** The newest adjustment of the upcoming session of `dayId`. */
export function adjustmentFor(programId: string, dayId: string, since = lastSessionId()): SessionAdjustment | undefined {
  const row = db()
    .query<Row, [string, string, string]>("SELECT * FROM session_adjustments WHERE program_id = ? AND day_id = ? AND since = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(programId, dayId, since);
  return row ? toAdjustment(row) : undefined;
}

/**
 * Takes the right to review the upcoming session for this set of signals,
 * atomically: a key is reviewed once. A `reviewing` row whose run died
 * (older than REVIEW_STALE_MS) is taken again. Undefined when there is nothing to do.
 */
export function claimReview(key: string, programId: string, dayId: string, since: string, signals: Detected[], now = Date.now()): SessionAdjustment | undefined {
  return db()
    .transaction(() => {
      const existing = db().query<Row, [string]>("SELECT * FROM session_adjustments WHERE key = ?").get(key);
      if (!existing) {
        const id = randomUUID();
        db()
          .query("INSERT INTO session_adjustments (id, key, program_id, day_id, since, status, signals, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'reviewing', ?, ?, ?)")
          .run(id, key, programId, dayId, since, JSON.stringify(publicSignals(signals)), now, now);
        return getAdjustment(id);
      }
      if (existing.status !== "reviewing" || now - existing.updated_at < REVIEW_STALE_MS) return undefined;
      db().query("UPDATE session_adjustments SET updated_at = ? WHERE id = ?").run(now, existing.id);
      return getAdjustment(existing.id);
    })
    .immediate();
}

type Decision = { decidedBy: "coach" | "fallback"; noChange: boolean; rationale: string; changes: ExerciseChange[]; error?: string | null };

export function decide(id: string, d: Decision, now = Date.now()): SessionAdjustment {
  db()
    .query("UPDATE session_adjustments SET status = 'ready', decided_by = ?, no_change = ?, rationale = ?, changes = ?, error = ?, dismissed = 0, updated_at = ? WHERE id = ?")
    .run(d.decidedBy, d.noChange ? 1 : 0, d.rationale, JSON.stringify(d.noChange ? [] : d.changes), d.error ?? null, now, id);
  return getAdjustment(id)!;
}

/** A decision the Coach makes outside a review (asked in a chat): its own row, with no signals. */
export function insertDecided(programId: string, dayId: string, since: string, d: Decision, now = Date.now()): SessionAdjustment {
  const id = randomUUID();
  db()
    .query("INSERT INTO session_adjustments (id, key, program_id, day_id, since, status, signals, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'reviewing', '[]', ?, ?)")
    .run(id, `chat|${id}`, programId, dayId, since, now, now);
  return decide(id, d, now);
}

/** "Entrenar normal" (true) or back to the Coach's plan (false). */
export function setDismissed(id: string, dismissed: boolean, now = Date.now()): SessionAdjustment {
  if (!getAdjustment(id)) throw new AdjustmentError(`No adjustment ${id}.`);
  db().query("UPDATE session_adjustments SET dismissed = ?, updated_at = ? WHERE id = ?").run(dismissed ? 1 : 0, now, id);
  return getAdjustment(id)!;
}

/** Reviews still `reviewing` when a process starts died with the last one. */
export const runningReviews = (): SessionAdjustment[] =>
  db().query<Row, []>("SELECT * FROM session_adjustments WHERE status = 'reviewing'").all().map(toAdjustment);

/**
 * "Ver por qué": a Coach thread that opens with the review (what was noticed,
 * what changed and why), so the person can discuss it. Made once per adjustment.
 */
export function adjustmentThread(adjustment: NextAdjustment): string {
  if (adjustment.threadId && getThread(adjustment.threadId)) return adjustment.threadId;
  const day = new Date(adjustment.createdAt).toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "");
  const thread = createThread(`Ajuste · ${adjustment.day.name} · ${day}`);
  const lines = [
    adjustment.rationale ?? "Revisé tu próxima sesión.",
    "",
    ...(adjustment.signals.length ? ["### Lo que vi", ...adjustment.signals.map((s) => `- ${s.detail}`), ""] : []),
    "### Para hoy",
    ...(adjustment.noChange || adjustment.changes.length === 0 ? ["- Sin cambios: el plan tal cual."] : describeChanges(adjustment)),
    ...(adjustment.decidedBy === "fallback" ? ["", "_Este ajuste es automático: no pude revisarlo a tiempo. Dime si lo cambiamos._"] : []),
  ];
  addMessage(thread.id, "assistant", lines.join("\n"), "done");
  db().query("UPDATE session_adjustments SET thread_id = ? WHERE id = ?").run(thread.id, adjustment.id);
  return thread.id;
}

function describeChanges(adjustment: NextAdjustment): string[] {
  return adjustment.changes.map((c) => {
    const original = adjustment.day.exercises.find((e) => e.id === c.programExerciseId);
    if (c.action === "add") return `- **Calentamiento** — ${adjustment.day.exercises.find((e) => e.exerciseId === c.toExerciseId)?.exerciseName ?? c.toExerciseId}`;
    const name = original?.exerciseName ?? c.programExerciseId;
    if (c.action === "skip") return `- **${name}** — hoy no`;
    if (c.action === "swap") return `- Cambio a **${name}**`;
    const parts = [c.loadPercent ? `${c.loadPercent} % de peso` : null, c.sets != null ? `${c.sets} series` : null, c.reps != null ? `${c.reps} reps` : null];
    return `- **${name}** — ${parts.filter(Boolean).join(" · ")}`;
  });
}
