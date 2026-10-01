/**
 * A strength session being logged in the web app: pure value logic, the same
 * rules as the iPhone's LiveSessionState. The browser keeps it in localStorage
 * so a reload resumes; finishing posts `toSessionInput` to the same store the
 * phone writes to. No server imports: the logger is a client component.
 */
import type { SessionInput } from "@pulso/contract";
import type { PlanDay } from "./entreno";

export type LiveSet = { weightKg: number; reps: number; rpe: number | null; doneAt: number | null };

export type LiveExercise = {
  /** `ProgramExercise.id` */
  id: string;
  exerciseId: string;
  name: string;
  target: string;
  restSeconds: number;
  step: number;
  notes: string | null;
  /** the engine's double-progression reason */
  hint: string | null;
  sets: LiveSet[];
};

export type LiveState = {
  id: string;
  programId: string | null;
  dayId: string;
  name: string;
  startedAt: number;
  exercises: LiveExercise[];
  restStartedAt: number | null;
  restEndsAt: number | null;
};

/** A lowercase v4-shaped id. `crypto.randomUUID` needs a secure context, which a tailnet `http://` page is not. */
export function sessionId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Sets prefilled from the suggested load (0 kg without history yet). */
export function startSession(day: PlanDay, programId: string | null, now = Date.now(), id = sessionId()): LiveState {
  return {
    id,
    programId,
    dayId: day.id,
    name: day.name,
    startedAt: now,
    restStartedAt: null,
    restEndsAt: null,
    exercises: day.exercises.map((ex) => ({
      id: ex.id,
      exerciseId: ex.exerciseId,
      name: ex.exerciseName,
      target: ex.target,
      restSeconds: ex.restSeconds,
      step: ex.step,
      notes: ex.notes,
      hint: ex.suggestion?.reason ?? null,
      sets: Array.from({ length: ex.sets }, () => ({ weightKg: ex.suggestion?.weightKg ?? 0, reps: ex.suggestion?.reps ?? ex.repMin, rpe: null, doneAt: null })),
    })),
  };
}

export const setsTotal = (s: LiveState) => s.exercises.reduce((n, e) => n + e.sets.length, 0);
export const setsDone = (s: LiveState) => s.exercises.reduce((n, e) => n + e.sets.filter((x) => x.doneAt !== null).length, 0);
export const volumeKg = (s: LiveState) => s.exercises.flatMap((e) => e.sets).reduce((n, x) => n + (x.doneAt !== null ? x.weightKg * x.reps : 0), 0);

/** The first set not yet done, in program order. */
export function current(s: LiveState): { exercise: number; set: number } | null {
  for (const [e, ex] of s.exercises.entries()) {
    const set = ex.sets.findIndex((x) => x.doneAt === null);
    if (set !== -1) return { exercise: e, set };
  }
  return null;
}

const mapSet = (s: LiveState, e: number, i: number, change: (set: LiveSet) => LiveSet): LiveState => ({
  ...s,
  exercises: s.exercises.map((ex, ei) => (ei !== e ? ex : { ...ex, sets: ex.sets.map((set, si) => (si === i ? change(set) : set)) })),
});

/** Edits one field of a set. Numbers are clamped to what the engine accepts. */
export function editSet(s: LiveState, e: number, i: number, patch: Partial<Pick<LiveSet, "weightKg" | "reps" | "rpe">>): LiveState {
  return mapSet(s, e, i, (set) => ({
    ...set,
    ...(patch.weightKg !== undefined && { weightKg: Math.min(Math.max(patch.weightKg, 0), 1000) }),
    ...(patch.reps !== undefined && { reps: Math.min(Math.max(Math.round(patch.reps), 0), 200) }),
    ...(patch.rpe !== undefined && { rpe: patch.rpe === null ? null : Math.min(Math.max(patch.rpe, 1), 10) }),
  }));
}

/** Moves a set's load by whole steps, landing on a multiple of the step. */
export function stepWeight(s: LiveState, e: number, i: number, steps: number): LiveState {
  const { step } = s.exercises[e]!;
  const weight = s.exercises[e]!.sets[i]!.weightKg;
  return editSet(s, e, i, { weightKg: Math.round((weight + steps * step) / step) * step });
}

/**
 * Checks a set off (starting its rest) or un-checks it. Checking carries the
 * set's load to the later sets not done yet, so a changed load sticks.
 */
export function toggleSet(s: LiveState, e: number, i: number, now = Date.now()): LiveState {
  const ex = s.exercises[e];
  const set = ex?.sets[i];
  if (!ex || !set) return s;
  if (set.doneAt !== null) return { ...mapSet(s, e, i, (x) => ({ ...x, doneAt: null })), restStartedAt: null, restEndsAt: null };
  const next: LiveState = {
    ...s,
    exercises: s.exercises.map((x, ei) =>
      ei !== e ? x : { ...x, sets: x.sets.map((y, si) => (si === i ? { ...y, doneAt: now } : si > i && y.doneAt === null ? { ...y, weightKg: set.weightKg } : y)) },
    ),
  };
  const more = current(next) !== null;
  return { ...next, restStartedAt: more ? now : null, restEndsAt: more ? now + ex.restSeconds * 1000 : null };
}

/** One more set, copying the last one's load and reps. */
export function addSet(s: LiveState, e: number): LiveState {
  const last = s.exercises[e]?.sets.at(-1);
  if (!last) return s;
  return { ...s, exercises: s.exercises.map((ex, ei) => (ei === e ? { ...ex, sets: [...ex.sets, { ...last, doneAt: null }] } : ex)) };
}

/** Drops a set not yet done (one too many prescribed). */
export function removeSet(s: LiveState, e: number, i: number): LiveState {
  const ex = s.exercises[e];
  if (!ex || ex.sets.length <= 1 || ex.sets[i]?.doneAt !== null) return s;
  return { ...s, exercises: s.exercises.map((x, ei) => (ei === e ? { ...x, sets: x.sets.filter((_, si) => si !== i) } : x)) };
}

export const extendRest = (s: LiveState, seconds: number, now = Date.now()): LiveState =>
  s.restEndsAt !== null && s.restEndsAt > now ? { ...s, restEndsAt: s.restEndsAt + seconds * 1000 } : s;

export const skipRest = (s: LiveState): LiveState => ({ ...s, restStartedAt: null, restEndsAt: null });

/** What the engine stores: done sets only, numbered per exercise in the order they were done. */
export function toSessionInput(s: LiveState, endedAt = Date.now()): SessionInput {
  const done = s.exercises
    .flatMap((ex) => ex.sets.filter((set) => set.doneAt !== null).map((set) => ({ exerciseId: ex.exerciseId, set, doneAt: set.doneAt! })))
    .sort((a, b) => a.doneAt - b.doneAt);
  const counts = new Map<string, number>();
  return {
    id: s.id,
    programId: s.programId,
    dayId: s.dayId,
    name: s.name,
    startedAt: s.startedAt,
    endedAt: Math.max(endedAt, s.startedAt),
    notes: null,
    sets: done.map(({ exerciseId, set, doneAt }) => {
      const setIndex = counts.get(exerciseId) ?? 0;
      counts.set(exerciseId, setIndex + 1);
      return { exerciseId, setIndex, weightKg: set.weightKg, reps: set.reps, rpe: set.rpe, doneAt };
    }),
  };
}

/** Where the browser keeps the session in progress. One at a time, like the phone. */
export const LIVE_KEY = "pulso.entreno.live";

/** A stored session, if it still looks like one (an older shape is dropped rather than crashing the page). */
export function parseLive(raw: string | null): LiveState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as LiveState;
    return typeof s?.id === "string" && typeof s.startedAt === "number" && Array.isArray(s.exercises) ? s : null;
  } catch {
    return null;
  }
}
