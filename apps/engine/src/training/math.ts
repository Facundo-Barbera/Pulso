import type { LoadSuggestion, PersonalRecord, SetLog } from "@pulso/contract";

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
