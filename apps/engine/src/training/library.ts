import type { Equipment, Exercise } from "@pulso/contract";

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
  // Shoulders
  ["press-militar", "Press militar", "shoulders", ["triceps"], "barbell", "compound"],
  ["press-hombro-mancuernas", "Press de hombro con mancuernas", "shoulders", ["triceps"], "dumbbell", "compound"],
  ["press-arnold", "Press Arnold", "shoulders", ["triceps"], "dumbbell", "compound"],
  ["press-hombro-maquina", "Press de hombro en máquina", "shoulders", ["triceps"], "machine", "compound"],
  ["elevaciones-laterales", "Elevaciones laterales", "shoulders", [], "dumbbell", "isolation"],
  ["elevaciones-laterales-polea", "Elevaciones laterales en polea", "shoulders", [], "cable", "isolation"],
  ["pajaros", "Pájaros", "shoulders", ["back"], "dumbbell", "isolation"],
  ["face-pull", "Face pull", "shoulders", ["back"], "cable", "isolation"],
  // Biceps
  ["curl-barra", "Curl con barra", "biceps", ["forearms"], "barbell", "isolation"],
  ["curl-mancuernas", "Curl con mancuernas", "biceps", ["forearms"], "dumbbell", "isolation"],
  ["curl-martillo", "Curl martillo", "biceps", ["forearms"], "dumbbell", "isolation"],
  ["curl-inclinado", "Curl inclinado con mancuernas", "biceps", [], "dumbbell", "isolation"],
  ["curl-predicador", "Curl predicador", "biceps", [], "barbell", "isolation"],
  ["curl-polea", "Curl en polea", "biceps", [], "cable", "isolation"],
  // Triceps
  ["press-banca-cerrado", "Press de banca agarre cerrado", "triceps", ["chest", "shoulders"], "barbell", "compound"],
  ["press-frances", "Press francés", "triceps", [], "barbell", "isolation"],
  ["extension-triceps-polea", "Extensión de tríceps en polea", "triceps", [], "cable", "isolation"],
  ["extension-triceps-sobre-cabeza", "Extensión de tríceps sobre la cabeza", "triceps", [], "dumbbell", "isolation"],
  ["patada-triceps", "Patada de tríceps", "triceps", [], "dumbbell", "isolation"],
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
  // Full body
  ["swing-kettlebell", "Swing con kettlebell", "full_body", ["glutes", "hamstrings", "back"], "kettlebell", "compound"],
  ["cargada-potencia", "Cargada de potencia", "full_body", ["back", "quads", "glutes"], "barbell", "compound"],
];

export const LIBRARY: Exercise[] = SEEDS.map(([id, name, muscle, secondary, equipment, kind]) => ({ id, name, muscle, secondary, equipment, kind }));

/** Smallest sensible jump per equipment, in kg. Bodyweight progresses by reps (or added load). */
export const INCREMENT_KG: Record<Equipment, number> = {
  barbell: 2.5,
  dumbbell: 2,
  machine: 5,
  cable: 2.5,
  kettlebell: 4,
  bodyweight: 0,
};
