import type { Equipment, Exercise, Muscle, SimilarExercise } from "@pulso/contract";
import { ANATOMY } from "./anatomy";
import { CARDIO } from "./library";
import { listExercises, trainingSettings } from "./store";

/** Movement pattern per strength exercise. Two exercises with the same one train the same way. */
const PATTERN: Record<string, string> = {
  "press-banca": "horizontal_push",
  "press-inclinado-barra": "horizontal_push",
  "press-banca-mancuernas": "horizontal_push",
  "press-inclinado-mancuernas": "horizontal_push",
  "press-pecho-maquina": "horizontal_push",
  flexiones: "horizontal_push",
  fondos: "dip",
  "press-banca-cerrado": "horizontal_push",
  "aperturas-mancuernas": "fly",
  "cruce-poleas": "fly",
  "contractor-pecho": "fly",
  "peso-muerto": "hinge",
  "peso-muerto-rumano": "hinge",
  "buenos-dias": "hinge",
  hiperextensiones: "hinge",
  "swing-kettlebell": "hinge",
  "remo-barra": "horizontal_pull",
  "remo-mancuerna": "horizontal_pull",
  "remo-polea-baja": "horizontal_pull",
  "remo-maquina": "horizontal_pull",
  "remo-banda": "horizontal_pull",
  dominadas: "vertical_pull",
  "dominadas-supinas": "vertical_pull",
  "jalon-pecho": "vertical_pull",
  "pullover-polea": "vertical_pull",
  encogimientos: "shrug",
  "press-militar": "vertical_push",
  "press-hombro-mancuernas": "vertical_push",
  "press-arnold": "vertical_push",
  "press-hombro-maquina": "vertical_push",
  "elevaciones-laterales": "lateral_raise",
  "elevaciones-laterales-polea": "lateral_raise",
  "elevaciones-laterales-maquina": "lateral_raise",
  pajaros: "rear_delt",
  "pajaros-maquina": "rear_delt",
  "face-pull": "rear_delt",
  "face-pull-banda": "rear_delt",
  "curl-barra": "elbow_flexion",
  "curl-mancuernas": "elbow_flexion",
  "curl-martillo": "elbow_flexion",
  "curl-inclinado": "elbow_flexion",
  "curl-predicador": "elbow_flexion",
  "curl-polea": "elbow_flexion",
  "curl-maquina": "elbow_flexion",
  "curl-banda": "elbow_flexion",
  "press-frances": "elbow_extension",
  "extension-triceps-polea": "elbow_extension",
  "extension-triceps-sobre-cabeza": "elbow_extension",
  "patada-triceps": "elbow_extension",
  "extension-triceps-maquina": "elbow_extension",
  "extension-triceps-banda": "elbow_extension",
  "curl-muneca": "wrist_flexion",
  sentadilla: "squat",
  "sentadilla-frontal": "squat",
  "sentadilla-goblet": "squat",
  "sentadilla-hack": "squat",
  prensa: "squat",
  zancadas: "lunge",
  "sentadilla-bulgara": "lunge",
  "extension-cuadriceps": "knee_extension",
  "curl-femoral-tumbado": "knee_flexion",
  "curl-femoral-sentado": "knee_flexion",
  "hip-thrust": "hip_extension",
  "puente-gluteo": "hip_extension",
  "patada-gluteo-polea": "hip_extension",
  "abduccion-cadera": "hip_abduction",
  "elevacion-talones-pie": "calf_raise",
  "elevacion-talones-sentado": "calf_raise",
  "crunch-polea": "trunk_flexion",
  "crunch-maquina": "trunk_flexion",
  "elevacion-piernas-colgado": "trunk_flexion",
  "rueda-abdominal": "anti_extension",
  "press-pallof": "anti_rotation",
  "cargada-potencia": "olympic",
};

/** Patterns close enough to stand in for each other, both ways. */
const RELATED: [string, string][] = [
  ["squat", "lunge"],
  ["squat", "knee_extension"],
  ["hinge", "hip_extension"],
  ["horizontal_push", "dip"],
  ["horizontal_push", "fly"],
  ["horizontal_pull", "vertical_pull"],
  ["horizontal_pull", "rear_delt"],
  ["vertical_push", "lateral_raise"],
  ["trunk_flexion", "anti_extension"],
  ["anti_extension", "anti_rotation"],
];
const related = (a: string, b: string) => RELATED.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

const EQUIPMENT_ES: Record<Equipment, string> = {
  machine: "Máquina",
  cable: "Polea",
  dumbbell: "Mancuernas",
  barbell: "Barra",
  bodyweight: "Peso corporal",
  band: "Bandas",
  kettlebell: "Kettlebell",
};

/** |a ∩ b| / |a ∪ b|; 0 when both are empty. */
function jaccard<T>(a: T[], b: T[]): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  return a.filter((x) => b.includes(x)).length / union.size;
}

const fine = (id: string): { primary: Muscle[]; secondary: Muscle[] } => ANATOMY[id] ?? { primary: [], secondary: [] };

/** 15 points for the most preferred equipment, sliding down the list; 0 when not preferred. */
function preferenceBonus(equipment: Equipment, preferred: Equipment[]): number {
  const rank = preferred.indexOf(equipment);
  return rank === -1 ? 0 : (15 * (preferred.length - rank)) / preferred.length;
}

type Scored = { score: number; reasons: string[] } | null;

/**
 * Strength similarity, 0–85 before the preference bonus. Candidates must work
 * the same target: the same primary muscle group, or at least one shared
 * primary muscle on the body map; anything else is not an alternative.
 * - Target (≤ 40): same primary group 30, plus 10 × overlap of the fine primary muscles.
 *   A different group that shares a primary muscle gets 10 plus that overlap.
 * - Movement pattern (≤ 30): same 30, related (squat ~ lunge, row ~ pulldown…) 12.
 *   It outweighs the fine muscle overlap: a leg press replaces a squat better than a lunge.
 * - Secondary muscles (≤ 10): 10 × overlap of the fine secondary muscles.
 * - Kind (5): both compound or both isolation.
 */
function strengthScore(from: Exercise, to: Exercise): Scored {
  const a = fine(from.id);
  const b = fine(to.id);
  const primary = jaccard(a.primary, b.primary);
  const sameGroup = from.muscle === to.muscle;
  if (!sameGroup && primary === 0) return null;
  const reasons: string[] = [];
  let score = (sameGroup ? 30 : 10) + 10 * primary;
  if (sameGroup) reasons.push("Mismo músculo");
  const [pa, pb] = [PATTERN[from.id], PATTERN[to.id]];
  if (pa && pa === pb) {
    score += 30;
    reasons.push("Mismo movimiento");
  } else if (pa && pb && related(pa, pb)) {
    score += 12;
    reasons.push("Movimiento parecido");
  }
  score += 10 * jaccard(a.secondary, b.secondary);
  if (from.kind === to.kind) score += 5;
  return { score, reasons };
}

const INTENSITY_ES = ["", "Suave", "Moderado", "Intenso"];

/**
 * Cardio similarity, 0–85 before the preference bonus: any cardio replaces any
 * cardio (30), then the same usual intensity (30, one step apart 15) and the
 * same impact on the joints (25), so a treadmill run swaps first for stairs or
 * a rower, not for a stroll.
 */
function cardioScore(from: Exercise, to: Exercise): Scored {
  const a = CARDIO[from.id];
  const b = CARDIO[to.id];
  if (!a || !b) return null;
  const reasons: string[] = [];
  let score = 30;
  const gap = Math.abs(a.intensity - b.intensity);
  if (gap === 0) {
    score += 30;
    reasons.push(`${INTENSITY_ES[b.intensity]}, como el original`);
  } else if (gap === 1) score += 15;
  if (a.impact === b.impact) {
    score += 25;
    if (b.impact === "low") reasons.push("Bajo impacto");
  }
  return { score, reasons };
}

/**
 * Alternatives to an exercise, best first: strength for strength, cardio for
 * cardio. Score 0–100 = similarity (≤ 85, see `strengthScore` / `cardioScore`)
 * + up to 15 for the person's preferred equipment, so among equally good
 * matches their favourite equipment comes first (machines, for this person).
 * `equipment` keeps only those; `preferred` defaults to the stored setting.
 */
export function similarExercises(
  exerciseId: string,
  options: { equipment?: Equipment[]; limit?: number; preferred?: Equipment[] } = {},
): SimilarExercise[] | undefined {
  const all = listExercises();
  const from = all.find((e) => e.id === exerciseId);
  if (!from) return undefined;
  const preferred = options.preferred ?? trainingSettings().preferredEquipment;
  const cardio = from.kind === "cardio";
  const out: SimilarExercise[] = [];
  for (const to of all) {
    if (to.id === from.id || (to.kind === "cardio") !== cardio) continue;
    if (options.equipment?.length && !options.equipment.includes(to.equipment)) continue;
    const scored = cardio ? cardioScore(from, to) : strengthScore(from, to);
    if (!scored) continue;
    const bonus = preferenceBonus(to.equipment, preferred);
    const reasons = bonus > 0 ? [...scored.reasons, EQUIPMENT_ES[to.equipment]] : scored.reasons;
    out.push({ ...to, score: Math.round(scored.score + bonus), reasons, preferred: bonus > 0 });
  }
  const rank = (e: Equipment) => (preferred.includes(e) ? preferred.indexOf(e) : preferred.length);
  return out
    .sort((x, y) => y.score - x.score || rank(x.equipment) - rank(y.equipment) || x.name.localeCompare(y.name, "es"))
    .slice(0, options.limit ?? 12);
}
