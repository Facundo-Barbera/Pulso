/** Local calendar date, `YYYY-MM-DD`. */
export type DateString = string;

/**
 * One day of Apple Health signals. Every metric is nullable: a day can lack
 * any of them (no watch worn, no sleep tracked). Sleep belongs to the morning
 * it ends on, so `date`'s sleep is "last night".
 */
export type DailyMetrics = {
  date: DateString;
  steps: number | null;
  /** kcal */
  activeEnergy: number | null;
  /** minutes */
  exerciseMinutes: number | null;
  /** bpm */
  restingHeartRate: number | null;
  /** HRV, SDNN in ms */
  hrv: number | null;
  /** minutes asleep, all stages */
  sleepMinutes: number | null;
  /** minutes per stage, when the watch tracked them */
  sleepDeep: number | null;
  sleepCore: number | null;
  sleepRem: number | null;
  sleepAwake: number | null;
  /** mL/kg/min */
  vo2max: number | null;
  /** breaths/min */
  respiratoryRate: number | null;
  /** epoch ms of the last write */
  updatedAt: number;
};

/** What the phone sends. Missing or null fields keep what the engine already had. */
export type DailyMetricsInput = Omit<DailyMetrics, "updatedAt">;

export type ReadinessFactorKey = "hrv" | "resting_hr" | "sleep";

export type ReadinessFactor = {
  key: ReadinessFactorKey;
  /** Spanish label for the UI */
  label: string;
  /** today's value: ms, bpm or minutes */
  value: number | null;
  /** 28-day mean (ms, bpm) or the sleep target in minutes */
  baseline: number | null;
  /** 0–100, null when there is not enough data */
  score: number | null;
  /** Spanish, e.g. "12% por encima de tu media" */
  detail: string;
};

export type Readiness = {
  date: DateString;
  /** 0–100, null when no factor has data */
  score: number | null;
  level: "high" | "medium" | "low" | "unknown";
  factors: ReadinessFactor[];
  /** One Spanish line for the person */
  explanation: string;
  /** days with HRV or resting HR in the 28-day baseline window */
  baselineDays: number;
};

export type DailyResponse = { days: DailyMetrics[]; readiness: Readiness };
