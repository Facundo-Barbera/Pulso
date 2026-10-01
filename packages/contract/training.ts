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
  | "full_body"
  /** Cardio blocks (treadmill, bike…): their primary "muscle" is the heart. */
  | "cardio";

export type Equipment = "barbell" | "dumbbell" | "machine" | "cable" | "bodyweight" | "kettlebell" | "band";

/** Strength exercises are compound or isolation; cardio is timed, not counted in sets. */
export type ExerciseKind = "compound" | "isolation" | "cardio";

/** What kind of cardio a cardio exercise is; the phone maps it to a Salud workout type. */
export type CardioModality = "treadmill" | "elliptical" | "bike" | "rower" | "stairs" | "run" | "walk" | "jump_rope" | "hiit";

export type Exercise = {
  /** Stable slug, e.g. `press-banca`. */
  id: string;
  /** Spanish display name. */
  name: string;
  muscle: MuscleGroup;
  secondary: MuscleGroup[];
  equipment: Equipment;
  kind: ExerciseKind;
  /** Only on cardio exercises. */
  modality?: CardioModality | null;
} & ListMedia;

// ── Cardio ───────────────────────────────────────────────────────────────────

/** Heart-rate zone: 1 recovery, 2 aerobic base, 3 tempo, 4 threshold, 5 maximum. */
export type HrZone = 1 | 2 | 3 | 4 | 5;

/** A zone's band in beats per minute, from the person's max (and resting, when known) heart rate. */
export type HrZoneRange = { zone: HrZone; minBpm: number; maxBpm: number };

/** Work/recovery repeats, e.g. 8 × 30 s rápido / 90 s suave. */
export type CardioIntervals = {
  rounds: number;
  workSeconds: number;
  restSeconds: number;
  /** Spanish cue for the work part, e.g. "Rápido", "Sprint". */
  workLabel?: string | null;
  /** Spanish cue for the recovery part, e.g. "Suave". */
  restLabel?: string | null;
};

/**
 * What a cardio block asks for. Every field is optional; most blocks set a
 * duration and a zone. With `intervals`, the duration is the intervals' total
 * (plus any warm-up the notes mention).
 */
export type CardioTarget = {
  durationMinutes?: number | null;
  distanceKm?: number | null;
  /** Treadmill or bike speed, km/h. */
  speedKmh?: number | null;
  /** Running pace, minutes per km (5.5 = 5:30/km). */
  paceMinPerKm?: number | null;
  /** Treadmill incline, %. */
  inclinePercent?: number | null;
  /** Machine resistance or level (elliptical, bike, stairs). */
  level?: number | null;
  zone?: HrZone | null;
  intervals?: CardioIntervals | null;
};

/** What was done in a cardio block, logged when it ends. */
export type CardioLog = {
  exerciseId: string;
  durationSeconds: number;
  distanceKm: number | null;
  level: number | null;
  inclinePercent: number | null;
  avgHr: number | null;
  kcal: number | null;
  doneAt: number;
};

/**
 * Demonstration media on list rows (`GET /api/mobile/training/exercises`, program
 * exercises): same URLs as `ExerciseMedia`. Absent or null without media.
 */
export type ListMedia = { thumbnail?: string | null; animation?: string | null };

/**
 * One exercise as prescribed inside a program day. Cardio blocks have `kind`
 * "cardio" and a `cardio` target; their sets/reps are 1 and rest 0.
 */
export type ProgramExercise = {
  id: string;
  exerciseId: string;
  exerciseName: string;
  equipment: Equipment;
  kind: ExerciseKind;
  modality?: CardioModality | null;
  sets: number;
  repMin: number;
  repMax: number;
  targetRpe: number | null;
  targetRir: number | null;
  restSeconds: number;
  notes: string | null;
  cardio: CardioTarget | null;
} & ListMedia;

export type ProgramDay = {
  id: string;
  name: string;
  focus: string | null;
  /** ISO weekday, 1 = Monday … 7 = Sunday, when the day is pinned to one. */
  weekday: number | null;
  exercises: ProgramExercise[];
  /** True when `exercises` are today's one-off changes ("solo hoy"), not the program's own list. */
  overridden?: boolean;
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

/** Strength exercises need sets, reps and rest; cardio blocks need `cardio` and may omit them. */
export type ProgramExerciseInput = {
  exerciseId: string;
  sets?: number;
  repMin?: number;
  repMax?: number;
  targetRpe?: number | null;
  targetRir?: number | null;
  restSeconds?: number;
  notes?: string | null;
  cardio?: CardioTarget | null;
};
export type ProgramDayInput = { name: string; focus?: string | null; weekday?: number | null; exercises: ProgramExerciseInput[] };
export type ProgramInput = { name: string; goal: string; weeks: number; notes?: string | null; days: ProgramDayInput[] };

// ── Editing a day ────────────────────────────────────────────────────────────

/** "today": only today's session of that day (a one-off override). "always": the program itself. */
export type EditScope = "today" | "always";

/** One exercise of a day being rewritten. `id` keeps an existing `ProgramExercise` (and its load suggestion); omit it for a new one. */
export type DayExerciseInput = ProgramExerciseInput & { id?: string | null };

/**
 * `PUT /api/mobile/training/program/days/:dayId` — the day's whole exercise list
 * in its new order (reorder, add, remove, swap and edit targets in one write).
 * Returns `ActiveProgramResponse`. "always" also drops today's override of that
 * day, so what the person saw is what the program becomes.
 * `DELETE` on the same path drops today's override and returns `ActiveProgramResponse`.
 */
export type DayEdit = { scope: EditScope; exercises: DayExerciseInput[] };

// ── Alternatives and preferences ─────────────────────────────────────────────

/**
 * `GET /api/mobile/training/exercises/:id/similar?equipment=machine,cable&limit=20`
 * → `{ exercises: SimilarExercise[] }`, best first. `score` is 0–100: muscle match
 * dominates, then movement pattern, then the person's equipment preference.
 */
export type SimilarExercise = Exercise & {
  score: number;
  /** Short Spanish reasons, e.g. ["Mismo músculo", "Mismo patrón", "Máquina"]. */
  reasons: string[];
  /** Its equipment is one the person prefers. */
  preferred: boolean;
};

/** `GET`/`PUT /api/mobile/training/settings`. */
export type TrainingSettings = {
  /** Most preferred first, e.g. ["machine", "cable"]. Alternatives and programs favour these. Empty = no preference. */
  preferredEquipment: Equipment[];
};

/** Next-load suggestion from double progression. `weightKg` is null without history. */
export type LoadSuggestion = {
  exerciseId: string;
  weightKg: number | null;
  reps: number;
  reason: string;
  lastSessionAt: number | null;
};

/**
 * `GET /api/mobile/training/program`. `suggestions` is keyed by `ProgramExercise.id`.
 * Days carry today's "solo hoy" changes when there are any (`overridden`).
 */
export type ActiveProgramResponse = {
  program: Program | null;
  nextDayId: string | null;
  suggestions: Record<string, LoadSuggestion>;
  /** Null when neither age nor max heart rate is known. */
  hrZones?: HrZoneRange[] | null;
  settings?: TrainingSettings;
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
  /** Cardio blocks done in the session, in order. */
  cardio: CardioLog[];
  /** Sum of the cardio blocks, minutes. */
  cardioMinutes: number;
};

/** What the phone posts when a session ends. `id` is client-made, so retries upsert. */
export type SessionInput = Omit<TrainingSession, "programId" | "dayId" | "notes" | "cardio" | "cardioMinutes"> & {
  programId?: string | null;
  dayId?: string | null;
  notes?: string | null;
  cardio?: CardioLog[];
};

// ── The session in progress ──────────────────────────────────────────────────

export type LiveSet = {
  id: string;
  weightKg: number;
  reps: number;
  rpe: number | null;
  /** Epoch ms; null until checked off. */
  doneAt: number | null;
};

/** One exercise of the session in progress: the program's prescription, as changed for today. */
export type LiveExercise = {
  /** The `ProgramExercise.id` it came from, or a fresh id for one added today. */
  id: string;
  exerciseId: string;
  name: string;
  equipment: Equipment;
  kind: ExerciseKind;
  modality?: CardioModality | null;
  repMin: number;
  repMax: number;
  targetRpe: number | null;
  targetRir: number | null;
  restSeconds: number;
  notes: string | null;
  /** The double-progression reason, shown under the name. */
  hint: string | null;
  /** Empty for cardio. */
  sets: LiveSet[];
  cardio: CardioTarget | null;
  /** Filled when a cardio block ends. */
  cardioLog: CardioLog | null;
  /** Passed over today; stays in the list, greyed. */
  skipped: boolean;
};

/**
 * The session in progress, kept on the engine so the Coach can change it.
 * `GET /api/mobile/training/live` → `{ session: LiveSession | null }`.
 * `PUT` `{ session, baseVersion }` stores the phone's copy; 409 `{ code: "conflict", session }`
 * when the engine's copy moved past `baseVersion` (the Coach changed it): adopt it.
 * `DELETE` forgets it (finish or discard). Saving the finished session also forgets it.
 * `POST /api/mobile/training/live/coach` → `{ threadId }`: the Coach thread bound to this
 * session (created on first use); send turns through the usual `/api/mobile/agent/threads/:id/turn`.
 */
export type LiveSession = {
  id: string;
  programId: string | null;
  dayId: string | null;
  name: string;
  startedAt: number;
  exercises: LiveExercise[];
  /** Index of the exercise on screen. */
  focus: number;
  restStartedAt: number | null;
  restEndsAt: number | null;
  /** Bumped on every write, phone or Coach. */
  version: number;
  updatedAt: number;
  threadId: string | null;
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
