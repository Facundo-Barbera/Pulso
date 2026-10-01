import type { Muscle } from "@pulso/contract";

type Anatomy = {
  /** English display name; the ExerciseDB matcher searches for it unless `edb` is set. */
  nameEn: string;
  /** ExerciseDB's own name when it differs from the common English one. */
  edb?: string;
  primary: Muscle[];
  secondary: Muscle[];
};

/** Curated body map per library exercise, keyed by library id. */
export const ANATOMY: Record<string, Anatomy> = {
  // Chest
  "press-banca": { nameEn: "Barbell bench press", primary: ["chest"], secondary: ["front_delts", "triceps"] },
  "press-inclinado-barra": { nameEn: "Barbell incline bench press", primary: ["chest", "front_delts"], secondary: ["triceps"] },
  "press-banca-mancuernas": { nameEn: "Dumbbell bench press", primary: ["chest"], secondary: ["front_delts", "triceps"] },
  "press-inclinado-mancuernas": { nameEn: "Dumbbell incline bench press", primary: ["chest", "front_delts"], secondary: ["triceps"] },
  "press-pecho-maquina": { nameEn: "Machine chest press", primary: ["chest"], secondary: ["front_delts", "triceps"] },
  fondos: { nameEn: "Dips", edb: "chest dip", primary: ["chest", "triceps"], secondary: ["front_delts"] },
  flexiones: { nameEn: "Push-up", primary: ["chest"], secondary: ["front_delts", "triceps", "abs"] },
  "aperturas-mancuernas": { nameEn: "Dumbbell fly", primary: ["chest"], secondary: ["front_delts"] },
  "cruce-poleas": { nameEn: "Cable crossover", primary: ["chest"], secondary: ["front_delts"] },
  "contractor-pecho": { nameEn: "Pec deck", edb: "machine seated fly", primary: ["chest"], secondary: ["front_delts"] },
  // Back
  "peso-muerto": { nameEn: "Deadlift", edb: "barbell deadlift", primary: ["glutes", "hamstrings", "lower_back"], secondary: ["quads", "traps", "lats", "forearms"] },
  "remo-barra": { nameEn: "Barbell row", edb: "barbell bent over row", primary: ["upper_back", "lats"], secondary: ["rear_delts", "biceps", "lower_back"] },
  "remo-mancuerna": { nameEn: "One-arm dumbbell row", edb: "dumbbell bent over row", primary: ["lats", "upper_back"], secondary: ["rear_delts", "biceps"] },
  dominadas: { nameEn: "Pull-up", primary: ["lats"], secondary: ["upper_back", "biceps", "forearms"] },
  "dominadas-supinas": { nameEn: "Chin-up", primary: ["lats", "biceps"], secondary: ["upper_back", "forearms"] },
  "jalon-pecho": { nameEn: "Lat pulldown", edb: "cable pulldown", primary: ["lats"], secondary: ["upper_back", "biceps"] },
  "remo-polea-baja": { nameEn: "Seated cable row", edb: "cable seated row", primary: ["upper_back", "lats"], secondary: ["rear_delts", "biceps"] },
  "remo-maquina": { nameEn: "Machine row", edb: "machine seated row", primary: ["upper_back", "lats"], secondary: ["rear_delts", "biceps"] },
  "pullover-polea": { nameEn: "Cable pullover", edb: "cable straight arm pulldown", primary: ["lats"], secondary: ["triceps"] },
  encogimientos: { nameEn: "Dumbbell shrug", primary: ["traps"], secondary: ["forearms"] },
  hiperextensiones: { nameEn: "Back extension", edb: "hyperextension", primary: ["lower_back"], secondary: ["glutes", "hamstrings"] },
  // Shoulders
  "press-militar": { nameEn: "Overhead press", edb: "barbell standing close-grip military press", primary: ["front_delts"], secondary: ["side_delts", "triceps", "upper_back"] },
  "press-hombro-mancuernas": { nameEn: "Dumbbell shoulder press", edb: "dumbbell seated shoulder press", primary: ["front_delts"], secondary: ["side_delts", "triceps"] },
  "press-arnold": { nameEn: "Dumbbell arnold press", primary: ["front_delts", "side_delts"], secondary: ["triceps"] },
  "press-hombro-maquina": { nameEn: "Machine shoulder press", primary: ["front_delts"], secondary: ["side_delts", "triceps"] },
  "elevaciones-laterales": { nameEn: "Dumbbell lateral raise", primary: ["side_delts"], secondary: ["traps"] },
  "elevaciones-laterales-polea": { nameEn: "Cable lateral raise", primary: ["side_delts"], secondary: ["traps"] },
  pajaros: { nameEn: "Dumbbell rear delt fly", edb: "dumbbell rear lateral raise", primary: ["rear_delts"], secondary: ["upper_back"] },
  "face-pull": { nameEn: "Face pull", edb: "cable standing rear delt row (with rope)", primary: ["rear_delts"], secondary: ["upper_back", "traps"] },
  // Biceps
  "curl-barra": { nameEn: "Barbell curl", primary: ["biceps"], secondary: ["forearms"] },
  "curl-mancuernas": { nameEn: "Dumbbell curl", edb: "dumbbell biceps curl", primary: ["biceps"], secondary: ["forearms"] },
  "curl-martillo": { nameEn: "Dumbbell hammer curl", primary: ["biceps", "forearms"], secondary: [] },
  "curl-inclinado": { nameEn: "Dumbbell incline curl", primary: ["biceps"], secondary: ["forearms"] },
  "curl-predicador": { nameEn: "Barbell preacher curl", primary: ["biceps"], secondary: ["forearms"] },
  "curl-polea": { nameEn: "Cable curl", primary: ["biceps"], secondary: ["forearms"] },
  // Triceps
  "press-banca-cerrado": { nameEn: "Close-grip bench press", edb: "barbell close-grip bench press", primary: ["triceps", "chest"], secondary: ["front_delts"] },
  "press-frances": { nameEn: "Skull crusher", edb: "barbell lying triceps extension skull crusher", primary: ["triceps"], secondary: [] },
  "extension-triceps-polea": { nameEn: "Triceps pushdown", edb: "cable pushdown", primary: ["triceps"], secondary: [] },
  "extension-triceps-sobre-cabeza": { nameEn: "Overhead dumbbell triceps extension", edb: "dumbbell seated triceps extension", primary: ["triceps"], secondary: [] },
  "patada-triceps": { nameEn: "Dumbbell triceps kickback", edb: "dumbbell kickback", primary: ["triceps"], secondary: [] },
  // Forearms
  "curl-muneca": { nameEn: "Dumbbell wrist curl", edb: "dumbbell seated palms up wrist curl", primary: ["forearms"], secondary: [] },
  // Quads
  sentadilla: { nameEn: "Barbell back squat", edb: "barbell full squat", primary: ["quads", "glutes"], secondary: ["adductors", "hamstrings", "lower_back", "abs"] },
  "sentadilla-frontal": { nameEn: "Barbell front squat", primary: ["quads"], secondary: ["glutes", "adductors", "upper_back", "abs"] },
  "sentadilla-goblet": { nameEn: "Kettlebell goblet squat", primary: ["quads", "glutes"], secondary: ["adductors", "abs"] },
  "sentadilla-hack": { nameEn: "Hack squat", edb: "sled hack squat", primary: ["quads"], secondary: ["glutes", "adductors"] },
  prensa: { nameEn: "Leg press", edb: "sled 45° leg press", primary: ["quads"], secondary: ["glutes", "adductors"] },
  zancadas: { nameEn: "Dumbbell lunge", primary: ["quads", "glutes"], secondary: ["adductors", "hamstrings"] },
  "sentadilla-bulgara": { nameEn: "Bulgarian split squat", edb: "dumbbell single leg split squat", primary: ["quads", "glutes"], secondary: ["adductors", "hamstrings"] },
  "extension-cuadriceps": { nameEn: "Machine leg extension", primary: ["quads"], secondary: [] },
  // Hamstrings
  "peso-muerto-rumano": { nameEn: "Barbell romanian deadlift", primary: ["hamstrings", "glutes"], secondary: ["lower_back", "forearms"] },
  "buenos-dias": { nameEn: "Barbell good morning", primary: ["hamstrings", "lower_back"], secondary: ["glutes"] },
  "curl-femoral-tumbado": { nameEn: "Lying leg curl", edb: "machine lying leg curl", primary: ["hamstrings"], secondary: ["calves"] },
  "curl-femoral-sentado": { nameEn: "Seated leg curl", edb: "machine seated leg curl", primary: ["hamstrings"], secondary: [] },
  // Glutes
  "hip-thrust": { nameEn: "Barbell hip thrust", edb: "barbell glute bridge two-leg on bench", primary: ["glutes"], secondary: ["hamstrings", "quads"] },
  "puente-gluteo": { nameEn: "Glute bridge", edb: "low glute bridge on floor", primary: ["glutes"], secondary: ["hamstrings"] },
  "patada-gluteo-polea": { nameEn: "Cable glute kickback", edb: "cable standing hip extension", primary: ["glutes"], secondary: ["hamstrings"] },
  "abduccion-cadera": { nameEn: "Hip abduction machine", edb: "machine seated hip abduction", primary: ["abductors", "glutes"], secondary: [] },
  // Calves
  "elevacion-talones-pie": { nameEn: "Standing calf raise", edb: "machine standing calf raise", primary: ["calves"], secondary: [] },
  "elevacion-talones-sentado": { nameEn: "Seated calf raise", edb: "machine seated calf raise", primary: ["calves"], secondary: [] },
  // Core
  "crunch-polea": { nameEn: "Cable crunch", edb: "cable kneeling crunch", primary: ["abs"], secondary: ["obliques"] },
  "elevacion-piernas-colgado": { nameEn: "Hanging leg raise", primary: ["abs"], secondary: ["obliques", "forearms"] },
  "rueda-abdominal": { nameEn: "Ab wheel rollout", edb: "wheel rollout", primary: ["abs"], secondary: ["obliques", "lats", "front_delts"] },
  "press-pallof": { nameEn: "Pallof press", edb: "band horizontal pallof press", primary: ["obliques", "abs"], secondary: [] },
  // Full body
  "swing-kettlebell": { nameEn: "Kettlebell swing", primary: ["glutes", "hamstrings"], secondary: ["lower_back", "abs", "front_delts"] },
  "cargada-potencia": { nameEn: "Power clean", primary: ["glutes", "hamstrings", "quads"], secondary: ["traps", "upper_back", "calves"] },
};
