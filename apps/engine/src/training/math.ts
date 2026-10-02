import type { ExercisePerformance, LoadSuggestion, PersonalRecord, SetLog, WeightUnit } from "@pulso/contract";
import { volumeOf } from "./segments";
import { formatWeight, fromUnit, snap, stepDown, stepUp } from "./units";

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Epley estimated 1RM, kg. A single is its own 1RM; no load or no reps estimates nothing. */
export function e1rm(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0;
  return reps === 1 ? weightKg : round1(weightKg * (1 + reps / 30));
}

type Bests = { e1rm: number; weight: number; reps: number };

/** Best e1RM, heaviest load and most bodyweight reps across sets, from each set's top segment (drops never count). */
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
 * step. Otherwise keep the weight and chase one more rep. Loads land on the
 * steps of the exercise's `unit` (a pound machine moves by 5 lb) and a change
 * always moves at least one step. Only top segments count: a set that dropped
 * the load to finish counts as the reps done at the top.
 */
export function nextLoad(
  exerciseId: string,
  rx: Prescription,
  last: { at: number; sets: Pick<SetLog, "weightKg" | "reps">[] } | null,
  incrementKg: number,
  unit: WeightUnit = "kg",
): LoadSuggestion {
  if (!last || last.sets.length === 0) {
    return { exerciseId, weightKg: null, reps: rx.repMin, reason: "Primera vez: elige un peso que puedas mover bien.", lastSessionAt: null };
  }
  const top = Math.max(...last.sets.map((s) => s.weightKg));
  const atTop = last.sets.filter((s) => s.weightKg === top);
  const minReps = Math.min(...atTop.map((s) => s.reps));
  const base = { exerciseId, lastSessionAt: last.at };
  const now = snap(top, unit);
  const w = (kg: number) => formatWeight(kg, unit);

  if (atTop.length >= rx.sets && minReps >= rx.repMax) {
    if (incrementKg === 0) {
      return { ...base, weightKg: top, reps: rx.repMax + 1, reason: `Hiciste ${rx.sets} series de ${rx.repMax}: haz una repetición más o añade peso.` };
    }
    const up = snap(top + incrementKg, unit);
    const weightKg = fromUnit(up > now ? up : stepUp(now, unit), unit);
    return { ...base, weightKg, reps: rx.repMin, reason: `Hiciste ${rx.sets} series de ${rx.repMax} con ${w(top)}: sube a ${w(weightKg)}.` };
  }
  if (minReps < rx.repMin && incrementKg > 0 && top > incrementKg) {
    const down = snap(top - incrementKg, unit);
    const weightKg = fromUnit(down < now ? down : stepDown(now, unit), unit);
    return { ...base, weightKg, reps: rx.repMin, reason: `Con ${w(top)} no llegaste a ${rx.repMin} repeticiones: baja a ${w(weightKg)}.` };
  }
  const reps = Math.min(rx.repMax, Math.max(rx.repMin, minReps + 1));
  const weightKg = fromUnit(now, unit);
  return { ...base, weightKg, reps, reason: `Repite ${w(weightKg)} e intenta ${reps} repeticiones en cada serie.` };
}

/**
 * The Rendimiento view from one exercise's sessions. Each record is dated to
 * the first session that reached it; ties on the heaviest load go to more reps.
 * Bodyweight-only work has no load, so its records stay null.
 */
export function performance(exerciseId: string, sessions: { at: number; sets: Pick<SetLog, "weightKg" | "reps" | "segments">[] }[]): ExercisePerformance {
  const out: ExercisePerformance = { exerciseId, maxWeight: null, bestE1rm: null, maxVolume: null, history: [] };
  for (const session of [...sessions].sort((a, b) => a.at - b.at)) {
    const work = session.sets.filter((s) => s.reps > 0);
    if (work.length === 0) continue;
    const best = bests(work);
    // Volume counts drops; records stay on top segments.
    const volumeKg = round1(work.reduce((n, s) => n + volumeOf(s), 0));
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
