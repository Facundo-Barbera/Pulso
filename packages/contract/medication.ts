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

/**
 * When doses are due. A schedule mixes fixed clock `times` with slots tied to
 * a moment of the day: after training, with a meal, before bed. Times are
 * local "HH:MM". `days` are ISO weekdays (1 = lunes … 7 = domingo) and apply
 * to every slot; empty means every day. `asNeeded` meds have no slots and
 * never count against adherence.
 */
export type MedicationSchedule = {
  asNeeded: boolean;
  times: string[];
  days: number[];
  /** "Después de entrenar"; null when not tied to training. */
  training: TrainingRule | null;
  /** "Con una comida". */
  meals: DoseMeal[];
  /** "Antes de dormir": 30 min before the calendar's sleep time. */
  bedtime: boolean;
};

/** What callers send: the event-linked parts default to off, so old clients keep working. */
export type MedicationScheduleInput = Pick<MedicationSchedule, "asNeeded" | "times" | "days"> & Partial<Pick<MedicationSchedule, "training" | "meals" | "bedtime">>;

/** What a slot hangs on: a clock time, the end of a workout, a meal or bedtime. */
export type DoseMoment = "hora" | "entreno" | DoseMeal | "dormir";

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
  /** The slot's key (`DoseSlot.slot`): "HH:MM" or a moment like "entreno"; null for an as-needed intake. */
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
   * "cena", "dormir"). A training slot keeps its key whether it ends up after a
   * workout or on the rest-day rule, so it is one dose a day either way.
   */
  slot: string;
  moment: DoseMoment;
  /** When it is due, "HH:MM"; null while waiting for a workout that is planned or in progress. */
  time: string | null;
  training: TrainingSlot | null;
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
  /** Sorted by time; slots still waiting for a workout go last. */
  slots: DoseSlot[];
  /** As-needed intakes logged that day. */
  asNeeded: DoseEvent[];
  /** First pending slot with a time at or after the given time, if any. */
  next: DoseSlot | null;
};

/** Slots of the coming days, resolved, for planning reminders. */
export type MedicationUpcoming = { from: string; slots: DoseSlot[] };

export type AdherenceWindow = {
  /** Slots already due in the window. */
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
