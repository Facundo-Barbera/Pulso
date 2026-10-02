/** Medication and supplements: what the person takes, when, and whether they took it. */

export type MedicationKind = "medicamento" | "suplemento";
export type DoseStatus = "tomada" | "omitida" | "pospuesta";

/** Meals a dose can be tied to (their times come from the calendar's meal times). */
export type DoseMeal = "desayuno" | "comida" | "cena";

/**
 * A dose tied to training. On a training day it is due when the workout ends
 * and should be taken within `withinMinutes`; on a day without training it is
 * due at `restDayTime`, or not at all when that is null ("No tomar").
 */
export type TrainingRule = {
  withinMinutes: number;
  restDayTime: string | null;
};

/** Parts of the day a dose can be due in: "En la mañana", "En la tarde", "En la noche". */
export type DayPart = "manana" | "tarde" | "noche";

/** A day-part window: due any time between `start` and `end` ("HH:MM", start < end). */
export type DoseWindow = { part: DayPart; start: string; end: string };

/** Default ranges of each day part, editable per schedule. */
export const DAY_PART_RANGES: Record<DayPart, { start: string; end: string }> = {
  manana: { start: "07:00", end: "12:00" },
  tarde: { start: "12:00", end: "19:00" },
  noche: { start: "19:00", end: "23:00" },
};

/** The gentle evening reminder an any-time dose gets unless the person picks another hour or none. */
export const DEFAULT_ANY_TIME_REMINDER = "19:00";

/**
 * Every N days, or every N weeks on `days`, counted from `start` ("YYYY-MM-DD").
 * With weeks, the week of `start` is a due week.
 */
export type ScheduleInterval = { every: number; unit: "day" | "week"; start: string };

/**
 * When doses are due: a frequency (which days) plus a timing (when on those
 * days). Times are local "HH:MM". `asNeeded` meds have no slots and never count
 * against adherence.
 *
 * Frequency, one of:
 * - every day: `days` empty, no `interval`, no `monthDay`;
 * - some weekdays: `days` = ISO weekdays (1 = lunes … 7 = domingo);
 * - every N days, or every N weeks on `days`: `interval`;
 * - once a month: `monthDay` (past the month's end, its last day).
 *
 * Timing mixes any of: fixed clock `times`, day-part `windows`, `anyTime`
 * (one dose some time that day), or slots tied to a moment: after training,
 * with a meal, before bed.
 */
export type MedicationSchedule = {
  asNeeded: boolean;
  times: string[];
  days: number[];
  /** "Cada N días / semanas"; null otherwise. */
  interval: ScheduleInterval | null;
  /** "Cada mes, el día N" (1–31); null otherwise. */
  monthDay: number | null;
  /** "Después de entrenar"; null when not tied to training. */
  training: TrainingRule | null;
  /** "Con una comida". */
  meals: DoseMeal[];
  /** "Antes de dormir": 30 min before the calendar's sleep time. */
  bedtime: boolean;
  /** "En la mañana / tarde / noche": one dose due within each window. */
  windows: DoseWindow[];
  /** "Cualquier hora": one dose due all day, missed only once the day is over. */
  anyTime: boolean;
  /** For an any-time dose, the hour of a gentle reminder if it is still pending; null for none. */
  reminder: string | null;
};

/**
 * What callers send: everything beyond asNeeded/times/days is optional, so old
 * clients keep working. A missing `reminder` on an any-time schedule means the
 * default evening one; null turns it off. A missing `interval.start` is the
 * medication's start date.
 */
export type MedicationScheduleInput = Pick<MedicationSchedule, "asNeeded" | "times" | "days"> &
  Partial<Pick<MedicationSchedule, "training" | "meals" | "bedtime" | "monthDay" | "windows" | "anyTime" | "reminder">> & {
    interval?: (Omit<ScheduleInterval, "start"> & { start?: string }) | null;
  };

/** What a slot hangs on: a clock time, the end of a workout, a meal, bedtime, a part of the day or the whole day. */
export type DoseMoment = "hora" | "entreno" | DoseMeal | "dormir" | DayPart | "dia";

export type Medication = {
  id: string;
  name: string;
  kind: MedicationKind;
  /** Amount per intake, in `unit` (e.g. 500 mg, 2 comprimidos). */
  dose: number;
  unit: string;
  /** comprimido, cápsula, gotas, polvo… free text. */
  form: string | null;
  /** con comida, en ayunas… free text. */
  instructions: string | null;
  schedule: MedicationSchedule;
  /** Local dates "YYYY-MM-DD". */
  startDate: string;
  endDate: string | null;
  /** Doses left. One "tomada" uses one. Null when not tracked. */
  stock: number | null;
  lowStockThreshold: number | null;
  /** stock <= lowStockThreshold. */
  lowStock: boolean;
  active: boolean;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
};

export type MedicationInput = {
  name: string;
  kind?: MedicationKind;
  dose: number;
  unit: string;
  form?: string | null;
  instructions?: string | null;
  schedule?: MedicationScheduleInput;
  startDate?: string;
  endDate?: string | null;
  stock?: number | null;
  lowStockThreshold?: number | null;
  active?: boolean;
  notes?: string | null;
};

export type MedicationPatch = Partial<MedicationInput>;

export type DoseEvent = {
  id: string;
  medicationId: string;
  /** Local date of the slot, "YYYY-MM-DD". */
  date: string;
  /** The slot's key (`DoseSlot.slot`): "HH:MM" or a moment like "entreno" or "dia"; null for an as-needed intake. */
  scheduledTime: string | null;
  status: DoseStatus;
  /** Epoch ms, when status is "tomada". */
  takenAt: number | null;
  loggedAt: number;
};

export type DoseLogInput = {
  medicationId: string;
  date: string;
  /** The slot's key (`DoseSlot.slot`). Omit or null for as-needed. */
  scheduledTime?: string | null;
  status: DoseStatus;
  takenAt?: number | null;
};

/** One expected dose on one day, with what happened to it. */
export type DoseSlot = {
  medicationId: string;
  name: string;
  kind: MedicationKind;
  dose: number;
  unit: string;
  instructions: string | null;
  date: string;
  /**
   * The slot's key within the day, sent back as `scheduledTime` when logging:
   * "HH:MM" for a fixed time, else the moment ("entreno", "desayuno", "comida",
   * "cena", "dormir", "manana", "tarde", "noche", "dia"). A training slot keeps its key whether it ends up after a
   * workout or on the rest-day rule, so it is one dose a day either way.
   */
  slot: string;
  moment: DoseMoment;
  /**
   * When it is due, "HH:MM": a window's start; null for an any-time slot ("dia")
   * and while waiting for a workout that is planned or in progress.
   */
  time: string | null;
  training: TrainingSlot | null;
  /** A day-part slot's window; null otherwise. */
  window: DoseWindow | null;
  /**
   * When a reminder should fire if it is still pending, "HH:MM": the due time,
   * a window's start, an any-time slot's chosen hour, a training slot's
   * rest-day fallback while waiting; null for no reminder.
   */
  remindAt: string | null;
  status: DoseStatus | "pendiente";
  eventId: string | null;
  takenAt: number | null;
};

/**
 * How a training-linked slot resolved. `trained`: a workout ended that day (a
 * Pulso session or a Health workout), due at its end. `training`: one is in
 * progress. `planned`: a calendar session is still ahead. `rest`: no workout
 * and none ahead, so the rest-day rule applies.
 */
export type TrainingSlot = {
  state: "trained" | "training" | "planned" | "rest";
  /** "HH:MM" the workout ended (trained). */
  workoutEnd: string | null;
  /** "HH:MM" by which to take it: workout end + withinMinutes (trained). */
  until: string | null;
  /** "HH:MM" the planned session starts (planned). */
  plannedAt: string | null;
  /**
   * While waiting (training, planned): when the rest-day rule takes over if no
   * workout happens, so a reminder can already be set. Null with "No tomar".
   */
  fallback: string | null;
};

export type MedicationDay = {
  date: string;
  /** Sorted by time; any-time slots and slots still waiting for a workout go last. */
  slots: DoseSlot[];
  /** As-needed intakes logged that day. */
  asNeeded: DoseEvent[];
  /** First pending slot with a time at or after the given time (or a window still open), if any. */
  next: DoseSlot | null;
};

/** Slots of the coming days, resolved, for planning reminders. */
export type MedicationUpcoming = { from: string; slots: DoseSlot[] };

export type AdherenceWindow = {
  /** Slots already due in the window (any-time and day-part slots once their day is over, or when taken). */
  due: number;
  taken: number;
  /** taken / due, 0..1; null when nothing was due. */
  rate: number | null;
};

export type MedicationAdherence = {
  medicationId: string;
  name: string;
  last7: AdherenceWindow;
  last30: AdherenceWindow;
  /** Consecutive days with every due dose taken, ending today (a day still in progress does not break it). */
  currentStreak: number;
  bestStreak: number;
};

export type AdherenceDay = { date: string; due: number; taken: number };

export type AdherenceReport = {
  asOf: { date: string; time: string };
  overall: { last7: AdherenceWindow; last30: AdherenceWindow; currentStreak: number; bestStreak: number };
  medications: MedicationAdherence[];
  /** Last 30 days, oldest first, for a heatmap. */
  days: AdherenceDay[];
};

/**
 * A quiet suggestion to give an as-needed medication a schedule, because it is
 * logged like a regular one (or is a drug usually taken on a fixed rhythm).
 * Nothing changes until the person saves the prefilled editor.
 */
export type ScheduleNudge = {
  medicationId: string;
  name: string;
  cadence: "daily" | "weekly";
  /** `known`: a drug usually taken on this rhythm; `pattern`: logged that way lately. */
  reason: "known" | "pattern";
  /** Ready to show: "Levotiroxina parece diaria. ¿Ponerle horario?" */
  title: string;
  /** "En ayunas al despertar · 07:30", "Semanal · jueves · cualquier hora". */
  detail: string;
  /** What the editor opens prefilled with. */
  schedule: MedicationSchedule;
  /** Prefilled «Cómo tomarlo» when the medication has none ("en ayunas"); null to leave it. */
  instructions: string | null;
};
