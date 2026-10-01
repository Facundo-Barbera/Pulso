import type { Equipment, Exercise, Muscle } from "@pulso/contract";
import { ANATOMY } from "./anatomy";

/**
 * ExerciseDB V1 (AscendAPI), the free tier. Its terms forbid storing anything
 * it serves (text, metadata, GIFs) beyond a cache of at most one hour, so
 * Pulso only keeps the ExerciseDB id each library exercise maps to and
 * streams the GIF through the engine on demand.
 */
export const EDB_API = "https://oss.exercisedb.dev/api/v1";
export const EDB_MEDIA = "https://static.exercisedb.dev/media";
export const EDB_ATTRIBUTION = "Animación: ExerciseDB (AscendAPI)";

export type EdbExercise = {
  exerciseId: string;
  name: string;
  equipments: string[];
  targetMuscles: string[];
  secondaryMuscles: string[];
};

/** Library equipment → ExerciseDB's equipment names. */
export const EDB_EQUIPMENT: Record<Equipment, string[]> = {
  barbell: ["barbell", "olympic barbell", "ez bar"],
  dumbbell: ["dumbbell"],
  machine: ["leverage machine", "sled machine", "smith machine"],
  cable: ["cable"],
  bodyweight: ["bodyweight", "weighted", "ab wheel"],
  kettlebell: ["kettlebell"],
};

/** ExerciseDB muscle names → the body map's muscles. Unlisted ones (hip flexors, feet…) are not on the map. */
const EDB_MUSCLES: Record<string, Muscle[]> = {
  pectorals: ["chest"],
  "serratus anterior": ["chest"],
  deltoids: ["front_delts", "side_delts", "rear_delts"],
  "rear deltoids": ["rear_delts"],
  trapezius: ["traps"],
  "levator scapulae": ["traps", "neck"],
  sternocleidomastoid: ["neck"],
  "upper back": ["upper_back"],
  rhomboids: ["upper_back"],
  back: ["upper_back", "lats", "lower_back"],
  "latissimus dorsi": ["lats"],
  "erector spinae": ["lower_back"],
  biceps: ["biceps"],
  brachialis: ["biceps", "forearms"],
  triceps: ["triceps"],
  forearms: ["forearms"],
  "wrist flexors": ["forearms"],
  "wrist extensors": ["forearms"],
  "grip muscles": ["forearms"],
  abdominals: ["abs"],
  core: ["abs", "obliques"],
  obliques: ["obliques"],
  glutes: ["glutes"],
  quadriceps: ["quads"],
  hamstrings: ["hamstrings"],
  adductors: ["adductors"],
  abductors: ["abductors"],
  calves: ["calves"],
  soleus: ["calves"],
};

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9°]+/g, " ")
    .trim();

/** Character-bigram Dice coefficient on normalized names: 1 is identical. */
export function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (x === y) return 1;
  const grams = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) out.set(s.slice(i, i + 2), (out.get(s.slice(i, i + 2)) ?? 0) + 1);
    return out;
  };
  const gx = grams(x);
  const gy = grams(y);
  let shared = 0;
  for (const [g, n] of gx) shared += Math.min(n, gy.get(g) ?? 0);
  const total = Math.max(x.length - 1, 0) + Math.max(y.length - 1, 0);
  return total === 0 ? 0 : (2 * shared) / total;
}

export type Match = { exerciseId: string; candidate: EdbExercise | null; score: number };

/** Below this the best candidate is a different movement: no media rather than a wrong one. */
export const MIN_SCORE = 0.75;

/**
 * ExerciseDB exercises that could show a library exercise, best first: name
 * match on its English alias, preferring the same equipment. Only those at or
 * above `MIN_SCORE`. ExerciseDB repeats some names, so ties are ordered by id
 * to come out the same every run.
 */
export function rankCandidates(exercise: Pick<Exercise, "id" | "equipment">, catalog: EdbExercise[]): (Match & { candidate: EdbExercise })[] {
  const anatomy = ANATOMY[exercise.id];
  if (!anatomy) return [];
  const alias = anatomy.edb ?? anatomy.nameEn;
  const equipment = EDB_EQUIPMENT[exercise.equipment];
  return catalog
    .map((candidate) => {
      const sameEquipment = candidate.equipments.some((e) => equipment.includes(e.toLowerCase()));
      return { exerciseId: exercise.id, candidate, score: similarity(alias, candidate.name) * (sameEquipment ? 1 : 0.9) };
    })
    .filter((m) => m.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.candidate.exerciseId.localeCompare(b.candidate.exerciseId));
}

/** The best candidate, or none when nothing is close enough. */
export function matchExercise(exercise: Pick<Exercise, "id" | "equipment">, catalog: EdbExercise[]): Match {
  return rankCandidates(exercise, catalog)[0] ?? { exerciseId: exercise.id, candidate: null, score: 0 };
}

/** ExerciseDB target muscles the curated map misses entirely: worth a second look. */
export function muscleGaps(exerciseId: string, candidate: EdbExercise): string[] {
  const anatomy = ANATOMY[exerciseId];
  if (!anatomy) return candidate.targetMuscles;
  const mapped = new Set<Muscle>([...anatomy.primary, ...anatomy.secondary]);
  return candidate.targetMuscles.filter((m) => {
    const ours = EDB_MUSCLES[m.toLowerCase()];
    return ours !== undefined && !ours.some((x) => mapped.has(x));
  });
}
