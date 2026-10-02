/**
 * Sustancias: a private, non-judgmental log of when the person uses cannabis
 * (and optionally alcohol or nicotine), to see how often. Dates are local
 * "YYYY-MM-DD" and times "HH:MM", as the phone sends them.
 *
 * Privacy: hidden from external MCP clients unless granted the sensitive
 * scope, never in the Coach's briefs, and on the web shown only where the
 * person turned it on (on by default on the Mac).
 */

export type Substance = "cannabis" | "alcohol" | "nicotina";
/** How cannabis was taken; null for the other substances. */
export type SubstanceForm = "fumado" | "vapeado" | "comestible" | "otro";
export type SubstanceAmount = "poco" | "normal" | "mucho";
export type SubstanceContext = "social" | "solo" | "dormir" | "estres" | "otro";

export type SubstanceEntry = {
  id: string;
  substance: Substance;
  date: string;
  time: string;
  form: SubstanceForm | null;
  amount: SubstanceAmount;
  /** Sesiones or caladas, when the person counts them. */
  count: number | null;
  /** mg of THC, mostly for edibles. */
  thcMg: number | null;
  context: SubstanceContext | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
};

/** POST body. Missing date/time = now on the engine's clock; amount defaults to normal, cannabis form to fumado. */
export type SubstanceEntryInput = {
  substance?: Substance;
  date?: string;
  time?: string;
  form?: SubstanceForm | null;
  amount?: SubstanceAmount;
  count?: number | null;
  thcMg?: number | null;
  context?: SubstanceContext | null;
  note?: string | null;
};
export type SubstanceEntryPatch = Partial<Omit<SubstanceEntryInput, "substance">> & { substance?: Substance };

export type SubstanceSettings = {
  /** The person's own limit, e.g. 2 = "máximo 2 días por semana". Null = no goal. */
  maxDaysPerWeek: number | null;
};
export type SubstanceSettingsPatch = Partial<SubstanceSettings>;

/** One day of the 8-week heatmap. `level` is the largest amount that day, 0 = none. */
export type SubstanceDay = { date: string; uses: number; level: 0 | 1 | 2 | 3 };

/** One ISO week (Monday start). */
export type SubstanceWeek = { weekStart: string; days: number };

export type SubstanceTimeBucket = { key: "manana" | "tarde" | "noche" | "madrugada"; label: string; uses: number };

/** A soft comparison between nights (or next days) with and without use. Neutral wording, always with sample sizes. */
export type SubstanceCorrelation = {
  key: "sleep_minutes" | "sleep_score" | "hrv" | "resting_hr" | "readiness" | "late_eating";
  label: string;
  unit: string;
  withUse: number | null;
  withoutUse: number | null;
  /** withUse − withoutUse; null when either side is missing. */
  diff: number | null;
  nWith: number;
  nWithout: number;
  /** At least MIN_SAMPLE on each side. */
  enough: boolean;
  /** Spanish one-liner when `enough`, e.g. "En noches con consumo dormiste 22 min menos en promedio (6 con · 20 sin)". */
  text: string | null;
};

export type SubstanceSummary = {
  substance: Substance;
  /** The day the summary is computed for. */
  today: string;
  /** From the Monday 7 weeks ago through today (50–56 days), oldest first: a weeks × weekdays grid. */
  days: SubstanceDay[];
  /** Last 8 ISO weeks, oldest first; the last one is this week so far. */
  weeks: SubstanceWeek[];
  /** Mean days with use per full week, over the full weeks before this one since the first logged use; null before a full week. */
  avgDaysPerWeek: number | null;
  daysThisWeek: number;
  /** Days in a row without use, ending today (today counts when there was none). Null when nothing was ever logged. */
  daysWithout: number | null;
  /** Longest run of days without use inside `days` (counted from the first logged use). */
  longestWithout: number;
  lastUse: { date: string; time: string } | null;
  timeOfDay: SubstanceTimeBucket[];
  byForm: { form: SubstanceForm; uses: number }[];
  byContext: { context: SubstanceContext; uses: number }[];
  goal: { maxDaysPerWeek: number; daysThisWeek: number; within: boolean } | null;
  correlations: SubstanceCorrelation[];
  /** Alcohol only: days in the window with alcoholic drinks logged as meals in Dieta (alcohol_g > 0). */
  drinkDays?: number;
};

/** GET /api/mobile/substances and the web page: the summary, the last 60 days of entries (newest first) and settings. */
export type SubstanceOverview = {
  summary: SubstanceSummary;
  entries: SubstanceEntry[];
  settings: SubstanceSettings;
};
