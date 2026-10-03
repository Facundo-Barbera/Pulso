/** HealthKit sleep stages. `asleep` is "asleep, unspecified" (sources without stages). */
export type SleepStage = "inBed" | "awake" | "core" | "deep" | "rem" | "asleep";

/**
 * Which kind of device wrote a sample. The engine prefers `watch` when sources overlap.
 * `manual` is a night the person logged by hand; the phone never sends it.
 */
export type SleepSourceKind = "watch" | "phone" | "other" | "manual";

/** One HealthKit sleep sample as the phone sends it. Times are epoch ms. */
export type SleepSegmentInput = {
  start: number;
  end: number;
  stage: SleepStage;
  /** Source name (e.g. "Apple Watch de Facundo"). */
  source: string;
  sourceKind: SleepSourceKind;
  /** Local UTC offset in minutes at `start` (e.g. -180 for UTC−3). */
  tzOffsetMin: number;
};

export type SleepSegment = { start: number; end: number; stage: SleepStage };

export type SleepScoreFactor = {
  key: "duration" | "efficiency" | "restoration" | "consistency";
  /** Spanish label for the UI. */
  label: string;
  points: number;
  maxPoints: number;
  /** Spanish one-liner, e.g. "7 h 20 min de 8 h". */
  detail: string;
};

export type SleepScore = {
  /** 0–100. */
  value: number;
  factors: SleepScoreFactor[];
  /** Spanish one-line explanation of the score. */
  explanation: string;
};

/** One night, from the preferred source. Minutes are whole minutes; times epoch ms. */
export type SleepNight = {
  /** Local date of waking up, YYYY-MM-DD. */
  night: string;
  source: string;
  sourceKind: SleepSourceKind;
  tzOffsetMin: number;
  inBedStart: number;
  inBedEnd: number;
  asleepStart: number;
  asleepEnd: number;
  minutes: { inBed: number; asleep: number; awake: number; core: number; deep: number; rem: number; unspecified: number };
  /** asleep / in bed, 0–1. */
  efficiency: number;
  /** Share of asleep time per stage, 0–1. Null when the source has no stages. */
  stagePct: { core: number; deep: number; rem: number } | null;
  /** Minutes from local midnight of `night`; negative = the evening before (23:00 → -60). */
  bedtimeMin: number;
  wakeMin: number;
  score: SleepScore;
  /** Spanish insights comparing this night with the 14 before it. */
  insights: string[];
  segments: SleepSegment[];
  /** Set when the night was logged by hand (`sourceKind` "manual"): one asleep span, no stages, efficiency not measured. */
  manual?: { id: string; note: string | null };
};

/**
 * A night the person logged by hand because Health has none for it (the watch
 * was off). It belongs to the night it starts in, like HealthKit's, named after
 * the morning of waking. A measured night for the same date always wins: the
 * manual one is then kept but hidden.
 */
export type ManualSleepNight = {
  id: string;
  /** Local date of waking up, YYYY-MM-DD. */
  night: string;
  /** Fell asleep, epoch ms. */
  start: number;
  /** Woke up, epoch ms. */
  end: number;
  tzOffsetMin: number;
  note: string | null;
  /** True while a measured night for the same date exists, so this one is not shown. */
  hidden: boolean;
  createdAt: number;
  updatedAt: number;
};

/** POST /api/mobile/sleep/manual and /api/web/sueno/noches. `tzOffsetMin` defaults to the Mac's. */
export type ManualSleepInput = { start: number; end: number; tzOffsetMin?: number; note?: string | null };

/** PATCH …/manual/:id: any of the fields; a null note clears it. */
export type ManualSleepPatch = Partial<ManualSleepInput>;

export type SleepSummary = {
  /** Nights included (most recent `days` with data). */
  nights: number;
  from: string | null;
  to: string | null;
  targetMin: number;
  avgAsleepMin: number | null;
  avgScore: number | null;
  avgEfficiency: number | null;
  /** Same axis as `SleepNight.bedtimeMin` / `wakeMin`. */
  avgBedtimeMin: number | null;
  avgWakeMin: number | null;
  bedtimeSdMin: number | null;
  wakeSdMin: number | null;
  /** Sleep Regularity Index-like, 0–100 (same sleep/wake state 24 h apart). Null with < 2 consecutive nights. */
  regularity: number | null;
  /** max(0, Σ(target − asleep)) over the window, minutes. */
  debtMin: number;
  insights: string[];
};

/** GET /api/mobile/sleep: nights newest first, plus the 14-night summary. */
export type SleepOverview = { targetMin: number; nights: SleepNight[]; summary: SleepSummary };
