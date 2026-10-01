/** Medication and supplements: what the person takes, when, and whether they took it. */

export type MedicationKind = "medicamento" | "suplemento";
export type DoseStatus = "tomada" | "omitida" | "pospuesta";

/**
 * When doses are due. Times are local "HH:MM". `days` are ISO weekdays
 * (1 = lunes … 7 = domingo); empty means every day. `asNeeded` meds have no
 * slots and never count against adherence.
 */
export type MedicationSchedule = {
  asNeeded: boolean;
  times: string[];
  days: number[];
};

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
  schedule?: MedicationSchedule;
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
  /** "HH:MM" of the slot; null for an as-needed intake. */
  scheduledTime: string | null;
  status: DoseStatus;
  /** Epoch ms, when status is "tomada". */
  takenAt: number | null;
  loggedAt: number;
};

export type DoseLogInput = {
  medicationId: string;
  date: string;
  /** Omit or null for as-needed. */
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
  time: string;
  status: DoseStatus | "pendiente";
  eventId: string | null;
  takenAt: number | null;
};

export type MedicationDay = {
  date: string;
  slots: DoseSlot[];
  /** As-needed intakes logged that day. */
  asNeeded: DoseEvent[];
  /** First pending slot at or after the given time, if any. */
  next: DoseSlot | null;
};

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
