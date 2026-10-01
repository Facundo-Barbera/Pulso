/** Training: exercise library, programs the Coach writes, logged strength sessions. Weights are kg, times epoch ms. */

export type MuscleGroup =
  | "chest"
  | "back"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "forearms"
  | "quads"
  | "hamstrings"
  | "glutes"
  | "calves"
  | "core"
  | "full_body";

export type Equipment = "barbell" | "dumbbell" | "machine" | "cable" | "bodyweight" | "kettlebell";

export type Exercise = {
  /** Stable slug, e.g. `press-banca`. */
  id: string;
  /** Spanish display name. */
  name: string;
  muscle: MuscleGroup;
  secondary: MuscleGroup[];
  equipment: Equipment;
  kind: "compound" | "isolation";
};

/** One exercise as prescribed inside a program day. */
export type ProgramExercise = {
  id: string;
  exerciseId: string;
  exerciseName: string;
  equipment: Equipment;
  sets: number;
  repMin: number;
  repMax: number;
  targetRpe: number | null;
  targetRir: number | null;
  restSeconds: number;
  notes: string | null;
};

export type ProgramDay = {
  id: string;
  name: string;
  focus: string | null;
  /** ISO weekday, 1 = Monday … 7 = Sunday, when the day is pinned to one. */
  weekday: number | null;
  exercises: ProgramExercise[];
};

export type Program = {
  id: string;
  name: string;
  goal: string;
  weeks: number;
  notes: string | null;
  active: boolean;
  createdAt: number;
  days: ProgramDay[];
};

export type ProgramExerciseInput = Omit<ProgramExercise, "id" | "exerciseName" | "equipment" | "targetRpe" | "targetRir" | "notes"> & {
  targetRpe?: number | null;
  targetRir?: number | null;
  notes?: string | null;
};
export type ProgramDayInput = { name: string; focus?: string | null; weekday?: number | null; exercises: ProgramExerciseInput[] };
export type ProgramInput = { name: string; goal: string; weeks: number; notes?: string | null; days: ProgramDayInput[] };

/** Next-load suggestion from double progression. `weightKg` is null without history. */
export type LoadSuggestion = {
  exerciseId: string;
  weightKg: number | null;
  reps: number;
  reason: string;
  lastSessionAt: number | null;
};

/** `GET /api/mobile/training/program`. `suggestions` is keyed by `ProgramExercise.id`. */
export type ActiveProgramResponse = {
  program: Program | null;
  nextDayId: string | null;
  suggestions: Record<string, LoadSuggestion>;
};

export type SetLog = {
  exerciseId: string;
  /** 0-based order within the exercise in this session. */
  setIndex: number;
  weightKg: number;
  reps: number;
  rpe: number | null;
  doneAt: number;
};

export type TrainingSession = {
  id: string;
  programId: string | null;
  dayId: string | null;
  name: string;
  startedAt: number;
  endedAt: number;
  notes: string | null;
  sets: SetLog[];
};

/** What the phone posts when a session ends. `id` is client-made, so retries upsert. */
export type SessionInput = Omit<TrainingSession, "programId" | "dayId" | "notes"> & {
  programId?: string | null;
  dayId?: string | null;
  notes?: string | null;
};

export type PersonalRecord = {
  exerciseId: string;
  exerciseName: string;
  /** e1rm: Epley estimate; weight: heaviest load; reps: most reps on a bodyweight set. */
  kind: "e1rm" | "weight" | "reps";
  value: number;
  previous: number | null;
};

export type SessionSaved = { session: TrainingSession; prs: PersonalRecord[] };

/** One session's best work on an exercise. */
export type HistoryPoint = {
  sessionId: string;
  date: number;
  topWeightKg: number;
  bestE1rm: number;
  totalReps: number;
  volumeKg: number;
  sets: SetLog[];
};

export type ExerciseHistory = {
  exercise: Exercise;
  points: HistoryPoint[];
  bestE1rm: number | null;
  heaviestKg: number | null;
};

/** Fine-grained muscles for the body map (front and back views). */
export type Muscle =
  | "chest"
  | "front_delts"
  | "side_delts"
  | "rear_delts"
  | "traps"
  | "upper_back"
  | "lats"
  | "lower_back"
  | "biceps"
  | "triceps"
  | "forearms"
  | "abs"
  | "obliques"
  | "glutes"
  | "quads"
  | "hamstrings"
  | "adductors"
  | "abductors"
  | "calves"
  | "neck";

/**
 * Demonstration media, downloaded once by the engine and served to the phone.
 * URLs are engine-relative and bearer-protected (`/api/mobile/training/media/...`).
 */
export type ExerciseMedia = {
  /** Looping demonstration (GIF). */
  animation: string | null;
  /** A still frame for lists and thumbnails. */
  thumbnail: string | null;
  source: "exercisedb" | null;
  /** Credit the source requires, shown under the media. */
  attribution: string | null;
};

/** A curated technique video; played in YouTube's own embedded player, never cached. */
export type ExerciseVideo = { youtubeId: string; title: string; channel: string; lang: "es" | "en" };

/** `GET /api/mobile/training/exercises/:id` — everything the exercise screen shows. */
export type ExerciseDetail = Exercise & {
  nameEn: string | null;
  primaryMuscles: Muscle[];
  secondaryMuscles: Muscle[];
  /** Spanish, one step per item. */
  instructions: string[];
  /** Short Spanish cues ("Junta las escápulas"). */
  tips: string[];
  media: ExerciseMedia;
  videos: ExerciseVideo[];
  /** The person's own notes; `PUT /api/mobile/training/exercises/:id/notes` `{ notes }`. */
  notes: string | null;
};

/** `GET /api/mobile/training/exercises/:id/performance` — the Rendimiento view. */
export type ExercisePerformance = {
  exerciseId: string;
  maxWeight: { kg: number; reps: number; at: number } | null;
  bestE1rm: { kg: number; at: number } | null;
  /** Most volume (kg × reps) in one session. */
  maxVolume: { kg: number; at: number } | null;
  /** Oldest first, one point per session. */
  history: { at: number; topWeightKg: number; e1rm: number; volumeKg: number }[];
};
