import type { CardioModality, Equipment, Exercise } from "@pulso/contract";

type Seed = [id: string, name: string, muscle: Exercise["muscle"], secondary: Exercise["secondary"], equipment: Equipment, kind: Exercise["kind"]];

/** The seeded library. Ids are stable slugs: programs and logs point at them. */
const SEEDS: Seed[] = [
  // Chest
  ["press-banca", "Press de banca", "chest", ["triceps", "shoulders"], "barbell", "compound"],
  ["press-inclinado-barra", "Press inclinado con barra", "chest", ["shoulders", "triceps"], "barbell", "compound"],
  ["press-banca-mancuernas", "Press de banca con mancuernas", "chest", ["triceps", "shoulders"], "dumbbell", "compound"],
  ["press-inclinado-mancuernas", "Press inclinado con mancuernas", "chest", ["shoulders", "triceps"], "dumbbell", "compound"],
  ["press-pecho-maquina", "Press de pecho en máquina", "chest", ["triceps", "shoulders"], "machine", "compound"],
  ["fondos", "Fondos en paralelas", "chest", ["triceps", "shoulders"], "bodyweight", "compound"],
  ["flexiones", "Flexiones", "chest", ["triceps", "shoulders", "core"], "bodyweight", "compound"],
  ["aperturas-mancuernas", "Aperturas con mancuernas", "chest", [], "dumbbell", "isolation"],
  ["cruce-poleas", "Cruce de poleas", "chest", [], "cable", "isolation"],
  ["contractor-pecho", "Contractor de pecho", "chest", [], "machine", "isolation"],
  // Back
  ["peso-muerto", "Peso muerto", "back", ["glutes", "hamstrings", "forearms"], "barbell", "compound"],
  ["remo-barra", "Remo con barra", "back", ["biceps"], "barbell", "compound"],
  ["remo-mancuerna", "Remo con mancuerna", "back", ["biceps"], "dumbbell", "compound"],
  ["dominadas", "Dominadas", "back", ["biceps"], "bodyweight", "compound"],
  ["dominadas-supinas", "Dominadas supinas", "back", ["biceps"], "bodyweight", "compound"],
  ["jalon-pecho", "Jalón al pecho", "back", ["biceps"], "cable", "compound"],
  ["remo-polea-baja", "Remo en polea baja", "back", ["biceps"], "cable", "compound"],
  ["remo-maquina", "Remo en máquina", "back", ["biceps"], "machine", "compound"],
  ["pullover-polea", "Pullover en polea", "back", [], "cable", "isolation"],
  ["encogimientos", "Encogimientos con mancuernas", "back", ["forearms"], "dumbbell", "isolation"],
  ["hiperextensiones", "Hiperextensiones", "back", ["glutes", "hamstrings"], "bodyweight", "isolation"],
  ["remo-banda", "Remo con banda", "back", ["biceps"], "band", "compound"],
  // Shoulders
  ["press-militar", "Press militar", "shoulders", ["triceps"], "barbell", "compound"],
  ["press-hombro-mancuernas", "Press de hombro con mancuernas", "shoulders", ["triceps"], "dumbbell", "compound"],
  ["press-arnold", "Press Arnold", "shoulders", ["triceps"], "dumbbell", "compound"],
  ["press-hombro-maquina", "Press de hombro en máquina", "shoulders", ["triceps"], "machine", "compound"],
  ["elevaciones-laterales", "Elevaciones laterales", "shoulders", [], "dumbbell", "isolation"],
  ["elevaciones-laterales-polea", "Elevaciones laterales en polea", "shoulders", [], "cable", "isolation"],
  ["pajaros", "Pájaros", "shoulders", ["back"], "dumbbell", "isolation"],
  ["face-pull", "Face pull", "shoulders", ["back"], "cable", "isolation"],
  ["elevaciones-laterales-maquina", "Elevaciones laterales en máquina", "shoulders", [], "machine", "isolation"],
  ["pajaros-maquina", "Pájaros en máquina", "shoulders", ["back"], "machine", "isolation"],
  ["face-pull-banda", "Face pull con banda", "shoulders", ["back"], "band", "isolation"],
  // Biceps
  ["curl-barra", "Curl con barra", "biceps", ["forearms"], "barbell", "isolation"],
  ["curl-mancuernas", "Curl con mancuernas", "biceps", ["forearms"], "dumbbell", "isolation"],
  ["curl-martillo", "Curl martillo", "biceps", ["forearms"], "dumbbell", "isolation"],
  ["curl-inclinado", "Curl inclinado con mancuernas", "biceps", [], "dumbbell", "isolation"],
  ["curl-predicador", "Curl predicador", "biceps", [], "barbell", "isolation"],
  ["curl-polea", "Curl en polea", "biceps", [], "cable", "isolation"],
  ["curl-maquina", "Curl de bíceps en máquina", "biceps", [], "machine", "isolation"],
  ["curl-banda", "Curl con banda", "biceps", ["forearms"], "band", "isolation"],
  // Triceps
  ["press-banca-cerrado", "Press de banca agarre cerrado", "triceps", ["chest", "shoulders"], "barbell", "compound"],
  ["press-frances", "Press francés", "triceps", [], "barbell", "isolation"],
  ["extension-triceps-polea", "Extensión de tríceps en polea", "triceps", [], "cable", "isolation"],
  ["extension-triceps-sobre-cabeza", "Extensión de tríceps sobre la cabeza", "triceps", [], "dumbbell", "isolation"],
  ["patada-triceps", "Patada de tríceps", "triceps", [], "dumbbell", "isolation"],
  ["extension-triceps-maquina", "Extensión de tríceps en máquina", "triceps", [], "machine", "isolation"],
  ["extension-triceps-banda", "Extensión de tríceps con banda", "triceps", [], "band", "isolation"],
  // Forearms
  ["curl-muneca", "Curl de muñeca", "forearms", [], "dumbbell", "isolation"],
  // Quads
  ["sentadilla", "Sentadilla", "quads", ["glutes", "hamstrings", "core"], "barbell", "compound"],
  ["sentadilla-frontal", "Sentadilla frontal", "quads", ["glutes", "core"], "barbell", "compound"],
  ["sentadilla-goblet", "Sentadilla goblet", "quads", ["glutes"], "kettlebell", "compound"],
  ["sentadilla-hack", "Sentadilla hack", "quads", ["glutes"], "machine", "compound"],
  ["prensa", "Prensa de piernas", "quads", ["glutes"], "machine", "compound"],
  ["zancadas", "Zancadas con mancuernas", "quads", ["glutes", "hamstrings"], "dumbbell", "compound"],
  ["sentadilla-bulgara", "Sentadilla búlgara", "quads", ["glutes"], "dumbbell", "compound"],
  ["extension-cuadriceps", "Extensión de cuádriceps", "quads", [], "machine", "isolation"],
  // Hamstrings
  ["peso-muerto-rumano", "Peso muerto rumano", "hamstrings", ["glutes", "back"], "barbell", "compound"],
  ["buenos-dias", "Buenos días", "hamstrings", ["glutes", "back"], "barbell", "compound"],
  ["curl-femoral-tumbado", "Curl femoral tumbado", "hamstrings", [], "machine", "isolation"],
  ["curl-femoral-sentado", "Curl femoral sentado", "hamstrings", [], "machine", "isolation"],
  // Glutes
  ["hip-thrust", "Hip thrust", "glutes", ["hamstrings"], "barbell", "compound"],
  ["puente-gluteo", "Puente de glúteo", "glutes", ["hamstrings"], "bodyweight", "isolation"],
  ["patada-gluteo-polea", "Patada de glúteo en polea", "glutes", [], "cable", "isolation"],
  ["abduccion-cadera", "Abducción de cadera en máquina", "glutes", [], "machine", "isolation"],
  // Calves
  ["elevacion-talones-pie", "Elevación de talones de pie", "calves", [], "machine", "isolation"],
  ["elevacion-talones-sentado", "Elevación de talones sentado", "calves", [], "machine", "isolation"],
  // Core
  ["crunch-polea", "Crunch en polea", "core", [], "cable", "isolation"],
  ["elevacion-piernas-colgado", "Elevación de piernas colgado", "core", [], "bodyweight", "isolation"],
  ["rueda-abdominal", "Rueda abdominal", "core", ["shoulders"], "bodyweight", "isolation"],
  ["press-pallof", "Press Pallof", "core", [], "cable", "isolation"],
  ["crunch-maquina", "Crunch en máquina", "core", [], "machine", "isolation"],
  // Full body
  ["swing-kettlebell", "Swing con kettlebell", "full_body", ["glutes", "hamstrings", "back"], "kettlebell", "compound"],
  ["cargada-potencia", "Cargada de potencia", "full_body", ["back", "quads", "glutes"], "barbell", "compound"],
  // Cardio
  ["caminadora", "Caminadora", "cardio", ["quads", "calves"], "machine", "cardio"],
  ["eliptica", "Elíptica", "cardio", ["quads", "glutes"], "machine", "cardio"],
  ["bici-estatica", "Bici estática", "cardio", ["quads"], "machine", "cardio"],
  ["remo-ergometro", "Remo (máquina de cardio)", "cardio", ["back", "quads"], "machine", "cardio"],
  ["escaladora", "Escaladora", "cardio", ["glutes", "quads"], "machine", "cardio"],
  ["correr", "Correr", "cardio", ["quads", "calves"], "bodyweight", "cardio"],
  ["caminar", "Caminar", "cardio", ["quads", "calves"], "bodyweight", "cardio"],
  ["saltar-cuerda", "Saltar la cuerda", "cardio", ["calves", "shoulders"], "bodyweight", "cardio"],
  ["hiit", "HIIT", "cardio", ["full_body"], "bodyweight", "cardio"],
];

/**
 * Cardio exercises: their modality (what the phone writes to Salud), how hard
 * they usually are (1 easy … 3 hard) and whether they pound the joints. The
 * last two drive cardio alternatives.
 */
export const CARDIO: Record<string, { modality: CardioModality; intensity: 1 | 2 | 3; impact: "low" | "high" }> = {
  caminadora: { modality: "treadmill", intensity: 2, impact: "high" },
  eliptica: { modality: "elliptical", intensity: 2, impact: "low" },
  "bici-estatica": { modality: "bike", intensity: 2, impact: "low" },
  "remo-ergometro": { modality: "rower", intensity: 2, impact: "low" },
  escaladora: { modality: "stairs", intensity: 3, impact: "low" },
  correr: { modality: "run", intensity: 3, impact: "high" },
  caminar: { modality: "walk", intensity: 1, impact: "low" },
  "saltar-cuerda": { modality: "jump_rope", intensity: 3, impact: "high" },
  hiit: { modality: "hiit", intensity: 3, impact: "high" },
};

export const LIBRARY: Exercise[] = SEEDS.map(([id, name, muscle, secondary, equipment, kind]) => ({ id, name, muscle, secondary, equipment, kind }));

/** Smallest sensible jump per equipment, in kg. Bodyweight and bands progress by reps (or added load). */
export const INCREMENT_KG: Record<Equipment, number> = {
  barbell: 2.5,
  dumbbell: 2,
  machine: 5,
  cable: 2.5,
  kettlebell: 4,
  bodyweight: 0,
  band: 0,
};
