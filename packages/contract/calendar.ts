/**
 * Calendar: when the person is busy, when the Coach plans training and meals,
 * health events (injuries, illnesses), and one timeline that merges them with
 * everything else Pulso records. Dates are local "YYYY-MM-DD", times local
 * "HH:MM", datetimes local "YYYY-MM-DDTHH:MM" (the person's own clock, no zone).
 */
import type { MealSlot } from "./nutrition";
import type { Muscle } from "./training";

// ── Availability ─────────────────────────────────────────────────────────────

export type BusySource = "manual" | "coach" | "apple_calendar";

/**
 * A stretch when the person can't train. One-off: `date` (to `endDate` for a
 * multi-day trip). Weekly: `weekdays` (ISO, 1 = lunes … 7 = domingo) from
 * `date` until `until`. Timed blocks have `start`/`end`; all-day blocks don't.
 */
export type BusyBlock = {
  id: string;
  title: string;
  allDay: boolean;
  date: string;
  endDate: string | null;
  start: string | null;
  end: string | null;
  weekdays: number[];
  until: string | null;
  source: BusySource;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
};

export type BusyBlockInput = {
  title: string;
  allDay?: boolean;
  date: string;
  endDate?: string | null;
  start?: string | null;
  end?: string | null;
  weekdays?: number[];
  until?: string | null;
  source?: BusySource;
  notes?: string | null;
};

export type BusyBlockPatch = Partial<BusyBlockInput>;

/** Busy times read from Apple Calendar on the phone (title + free/busy only). Replaces that source's blocks in [from, to]. */
export type AppleCalendarSync = {
  from: string;
  to: string;
  events: { externalId: string; title: string; allDay: boolean; date: string; endDate?: string | null; start?: string | null; end?: string | null }[];
};

export type MealTime = { slot: MealSlot; time: string };

export type CalendarPreferences = {
  /** Preferred session start times, best first. Empty: anywhere between wake and sleep. */
  trainingTimes: string[];
  sessionMinutes: number;
  /** ISO weekdays never to train on. */
  restDays: number[];
  wakeTime: string;
  sleepTime: string;
  /** Default meal times; `set_meal_times` can override single dates. */
  mealTimes: MealTime[];
};

// ── Planned schedule ─────────────────────────────────────────────────────────

/** `missed`: a past planned session with nothing logged that day. Computed, never stored. */
export type PlannedStatus = "planned" | "done" | "skipped" | "moved" | "missed";

export type PlannedSession = {
  id: string;
  programId: string | null;
  dayId: string | null;
  name: string;
  date: string;
  time: string;
  durationMin: number;
  status: PlannedStatus;
  /** Why it is here (Coach's words, or the auto re-plan's). */
  reason: string | null;
  /** Set when a busy block or health event now clashes with it and nothing could move it. */
  conflict: string | null;
  /** Earlier date when it was moved. */
  movedFrom: string | null;
  /** The logged training session that fulfilled it. */
  sessionId: string | null;
};

export type PlannedSessionPatch = { date?: string; time?: string; durationMin?: number; status?: "planned" | "skipped"; reason?: string | null };

/** What happened to planned sessions after availability or health changed. */
export type Replan = {
  moved: { id: string; name: string; from: string; to: string; time: string }[];
  /** Still clashing: no free day nearby. The Coach should decide. */
  unresolved: { id: string; name: string; date: string; conflict: string }[];
};

export type PlanWeekResult = {
  from: string;
  to: string;
  sessions: PlannedSession[];
  /** Program days not placed, and why. */
  unplaced: { dayId: string; name: string; reason: string }[];
  /** Placed, but touch an active injury: which exercises and why. */
  warnings: { dayId: string; name: string; message: string }[];
};

// ── Health events ────────────────────────────────────────────────────────────

export type HealthEventKind = "lesion" | "enfermedad" | "sintoma" | "cirugia" | "otro";
export type HealthEventStatus = "activa" | "recuperandose" | "resuelta";
export type Joint = "knee" | "shoulder" | "ankle" | "wrist" | "elbow" | "hip";
/** A muscle from the body map, a joint, or the whole body (a cold, a fever). */
export type BodyArea = Muscle | Joint | "general";

export type HealthEvent = {
  id: string;
  kind: HealthEventKind;
  title: string;
  bodyArea: BodyArea | null;
  /** 1 (mild) … 5 (severe). */
  severity: number;
  startDate: string;
  /** Null while ongoing. */
  endDate: string | null;
  status: HealthEventStatus;
  notes: string | null;
  /** How it limits training, in the person's words: "evitar sentadilla". */
  affectedTraining: string | null;
  createdAt: number;
  updatedAt: number;
};

export type HealthEventInput = {
  kind: HealthEventKind;
  title: string;
  bodyArea?: BodyArea | null;
  severity?: number;
  startDate: string;
  endDate?: string | null;
  status?: HealthEventStatus;
  notes?: string | null;
  affectedTraining?: string | null;
};

export type HealthEventPatch = Partial<HealthEventInput>;

// ── Timeline ─────────────────────────────────────────────────────────────────

export type CalendarItemKind = "training" | "workout" | "meal" | "meal_time" | "dose" | "sleep" | "busy" | "health" | "body_scan";

/** Where tapping the item goes: an app tab ("hoy", "entreno", "dieta", "cuerpo") or the calendar itself. */
export type CalendarLink = { tab: "hoy" | "entreno" | "dieta" | "cuerpo" | "calendario"; id: string | null };

export type CalendarItem = {
  /** Unique within a response. */
  id: string;
  kind: CalendarItemKind;
  title: string;
  subtitle: string | null;
  /** The day it is listed under. */
  date: string;
  /** Local datetimes; null for all-day items. `end` may fall on the next day (sleep). */
  start: string | null;
  end: string | null;
  allDay: boolean;
  /** Colour key for the client: training, workout, nutrition, medication, sleep, busy, health, body. */
  color: "training" | "workout" | "nutrition" | "medication" | "sleep" | "busy" | "health" | "body";
  /** Kind-specific state: PlannedStatus, DoseStatus, HealthEventStatus, BusySource. */
  status: string | null;
  link: CalendarLink;
};

/** `GET /api/mobile/calendar?from&to`. */
export type CalendarRange = { from: string; to: string; items: CalendarItem[] };
