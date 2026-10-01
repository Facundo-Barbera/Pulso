import type { ExercisePerformance, LoadSuggestion, PersonalRecord, SetLog } from "@pulso/contract";

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Epley estimated 1RM, kg. A single is its own 1RM; no load or no reps estimates nothing. */
export function e1rm(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0;
  return reps === 1 ? weightKg : round1(weightKg * (1 + reps / 30));
}

type Bests = { e1rm: number; weight: number; reps: number };

/** Best e1RM, heaviest load and most bodyweight reps across sets. */
export function bests(sets: Pick<SetLog, "weightKg" | "reps">[]): Bests {
  const out: Bests = { e1rm: 0, weight: 0, reps: 0 };
  for (const s of sets) {
    if (s.reps <= 0) continue;
    out.e1rm = Math.max(out.e1rm, e1rm(s.weightKg, s.reps));
    out.weight = Math.max(out.weight, s.weightKg);
    if (s.weightKg === 0) out.reps = Math.max(out.reps, s.reps);
  }
  return out;
}

/**
 * Records this session set on one exercise, against everything before it.
 * A first-ever session sets no records: there is nothing to beat yet.
 */
export function recordsFor(
  exercise: { id: string; name: string },
  session: Pick<SetLog, "weightKg" | "reps">[],
  before: Pick<SetLog, "weightKg" | "reps">[],
): PersonalRecord[] {
  if (before.length === 0) return [];
  const now = bests(session);
  const prev = bests(before);
  const records: PersonalRecord[] = [];
  const add = (kind: PersonalRecord["kind"]) => {
    if (now[kind] > prev[kind]) records.push({ exerciseId: exercise.id, exerciseName: exercise.name, kind, value: now[kind], previous: prev[kind] || null });
  };
  add("e1rm");
  add("weight");
  add("reps");
  return records;
}

export type Prescription = { sets: number; repMin: number; repMax: number };

/**
 * Double progression from the last session's work on an exercise. Every
 * prescribed set at the top weight reached `repMax` → add `incrementKg` and
 * drop to `repMin`. Every set at that weight short of `repMin` → back off one
 * step. Otherwise keep the weight and chase one more rep.
 */
export function nextLoad(
  exerciseId: string,
  rx: Prescription,
  last: { at: number; sets: Pick<SetLog, "weightKg" | "reps">[] } | null,
  incrementKg: number,
): LoadSuggestion {
  if (!last || last.sets.length === 0) {
    return { exerciseId, weightKg: null, reps: rx.repMin, reason: "Sin historial: elige un peso que te deje 2 reps en reserva.", lastSessionAt: null };
  }
  const top = Math.max(...last.sets.map((s) => s.weightKg));
  const atTop = last.sets.filter((s) => s.weightKg === top);
  const minReps = Math.min(...atTop.map((s) => s.reps));
  const base = { exerciseId, lastSessionAt: last.at };

  if (atTop.length >= rx.sets && minReps >= rx.repMax) {
    if (incrementKg === 0) {
      return { ...base, weightKg: top, reps: rx.repMax + 1, reason: `Completaste ${rx.sets}×${rx.repMax}: suma una rep o añade lastre.` };
    }
    const weightKg = round1(top + incrementKg);
    return { ...base, weightKg, reps: rx.repMin, reason: `Completaste ${rx.sets}×${rx.repMax} con ${top} kg: sube a ${weightKg} kg.` };
  }
  if (minReps < rx.repMin && incrementKg > 0 && top > incrementKg) {
    const weightKg = round1(top - incrementKg);
    return { ...base, weightKg, reps: rx.repMin, reason: `No llegaste a ${rx.repMin} reps con ${top} kg: baja a ${weightKg} kg.` };
  }
  const reps = Math.min(rx.repMax, Math.max(rx.repMin, minReps + 1));
  return { ...base, weightKg: top, reps, reason: `Mantén ${top} kg y busca ${reps} reps en cada serie.` };
}

/**
 * The Rendimiento view from one exercise's sessions. Each record is dated to
 * the first session that reached it; ties on the heaviest load go to more reps.
 * Bodyweight-only work has no load, so its records stay null.
 */
export function performance(exerciseId: string, sessions: { at: number; sets: Pick<SetLog, "weightKg" | "reps">[] }[]): ExercisePerformance {
  const out: ExercisePerformance = { exerciseId, maxWeight: null, bestE1rm: null, maxVolume: null, history: [] };
  for (const session of [...sessions].sort((a, b) => a.at - b.at)) {
    const work = session.sets.filter((s) => s.reps > 0);
    if (work.length === 0) continue;
    const best = bests(work);
    const volumeKg = round1(work.reduce((n, s) => n + s.weightKg * s.reps, 0));
    out.history.push({ at: session.at, topWeightKg: best.weight, e1rm: best.e1rm, volumeKg });
    if (best.weight > 0) {
      const reps = Math.max(...work.filter((s) => s.weightKg === best.weight).map((s) => s.reps));
      const prev = out.maxWeight;
      if (!prev || best.weight > prev.kg || (best.weight === prev.kg && reps > prev.reps)) out.maxWeight = { kg: best.weight, reps, at: session.at };
    }
    if (best.e1rm > (out.bestE1rm?.kg ?? 0)) out.bestE1rm = { kg: best.e1rm, at: session.at };
    if (volumeKg > (out.maxVolume?.kg ?? 0)) out.maxVolume = { kg: volumeKg, at: session.at };
  }
  return out;
}
