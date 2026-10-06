/** Training: exercise library, programs the Coach writes, logged strength sessions. Weights are kg, times epoch ms. */

import type { JoinCandidate, SessionRecording } from "./workouts";

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
  /** Read only: the Health workout whose minutes, distance, kcal or heart rate filled what this log left empty. */
  recordedBy?: string | null;
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
  /**
   * A load the person set by hand, kg. It is the suggestion until the exercise is
   * next logged; then double progression takes over again. Null = suggest as usual.
   */
  weightKg?: number | null;
  /**
   * Exercises of a day sharing a non-null `supersetId` form one superset, done
   * alternating (A, B, rest, A, B, rest…). Members are always consecutive and at
   * least two; cardio is never in one. Null = a plain exercise.
   */
  supersetId: string | null;
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
  /** Load set by hand for the next time, kg. */
  weightKg?: number | null;
  /**
   * Any short label (≤ 32 chars, e.g. "a") shared by the consecutive exercises of
   * one superset. On save, a member left alone or apart from its group, and any
   * cardio block, gets null; of a label used by non-adjacent runs only the first
   * run of two or more keeps it.
   */
  supersetId?: string | null;
};
export type ProgramDayInput = { name: string; focus?: string | null; weekday?: number | null; exercises: ProgramExerciseInput[] };
export type ProgramInput = {
  name: string;
  goal: string;
  weeks: number;
  notes?: string | null;
  days: ProgramDayInput[];
  /** Why the previous block ends ("Cambio a CrossFit"), when this one replaces it. */
  reason?: string | null;
};

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

/**
 * How a weight is shown and typed. Storage is always kg; a pound entry is kept
 * as its exact kg (45 lb → 20.41165665 kg), so it reads 45 lb again.
 */
export type WeightUnit = "kg" | "lb";

/**
 * `GET`/`PUT /api/mobile/training/settings`. `PUT` takes any of
 * `preferredEquipment` and `defaultUnit` and leaves the rest alone.
 * One exercise's unit: `PUT /api/mobile/training/exercises/:id/unit` `{ unit }`
 * (null = follow `defaultUnit`) → `TrainingSettings`.
 */
export type TrainingSettings = {
  /** Most preferred first, e.g. ["machine", "cable"]. Alternatives and programs favour these. Empty = no preference. */
  preferredEquipment: Equipment[];
  /** Unit for exercises without their own, and for totals such as a session's volume. */
  defaultUnit: WeightUnit;
  /** Exercises (library id) whose machine or plates use their own unit. Missing = `defaultUnit`. */
  exerciseUnits: Record<string, WeightUnit>;
};

/**
 * Next-load suggestion from double progression. `weightKg` is null without
 * history; otherwise it sits on the exercise's unit steps (a 5 lb step for a
 * pound machine), and `reason` speaks in that unit.
 */
export type LoadSuggestion = {
  exerciseId: string;
  weightKg: number | null;
  reps: number;
  reason: string;
  lastSessionAt: number | null;
  /** Set on the suggestions of an adjusted session: what progression alone said. */
  normal?: { weightKg: number | null; reps: number } | null;
};

// ── Reviewing the next session ───────────────────────────────────────────────

/**
 * Something the engine noticed before the next workout. The engine only
 * detects; the Coach reviews the session and decides (`SessionAdjustment`).
 * "inactivity": a break longer than the person's usual rhythm (`level`
 * moderate / long / very_long, or returning = still easing back after a very
 * long one). "exercise_gap": one exercise of the day not trained for a while.
 * "readiness": low readiness or bad sleep. "health_event": an injury or
 * illness active or just over. "block_switch": the first session of a new
 * block. "missed_sessions": days missed last week.
 */
export type AdjustmentSignalKind = "inactivity" | "exercise_gap" | "readiness" | "health_event" | "block_switch" | "missed_sessions";

export type AdjustmentSignal = {
  kind: AdjustmentSignalKind;
  /** moderate | long | very_long | returning for breaks; low for readiness; the event's status for health. */
  level: string | null;
  /** Days off, or days since the exercise was trained. */
  days: number | null;
  /** The program exercise, for exercise_gap. */
  programExerciseId?: string | null;
  /** One Spanish line: "Llevas 9 días sin entrenar (sueles descansar 2)". */
  detail: string;
};

/**
 * One change to the upcoming session; the program stays as it is.
 * "adjust": `loadPercent` (−40…0, against what progression suggests), `sets`
 * (at most 2 fewer, never more) and/or `reps` (within the range).
 * "swap": `toExerciseId` instead, same kind. "skip": leave it out today.
 * "add": a cardio warm-up `toExerciseId` with its `cardio` target, done first.
 */
export type ExerciseChange = {
  action: "adjust" | "swap" | "skip" | "add";
  /** The exercise changed; null for "add". */
  programExerciseId: string | null;
  loadPercent?: number | null;
  sets?: number | null;
  reps?: number | null;
  toExerciseId?: string | null;
  cardio?: CardioTarget | null;
};

/**
 * The Coach's decision about the next workout, made before the person opens
 * the app. "reviewing": the Coach is on it. "ready": decided — by the Coach,
 * or by the fixed fallback table when the Coach could not run (`decidedBy`).
 */
export type SessionAdjustment = {
  id: string;
  programId: string;
  dayId: string;
  status: "reviewing" | "ready";
  decidedBy: "coach" | "fallback" | null;
  /** The Coach looked and kept the plan. */
  noChange: boolean;
  /** One calm Spanish sentence for the next-workout card. */
  rationale: string | null;
  signals: AdjustmentSignal[];
  changes: ExerciseChange[];
  /** "Entrenar normal": the person set it aside for this session. */
  dismissed: boolean;
  /** The Coach thread opened from "Ver por qué", once there is one. */
  threadId: string | null;
  createdAt: number;
  updatedAt: number;
};

/** The adjustment on the next day, with that day and its suggestions as they will be done. */
export type NextAdjustment = SessionAdjustment & { day: ProgramDay; suggestions: Record<string, LoadSuggestion> };

// ── Blocks and weeks ─────────────────────────────────────────────────────────

/**
 * A program day in one week. "done": a session of that day falls in the week;
 * "partial": it did, but with under ¾ of the day's sets; "missed": the week is
 * over without one; "planned": still ahead.
 */
export type WeekDayStatus = "done" | "partial" | "missed" | "planned";

/** A logged session as a week shows it. */
export type WeekSession = {
  id: string;
  dayId: string | null;
  name: string;
  startedAt: number;
  endedAt: number;
  sets: number;
  cardioMinutes: number;
};

export type WeekDay = { dayId: string; name: string; status: WeekDayStatus; sessions: WeekSession[] };

/**
 * One week of a block. Weeks are calendar weeks (Monday to Sunday, the Mac's
 * clock); week 1 is the week of the block's first session (the current week
 * until there is one). A week started early begins at that moment and runs to
 * the end of the following calendar week. `endsAt` is exclusive.
 */
export type ProgramWeek = {
  number: number;
  startsAt: number;
  endsAt: number;
  state: "past" | "current" | "future";
  startedEarly: boolean;
  deload: boolean;
  /** The program notes' sentence about this week (a deload), when there is one. */
  note: string | null;
  days: WeekDay[];
  /** Days done (or partial) this week. */
  done: number;
  /** Sessions in the week that are none of this block's days: another block's, or free ones. They still count. */
  other: WeekSession[];
};

/**
 * A program as a stretch of training. Creating or switching a program ends the
 * current block (`endedAt`, `endReason`) and starts the next; nothing is
 * deleted, and history, records and suggestions are per exercise, so they
 * carry across blocks.
 */
export type TrainingBlock = {
  programId: string;
  /** 1-based, oldest first. */
  number: number;
  name: string;
  goal: string;
  startedAt: number;
  endedAt: number | null;
  endReason: string | null;
  active: boolean;
  /** The block it resumes ("Retomar"), when it is a copy of an earlier one. */
  resumedFrom: string | null;
  /** The program's days as written (no "solo hoy" changes): previews of other weeks. */
  days: ProgramDay[];
  /** The week now (active), or the last one reached (ended). */
  currentWeek: number;
  /** Every day of the current week is done. */
  weekComplete: boolean;
  /** `POST /api/mobile/training/program/weeks/next` may start the next week now. */
  canStartNextWeek: boolean;
  /** Past its last week. */
  finished: boolean;
  weeks: ProgramWeek[];
};

/**
 * `GET /api/mobile/training/program`. `suggestions` is keyed by `ProgramExercise.id`.
 * Days carry today's "solo hoy" changes when there are any (`overridden`).
 * `nextDayId` is the next day not done this week; null when there is no
 * program or the week is complete (`blocks.at(-1).weekComplete`).
 * `POST …/program/weeks/next` starts the next week early; `POST …/program/blocks/:id/resume`
 * starts a new block from an earlier one. Both return this.
 */
export type ActiveProgramResponse = {
  program: Program | null;
  nextDayId: string | null;
  suggestions: Record<string, LoadSuggestion>;
  /** Null when neither age nor max heart rate is known. */
  hrZones?: HrZoneRange[] | null;
  settings?: TrainingSettings;
  /** Every block, oldest first; the active one (if any) last. */
  blocks?: TrainingBlock[];
  /**
   * The Coach's review of the next day, when something was noticed. Starting
   * that day uses `adjustment.day` and `adjustment.suggestions` unless it is
   * still reviewing, says no change, or was set aside ("Entrenar normal":
   * `PUT …/program/adjustment/:id` `{ dismissed }`). `POST …/adjustment/:id/thread`
   * → `{ threadId }` opens it in a Coach thread ("Ver por qué").
   */
  adjustment?: NextAdjustment | null;
};

/** One stretch of a set at one load. */
export type SetSegment = { weightKg: number; reps: number };

/**
 * A set where the load dropped mid-set ("80 kg × 5 → 60 kg × 3") has several
 * segments, in the order done. `weightKg`/`reps` are always the first (top)
 * segment and win over `segments[0]`: clients that only know them keep working,
 * and the engine rewrites `segments[0]` from them. The engine always returns
 * `segments` (one for a plain set); clients may omit it (= one segment).
 * Volume and total reps sum every segment; records, e1RM, progression and the
 * review signals read the top segment only.
 */
export type SetSegments = { segments?: SetSegment[] };

export type SetLog = {
  exerciseId: string;
  /** 0-based order within the exercise in this session. */
  setIndex: number;
  /** The top segment's load. */
  weightKg: number;
  /** The top segment's reps. */
  reps: number;
  rpe: number | null;
  doneAt: number;
} & SetSegments;

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
  /**
   * Read only. True when Health workouts recorded during the session (the
   * Watch's strength workout, its treadmill walk) were merged into it: they are
   * this session, not more training.
   */
  merged?: boolean;
  /** Read only: what those workouts recorded (kcal, heart rate, distance). */
  recorded?: SessionRecording | null;
  /** Read only, one session's detail: Health workouts nearby it could be joined with. */
  joinable?: JoinCandidate[];
};

/** What the phone posts when a session ends. `id` is client-made, so retries upsert. */
export type SessionInput = Omit<TrainingSession, "programId" | "dayId" | "notes" | "cardio" | "cardioMinutes" | "merged" | "recorded" | "joinable"> & {
  programId?: string | null;
  dayId?: string | null;
  notes?: string | null;
  cardio?: CardioLog[];
};

// ── The session in progress ──────────────────────────────────────────────────

/** `weightKg`/`reps` are the top segment; see `SetSegments`. */
export type LiveSet = {
  id: string;
  weightKg: number;
  reps: number;
  /**
   * True once the person (or the Coach) set the reps. An open set without it
   * shows the target range and logs `repMax` when checked off as it stands.
   */
  repsChosen?: boolean;
  rpe: number | null;
  /** Epoch ms; null until checked off. */
  doneAt: number | null;
} & SetSegments;

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
  /**
   * Cardio ended early on the Coach's `finish_cardio`: done, not skipped. The
   * engine fills `cardioLog` from the synced clock when it has one; otherwise
   * the phone writes it from its own clock, timed up to `at`.
   */
  cutShort?: { at: number; reason: string | null } | null;
  /**
   * Same rule as `ProgramExercise.supersetId`: copied from the program exercise
   * when the session starts, kept by a swap, normalized on every write (phone or
   * Coach). Skipping an exercise takes it out of its superset. Old copies without
   * it read as null.
   */
  supersetId: string | null;
};

/** A cardio block's stopwatch. Elapsed = `accumulatedSeconds` + (now − `runningSince`) while running. */
export type LiveCardioClock = {
  /** The `LiveExercise.id` it times. */
  exerciseId: string;
  /** Epoch ms; null while paused. */
  runningSince: number | null;
  accumulatedSeconds: number;
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
  /** The stopwatch of the cardio block being done, as the phone last synced it; null when none. */
  cardioClock?: LiveCardioClock | null;
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
  /** Every segment's reps. */
  totalReps: number;
  /** Every segment's kg × reps. */
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
