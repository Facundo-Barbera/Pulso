import { randomUUID } from "node:crypto";
import type {
  AdherenceReport,
  DoseEvent,
  DoseLogInput,
  DoseSlot,
  DoseStatus,
  Medication,
  MedicationDay,
  MedicationInput,
  MedicationPatch,
  MedicationSchedule,
} from "@pulso/contract";
import { z } from "zod";
import { db } from "../db";
import { addDays, computeAdherence, DATE, HISTORY_DAYS, localNow, slotKey, slotTimes, TIME, type StatusIndex } from "./schedule";

// Validation shared by the phone routes and the agent tools.
const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
export const dateSchema = z.string().regex(DATE, "expected YYYY-MM-DD");
export const timeSchema = z.string().regex(TIME, "expected HH:MM (24h)");
export const scheduleSchema = z.object({
  asNeeded: z.boolean().default(false),
  times: z.array(timeSchema).max(24).default([]),
  days: z.array(z.number().int().min(1).max(7)).max(7).default([]),
});
const fields = {
  name: text(80),
  kind: z.enum(["medicamento", "suplemento"]),
  dose: z.number().positive().max(100_000),
  unit: text(24),
  form: optText(40),
  instructions: optText(200),
  schedule: scheduleSchema,
  startDate: dateSchema,
  endDate: dateSchema.nullable(),
  stock: z.number().min(0).max(100_000).nullable(),
  lowStockThreshold: z.number().min(0).max(100_000).nullable(),
  active: z.boolean(),
  notes: optText(500),
};
export const medicationInputSchema = z.object({
  ...fields,
  kind: fields.kind.default("medicamento"),
  startDate: fields.startDate.optional(),
  endDate: fields.endDate.optional(),
  stock: fields.stock.optional(),
  lowStockThreshold: fields.lowStockThreshold.optional(),
  active: fields.active.default(true),
  schedule: scheduleSchema.default({ asNeeded: true, times: [], days: [] }),
});
export const medicationPatchSchema = z.object(fields).partial();
export const doseLogSchema = z.object({
  medicationId: z.string().min(1),
  date: dateSchema,
  scheduledTime: timeSchema.nullish(),
  status: z.enum(["tomada", "omitida", "pospuesta"]),
  takenAt: z.number().int().positive().nullish(),
});

export class MedicationError extends Error {
  constructor(
    public code: "not_found" | "invalid_request",
    message: string,
  ) {
    super(message);
  }
}

type MedRow = {
  id: string;
  name: string;
  kind: Medication["kind"];
  dose: number;
  unit: string;
  form: string | null;
  instructions: string | null;
  schedule: string;
  start_date: string;
  end_date: string | null;
  stock: number | null;
  low_stock_threshold: number | null;
  active: number;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

type DoseRow = {
  id: string;
  medication_id: string;
  date: string;
  scheduled_time: string | null;
  status: DoseStatus;
  taken_at: number | null;
  logged_at: number;
};

const toMedication = (row: MedRow): Medication => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  dose: row.dose,
  unit: row.unit,
  form: row.form,
  instructions: row.instructions,
  schedule: JSON.parse(row.schedule) as MedicationSchedule,
  startDate: row.start_date,
  endDate: row.end_date,
  stock: row.stock,
  lowStockThreshold: row.low_stock_threshold,
  lowStock: row.stock !== null && row.low_stock_threshold !== null && row.stock <= row.low_stock_threshold,
  active: row.active === 1,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toDose = (row: DoseRow): DoseEvent => ({
  id: row.id,
  medicationId: row.medication_id,
  date: row.date,
  scheduledTime: row.scheduled_time,
  status: row.status,
  takenAt: row.taken_at,
  loggedAt: row.logged_at,
});

/** Times sorted and deduped; as-needed drops times and days. */
function normalizeSchedule(schedule: MedicationSchedule): MedicationSchedule {
  if (schedule.asNeeded) return { asNeeded: true, times: [], days: [] };
  if (schedule.times.length === 0) throw new MedicationError("invalid_request", "a scheduled medication needs at least one time (or asNeeded: true)");
  const days = [...new Set(schedule.days)].sort();
  return { asNeeded: false, times: [...new Set(schedule.times)].sort(), days: days.length === 7 ? [] : days };
}

export function listMedications(opts: { includeInactive?: boolean } = {}): Medication[] {
  const where = opts.includeInactive ? "" : "WHERE active = 1";
  return db().query<MedRow, []>(`SELECT * FROM medications ${where} ORDER BY active DESC, name COLLATE NOCASE`).all().map(toMedication);
}

export function getMedication(id: string): Medication {
  const row = db().query<MedRow, [string]>("SELECT * FROM medications WHERE id = ?").get(id);
  if (!row) throw new MedicationError("not_found", `no medication with id ${id}`);
  return toMedication(row);
}

export function addMedication(raw: MedicationInput, today = localNow().date): Medication {
  const input = medicationInputSchema.parse(raw);
  const id = randomUUID();
  const now = Date.now();
  const startDate = input.startDate ?? today;
  if (input.endDate && input.endDate < startDate) throw new MedicationError("invalid_request", "endDate is before startDate");
  db()
    .query(
      `INSERT INTO medications (id, name, kind, dose, unit, form, instructions, schedule, start_date, end_date, stock, low_stock_threshold, active, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.kind,
      input.dose,
      input.unit,
      input.form,
      input.instructions,
      JSON.stringify(normalizeSchedule(input.schedule)),
      startDate,
      input.endDate ?? null,
      input.stock ?? null,
      input.lowStockThreshold ?? null,
      input.active ? 1 : 0,
      input.notes,
      now,
      now,
    );
  return getMedication(id);
}

export function updateMedication(id: string, raw: MedicationPatch): Medication {
  const patch = medicationPatchSchema.parse(raw);
  const merged = { ...getMedication(id), ...patch };
  if (patch.schedule) merged.schedule = normalizeSchedule(patch.schedule);
  if (merged.endDate && merged.endDate < merged.startDate) throw new MedicationError("invalid_request", "endDate is before startDate");
  db()
    .query(
      `UPDATE medications SET name = ?, kind = ?, dose = ?, unit = ?, form = ?, instructions = ?, schedule = ?, start_date = ?, end_date = ?,
       stock = ?, low_stock_threshold = ?, active = ?, notes = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      merged.name,
      merged.kind,
      merged.dose,
      merged.unit,
      merged.form,
      merged.instructions,
      JSON.stringify(merged.schedule),
      merged.startDate,
      merged.endDate,
      merged.stock,
      merged.lowStockThreshold,
      merged.active ? 1 : 0,
      merged.notes,
      Date.now(),
      id,
    );
  return getMedication(id);
}

export function deleteMedication(id: string): void {
  if (db().query("DELETE FROM medications WHERE id = ?").run(id).changes === 0) throw new MedicationError("not_found", `no medication with id ${id}`);
}

/** Moves stock by `delta` doses, never below zero. No-op when stock isn't tracked. */
function moveStock(medicationId: string, delta: number) {
  if (delta === 0) return;
  db().query("UPDATE medications SET stock = MAX(0, stock + ?) WHERE id = ? AND stock IS NOT NULL").run(delta, medicationId);
}

/**
 * Records what happened to a dose. A scheduled slot (date + time) has at most
 * one event, so re-logging it overwrites; as-needed intakes always add one.
 * Stock follows "tomada": it drops when a dose becomes taken and comes back
 * when a taken dose is changed or undone.
 */
export function logDose(raw: DoseLogInput): DoseEvent {
  const input = doseLogSchema.parse(raw);
  const med = getMedication(input.medicationId);
  const time = input.scheduledTime ?? null;
  if (time === null && !med.schedule.asNeeded && input.status !== "tomada") {
    throw new MedicationError("invalid_request", "scheduledTime is required for a scheduled medication unless logging an extra intake");
  }
  const takenAt = input.status === "tomada" ? (input.takenAt ?? Date.now()) : null;
  const now = Date.now();

  return db().transaction(() => {
    const existing =
      time === null
        ? null
        : db()
            .query<DoseRow, [string, string, string]>("SELECT * FROM medication_doses WHERE medication_id = ? AND date = ? AND scheduled_time = ?")
            .get(med.id, input.date, time);
    const wasTaken = existing?.status === "tomada";
    const isTaken = input.status === "tomada";
    moveStock(med.id, (wasTaken ? 1 : 0) - (isTaken ? 1 : 0));

    const id = existing?.id ?? randomUUID();
    if (existing) {
      db().query("UPDATE medication_doses SET status = ?, taken_at = ?, logged_at = ? WHERE id = ?").run(input.status, takenAt, now, id);
    } else {
      db()
        .query("INSERT INTO medication_doses (id, medication_id, date, scheduled_time, status, taken_at, logged_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, med.id, input.date, time, input.status, takenAt, now);
    }
    return toDose(db().query<DoseRow, [string]>("SELECT * FROM medication_doses WHERE id = ?").get(id)!);
  })();
}

/** Removes a logged event (the slot goes back to pending), returning stock if it was taken. */
export function undoDose(eventId: string): void {
  db().transaction(() => {
    const row = db().query<DoseRow, [string]>("SELECT * FROM medication_doses WHERE id = ?").get(eventId);
    if (!row) throw new MedicationError("not_found", `no dose event with id ${eventId}`);
    if (row.status === "tomada") moveStock(row.medication_id, 1);
    db().query("DELETE FROM medication_doses WHERE id = ?").run(eventId);
  })();
}

export function dosesBetween(from: string, to: string, medicationId?: string): DoseEvent[] {
  const rows = medicationId
    ? db()
        .query<DoseRow, [string, string, string]>("SELECT * FROM medication_doses WHERE date BETWEEN ? AND ? AND medication_id = ? ORDER BY date, scheduled_time")
        .all(from, to, medicationId)
    : db().query<DoseRow, [string, string]>("SELECT * FROM medication_doses WHERE date BETWEEN ? AND ? ORDER BY date, scheduled_time").all(from, to);
  return rows.map(toDose);
}

function statusIndex(events: DoseEvent[]): StatusIndex {
  const index: StatusIndex = new Map();
  for (const e of events) if (e.scheduledTime) index.set(slotKey(e.medicationId, e.date, e.scheduledTime), e.status);
  return index;
}

/** Every slot of `date` with its status, plus as-needed intakes and the next pending dose from `time` on. */
export function medicationDay(date: string, time: string): MedicationDay {
  const meds = listMedications();
  const events = dosesBetween(date, date);
  const bySlot = new Map(events.filter((e) => e.scheduledTime).map((e) => [slotKey(e.medicationId, e.date, e.scheduledTime!), e]));
  const slots: DoseSlot[] = meds
    .flatMap((med) =>
      slotTimes(med, date).map((t): DoseSlot => {
        const event = bySlot.get(slotKey(med.id, date, t));
        return {
          medicationId: med.id,
          name: med.name,
          kind: med.kind,
          dose: med.dose,
          unit: med.unit,
          instructions: med.instructions,
          date,
          time: t,
          status: event?.status ?? "pendiente",
          eventId: event?.id ?? null,
          takenAt: event?.takenAt ?? null,
        };
      }),
    )
    .sort((a, b) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name));
  const next = slots.find((s) => (s.status === "pendiente" || s.status === "pospuesta") && s.time >= time) ?? null;
  return { date, slots, asNeeded: events.filter((e) => e.scheduledTime === null), next };
}

export function adherence(date: string, time: string): AdherenceReport {
  // Paused meds drop out; to stop one but keep its history, set an endDate instead.
  const meds = listMedications();
  const events = dosesBetween(addDays(date, -HISTORY_DAYS), date);
  return { asOf: { date, time }, ...computeAdherence(meds, statusIndex(events), date, time) };
}
