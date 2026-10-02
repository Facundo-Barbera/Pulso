/**
 * Sustancias: a private, non-judgmental log of when the person uses something
 * (Cannabis and Alcohol come built in; they can add their own), to see how
 * often. Dates are local "YYYY-MM-DD" and times "HH:MM", as the phone sends them.
 *
 * Privacy: hidden from external MCP clients unless granted the sensitive
 * scope, never in the Coach's briefs, and on the web shown only where the
 * person turned it on (on by default on the Mac).
 */

/** Ids of the substances Pulso seeds. Custom ones get a random id. */
export const BUILTIN_SUBSTANCES = ["cannabis", "alcohol"] as const;

/** A substance the person tracks. Archived ones are hidden from pickers but keep their history. */
export type Substance = {
  id: string;
  name: string;
  /** An emoji or an SF Symbol name; null = the default symbol. */
  symbol: string | null;
  /** What `quantity` counts: sesiones, mg, ml, unidades, tragos… */
  unit: string;
  /** How it can be taken, in order (e.g. fumado, vapeado, comestible); empty = no form. */
  forms: string[];
  /** The person's own limit, e.g. 2 = "máximo 2 días por semana". Null = no goal. */
  maxDaysPerWeek: number | null;
  archived: boolean;
  /** Order in pickers, 0 first. */
  position: number;
  /** Seeded by Pulso (Cannabis, Alcohol). It can be edited or archived like any other. */
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
};

/** POST body for a new substance. Unit defaults to "veces". */
export type SubstanceInput = { name: string; symbol?: string | null; unit?: string; forms?: string[]; maxDaysPerWeek?: number | null };
/** PATCH body: any field; `archived: true` hides it, false brings it back. */
export type SubstancePatch = Partial<Omit<SubstanceInput, "name">> & { name?: string; archived?: boolean };
/** PUT body: every active substance id in the new order. */
export type SubstanceOrder = { ids: string[] };

export type SubstanceAmount = "poco" | "normal" | "mucho";
export type SubstanceContext = "social" | "solo" | "dormir" | "estres" | "otro";

export type SubstanceEntry = {
  id: string;
  substanceId: string;
  date: string;
  time: string;
  /** One of the substance's forms, or null. */
  form: string | null;
  amount: SubstanceAmount;
  /** How much, in the substance's unit, when the person counts it. */
  quantity: number | null;
  /** mg of THC, for cannabis edibles. */
  thcMg: number | null;
  context: SubstanceContext | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
};

/**
 * POST body. `substanceId` defaults to the first active substance; date/time
 * default to now on the engine's clock; amount to normal; form to the
 * substance's first one.
 */
export type SubstanceEntryInput = {
  substanceId?: string;
  date?: string;
  time?: string;
  form?: string | null;
  amount?: SubstanceAmount;
  quantity?: number | null;
  thcMg?: number | null;
  context?: SubstanceContext | null;
  note?: string | null;
};
export type SubstanceEntryPatch = Partial<SubstanceEntryInput>;

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
  /** The substance summarized; null = Todas (every active substance together). */
  substanceId: string | null;
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
  byForm: { form: string; uses: number }[];
  byContext: { context: SubstanceContext; uses: number }[];
  /** Todas: uses per substance in the window. Empty for a single substance. */
  bySubstance: { substanceId: string; uses: number }[];
  /** The substance's own goal; null for Todas or when it has none. */
  goal: { maxDaysPerWeek: number; daysThisWeek: number; within: boolean } | null;
  correlations: SubstanceCorrelation[];
  /** Alcohol only: days in the window with alcoholic drinks logged as meals in Dieta (alcohol_g > 0). */
  drinkDays?: number;
};

/**
 * GET /api/mobile/substances?substance=<id|all> and the web page: every
 * substance (archived last), the summary for the one asked (default the first
 * active; `all` = Todas) and its last 60 days of entries, newest first.
 */
export type SubstanceOverview = {
  substances: Substance[];
  summary: SubstanceSummary;
  entries: SubstanceEntry[];
};
