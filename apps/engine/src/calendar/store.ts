import { randomUUID } from "node:crypto";
import {
  MEAL_SLOTS,
  type AppleCalendarSync,
  type BusyBlock,
  type BusyBlockInput,
  type BusyBlockPatch,
  type CalendarPreferences,
  type HealthEvent,
  type HealthEventInput,
  type HealthEventPatch,
  type MealTime,
  type PlannedSession,
} from "@pulso/contract";
import { z } from "zod";
import { db } from "../db";
import { addDays, DATE, TIME } from "./time";

// Validation shared by the phone routes and the agent tools.
const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
export const dateSchema = z.string().regex(DATE, "expected YYYY-MM-DD");
export const timeSchema = z.string().regex(TIME, "expected HH:MM (24h)");
const weekdays = z.array(z.number().int().min(1).max(7)).max(7);
const mealTime = z.object({ slot: z.enum(MEAL_SLOTS), time: timeSchema });

const busyFields = {
  title: z.string().trim().min(1).max(120),
  allDay: z.boolean(),
  date: dateSchema,
  endDate: dateSchema.nullable(),
  start: timeSchema.nullable(),
  end: timeSchema.nullable(),
  weekdays,
  until: dateSchema.nullable(),
  source: z.enum(["manual", "coach", "apple_calendar"]),
  notes: optText(500),
};
export const busyInputSchema = z.object({
  ...busyFields,
  allDay: busyFields.allDay.optional(),
  endDate: busyFields.endDate.optional(),
  start: busyFields.start.optional(),
  end: busyFields.end.optional(),
  weekdays: weekdays.default([]),
  until: busyFields.until.optional(),
  source: busyFields.source.default("manual"),
});
export const busyPatchSchema = z.object(busyFields).partial();

export const BODY_AREAS = [
  "knee", "shoulder", "ankle", "wrist", "elbow", "hip", "general",
  "chest", "front_delts", "side_delts", "rear_delts", "traps", "upper_back", "lats", "lower_back", "biceps", "triceps",
  "forearms", "abs", "obliques", "glutes", "quads", "hamstrings", "adductors", "abductors", "calves", "neck",
] as const;
const healthFields = {
  kind: z.enum(["lesion", "enfermedad", "sintoma", "cirugia", "otro"]),
  title: z.string().trim().min(1).max(120),
  bodyArea: z.enum(BODY_AREAS).nullable(),
  severity: z.number().int().min(1).max(5),
  startDate: dateSchema,
  endDate: dateSchema.nullable(),
  status: z.enum(["activa", "recuperandose", "resuelta"]),
  notes: optText(1000),
  affectedTraining: optText(300),
};
export const healthInputSchema = z.object({
  ...healthFields,
  bodyArea: healthFields.bodyArea.optional(),
  severity: healthFields.severity.default(2),
  endDate: healthFields.endDate.optional(),
  status: healthFields.status.optional(),
});
export const healthPatchSchema = z.object(healthFields).partial();

export const preferencesSchema = z
  .object({
    trainingTimes: z.array(timeSchema).max(6),
    sessionMinutes: z.number().int().min(15).max(240),
    restDays: weekdays,
    wakeTime: timeSchema,
    sleepTime: timeSchema,
    mealTimes: z.array(mealTime).max(MEAL_SLOTS.length),
  })
  .partial();
export const mealTimesSchema = z.array(mealTime).max(MEAL_SLOTS.length);

export class CalendarError extends Error {
  constructor(
    public code: "not_found" | "invalid_request",
    message: string,
  ) {
    super(message);
  }
}

// ── Preferences ──────────────────────────────────────────────────────────────

export const DEFAULT_PREFERENCES: CalendarPreferences = {
  trainingTimes: [],
  sessionMinutes: 60,
  restDays: [],
  wakeTime: "07:00",
  sleepTime: "23:00",
  mealTimes: [],
};

export function getPreferences(): CalendarPreferences {
  const row = db().query<{ value: string }, []>("SELECT value FROM calendar_settings WHERE key = 'preferences'").get();
  return { ...DEFAULT_PREFERENCES, ...(row ? (JSON.parse(row.value) as Partial<CalendarPreferences>) : {}) };
}

/** Merges the given fields into the stored preferences. */
export function setPreferences(raw: unknown): CalendarPreferences {
  const patch = preferencesSchema.parse(raw);
  const next = { ...getPreferences(), ...patch };
  next.trainingTimes = [...new Set(next.trainingTimes)];
  next.restDays = [...new Set(next.restDays)].sort();
  next.mealTimes = sortMeals(dedupeMeals(next.mealTimes));
  db().query("INSERT INTO calendar_settings (key, value) VALUES ('preferences', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next));
  return next;
}

// ── Meal times ───────────────────────────────────────────────────────────────

const dedupeMeals = (meals: MealTime[]) => [...new Map(meals.map((m) => [m.slot, m])).values()];
const sortMeals = (meals: MealTime[]) => [...meals].sort((a, b) => a.time.localeCompare(b.time));

/** Overrides the meal times of specific dates (the rest keep the defaults). An empty list clears the override. */
export function setMealTimesFor(dates: string[], raw: unknown): Record<string, MealTime[]> {
  const meals = dedupeMeals(mealTimesSchema.parse(raw));
  const days = z.array(dateSchema).min(1).max(62).parse(dates);
  db().transaction(() => {
    for (const date of days) {
      db().query("DELETE FROM meal_times WHERE date = ?").run(date);
      for (const m of meals) db().query("INSERT INTO meal_times (date, slot, time) VALUES (?, ?, ?)").run(date, m.slot, m.time);
    }
  })();
  return mealTimesBetween(days[0]!, days.at(-1)!, days);
}

/** Effective meal times per date: the date's override, else the defaults. */
export function mealTimesBetween(from: string, to: string, dates?: string[]): Record<string, MealTime[]> {
  const defaults = getPreferences().mealTimes;
  const overrides = new Map<string, MealTime[]>();
  for (const row of db().query<{ date: string; slot: MealTime["slot"]; time: string }, [string, string]>("SELECT * FROM meal_times WHERE date BETWEEN ? AND ?").all(from, to)) {
    overrides.set(row.date, [...(overrides.get(row.date) ?? []), { slot: row.slot, time: row.time }]);
  }
  const out: Record<string, MealTime[]> = {};
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (dates && !dates.includes(d)) continue;
    out[d] = sortMeals(overrides.get(d) ?? defaults);
  }
  return out;
}

// ── Busy blocks ──────────────────────────────────────────────────────────────

type BusyRow = {
  id: string;
  title: string;
  all_day: number;
  date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  weekdays: string;
  until: string | null;
  source: BusyBlock["source"];
  notes: string | null;
  created_at: number;
  updated_at: number;
};

const toBlock = (r: BusyRow): BusyBlock => ({
  id: r.id,
  title: r.title,
  allDay: r.all_day === 1,
  date: r.date,
  endDate: r.end_date,
  start: r.start_time,
  end: r.end_time,
  weekdays: JSON.parse(r.weekdays),
  until: r.until,
  source: r.source,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** All-day unless both times are given; times must make a forward range; recurring blocks are single-day. */
function normalizeBlock<T extends Omit<BusyBlock, "id" | "createdAt" | "updatedAt">>(b: T): T {
  const timed = b.start != null && b.end != null && !b.allDay;
  if (!b.allDay && !timed) throw new CalendarError("invalid_request", "a timed busy block needs start and end (HH:MM), or allDay: true");
  if (timed && b.end! <= b.start!) throw new CalendarError("invalid_request", "end must be after start (blocks past midnight: split them)");
  if (b.endDate && b.endDate < b.date) throw new CalendarError("invalid_request", "endDate must be on or after date");
  if (b.until && b.until < b.date) throw new CalendarError("invalid_request", "until must be on or after date");
  const recurring = b.weekdays.length > 0;
  return {
    ...b,
    allDay: !timed,
    start: timed ? b.start : null,
    end: timed ? b.end : null,
    weekdays: [...new Set(b.weekdays)].sort(),
    endDate: recurring || b.endDate === b.date ? null : (b.endDate ?? null),
    until: recurring ? (b.until ?? null) : null,
  };
}

export function listBusyBlocks(opts: { from?: string; to?: string } = {}): BusyBlock[] {
  const all = db().query<BusyRow, []>("SELECT * FROM busy_blocks ORDER BY date, start_time").all().map(toBlock);
  // Overlap with [from, to]: starts before `to` and has not finished before `from`.
  return all.filter((b) => (!opts.to || b.date <= opts.to) && (!opts.from || (b.weekdays.length ? (b.until ?? "9999") : (b.endDate ?? b.date)) >= opts.from));
}

export function getBusyBlock(id: string): BusyBlock {
  const row = db().query<BusyRow, [string]>("SELECT * FROM busy_blocks WHERE id = ?").get(id);
  if (!row) throw new CalendarError("not_found", `no busy block with id ${id}`);
  return toBlock(row);
}

const busyInsert = `INSERT INTO busy_blocks (id, title, all_day, date, end_date, start_time, end_time, weekdays, until, source, external_id, notes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function insertBlock(b: Omit<BusyBlock, "id" | "createdAt" | "updatedAt">, externalId: string | null, now: number): BusyBlock {
  const id = randomUUID();
  db().query(busyInsert).run(id, b.title, b.allDay ? 1 : 0, b.date, b.endDate, b.start, b.end, JSON.stringify(b.weekdays), b.until, b.source, externalId, b.notes, now, now);
  return getBusyBlock(id);
}

export function addBusyBlock(raw: BusyBlockInput, now = Date.now()): BusyBlock {
  const input = busyInputSchema.parse(raw);
  const block = normalizeBlock({
    ...input,
    // Half a time range is a mistake to report, not an all-day block.
    allDay: input.allDay ?? !(input.start || input.end),
    endDate: input.endDate ?? null,
    start: input.start ?? null,
    end: input.end ?? null,
    until: input.until ?? null,
  });
  return insertBlock(block, null, now);
}

export function updateBusyBlock(id: string, raw: BusyBlockPatch, now = Date.now()): BusyBlock {
  const patch = busyPatchSchema.parse(raw);
  const current = getBusyBlock(id);
  const merged = { ...current, ...patch };
  // Giving times to an all-day block makes it timed.
  if (patch.start && patch.end && patch.allDay === undefined) merged.allDay = false;
  const b = normalizeBlock(merged);
  db()
    .query("UPDATE busy_blocks SET title = ?, all_day = ?, date = ?, end_date = ?, start_time = ?, end_time = ?, weekdays = ?, until = ?, source = ?, notes = ?, updated_at = ? WHERE id = ?")
    .run(b.title, b.allDay ? 1 : 0, b.date, b.endDate, b.start, b.end, JSON.stringify(b.weekdays), b.until, b.source, b.notes, now, id);
  return getBusyBlock(id);
}

export function deleteBusyBlock(id: string): BusyBlock {
  const block = getBusyBlock(id);
  db().query("DELETE FROM busy_blocks WHERE id = ?").run(id);
  return block;
}

const syncSchema = z.object({
  from: dateSchema,
  to: dateSchema,
  events: z
    .array(
      z.object({
        externalId: z.string().min(1).max(300),
        title: z.string().trim().max(120).transform((t) => t || "Ocupado"),
        allDay: z.boolean(),
        date: dateSchema,
        endDate: dateSchema.nullish(),
        start: timeSchema.nullish(),
        end: timeSchema.nullish(),
      }),
    )
    .max(1000),
});

/** Replaces the Apple Calendar blocks that start in [from, to] with the phone's current view of them. Returns how many are stored. */
export function syncAppleCalendar(raw: AppleCalendarSync, now = Date.now()): number {
  const input = syncSchema.parse(raw);
  return db().transaction(() => {
    db().query("DELETE FROM busy_blocks WHERE source = 'apple_calendar' AND date BETWEEN ? AND ?").run(input.from, input.to);
    let written = 0;
    for (const e of input.events) {
      // Events past midnight end at 23:59 on their first day; zero-length ones are skipped.
      const timed = !e.allDay && e.start && e.end;
      const end = timed && e.end! <= e.start! ? "23:59" : e.end;
      if (timed && end! <= e.start!) continue;
      const block = normalizeBlock({
        title: e.title, allDay: !timed, date: e.date, endDate: e.allDay ? (e.endDate ?? null) : null,
        start: timed ? e.start! : null, end: timed ? end! : null, weekdays: [], until: null, source: "apple_calendar" as const, notes: null,
      });
      db().query("DELETE FROM busy_blocks WHERE external_id = ?").run(e.externalId);
      insertBlock(block, e.externalId, now);
      written++;
    }
    return written;
  })();
}

// ── Planned sessions ─────────────────────────────────────────────────────────

type PlannedRow = {
  id: string;
  program_id: string | null;
  day_id: string | null;
  name: string;
  date: string;
  time: string;
  duration_min: number;
  status: "planned" | "skipped" | "moved";
  reason: string | null;
  conflict: string | null;
  moved_from: string | null;
};

/** As stored: `status` is never "done" or "missed" here (the timeline works those out from logged sessions). */
export type StoredPlan = Omit<PlannedSession, "sessionId" | "status"> & { status: PlannedRow["status"] };

const toPlan = (r: PlannedRow): StoredPlan => ({
  id: r.id,
  programId: r.program_id,
  dayId: r.day_id,
  name: r.name,
  date: r.date,
  time: r.time,
  durationMin: r.duration_min,
  status: r.status,
  reason: r.reason,
  conflict: r.conflict,
  movedFrom: r.moved_from,
});

export function listPlanned(from: string, to: string): StoredPlan[] {
  return db().query<PlannedRow, [string, string]>("SELECT * FROM planned_sessions WHERE date BETWEEN ? AND ? ORDER BY date, time").all(from, to).map(toPlan);
}

export function getPlanned(id: string): StoredPlan {
  const row = db().query<PlannedRow, [string]>("SELECT * FROM planned_sessions WHERE id = ?").get(id);
  if (!row) throw new CalendarError("not_found", `no planned session with id ${id}`);
  return toPlan(row);
}

export function insertPlanned(p: Omit<StoredPlan, "id" | "status" | "conflict" | "movedFrom">, now = Date.now()): StoredPlan {
  const id = randomUUID();
  db()
    .query(
      `INSERT INTO planned_sessions (id, program_id, day_id, name, date, time, duration_min, status, reason, conflict, moved_from, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', ?, NULL, NULL, ?, ?)`,
    )
    .run(id, p.programId, p.dayId, p.name, p.date, p.time, p.durationMin, p.reason, now, now);
  return getPlanned(id);
}

/** Drops planned (not skipped) sessions in [from, to], before writing a fresh plan over them. */
export function clearPlanned(from: string, to: string): number {
  return db().query("DELETE FROM planned_sessions WHERE date BETWEEN ? AND ? AND status != 'skipped'").run(from, to).changes;
}

export function writePlanned(id: string, fields: Partial<Pick<StoredPlan, "date" | "time" | "durationMin" | "status" | "reason" | "conflict" | "movedFrom">>, now = Date.now()): StoredPlan {
  const p = { ...getPlanned(id), ...fields };
  db()
    .query("UPDATE planned_sessions SET date = ?, time = ?, duration_min = ?, status = ?, reason = ?, conflict = ?, moved_from = ?, updated_at = ? WHERE id = ?")
    .run(p.date, p.time, p.durationMin, p.status, p.reason, p.conflict, p.movedFrom, now, id);
  return getPlanned(id);
}

export function deletePlanned(id: string): void {
  getPlanned(id);
  db().query("DELETE FROM planned_sessions WHERE id = ?").run(id);
}

// ── Health events ────────────────────────────────────────────────────────────

type HealthRow = {
  id: string;
  kind: HealthEvent["kind"];
  title: string;
  body_area: HealthEvent["bodyArea"];
  severity: number;
  start_date: string;
  end_date: string | null;
  status: HealthEvent["status"];
  notes: string | null;
  affected_training: string | null;
  created_at: number;
  updated_at: number;
};

const toEvent = (r: HealthRow): HealthEvent => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  bodyArea: r.body_area,
  severity: r.severity,
  startDate: r.start_date,
  endDate: r.end_date,
  status: r.status,
  notes: r.notes,
  affectedTraining: r.affected_training,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Active first (newest start first), then the rest by start date, newest first. */
export function listHealthEvents(opts: { from?: string; to?: string; activeOnly?: boolean } = {}): HealthEvent[] {
  return db()
    .query<HealthRow, []>("SELECT * FROM health_events ORDER BY (status = 'resuelta'), start_date DESC, created_at DESC")
    .all()
    .map(toEvent)
    .filter((e) => !opts.activeOnly || e.status !== "resuelta")
    .filter((e) => (!opts.to || e.startDate <= opts.to) && (!opts.from || e.endDate === null || e.endDate >= opts.from));
}

export function getHealthEvent(id: string): HealthEvent {
  const row = db().query<HealthRow, [string]>("SELECT * FROM health_events WHERE id = ?").get(id);
  if (!row) throw new CalendarError("not_found", `no health event with id ${id}`);
  return toEvent(row);
}

/** An end date in the past means it is over; "resuelta" without an end date ends it on `today`. */
function settle(e: Pick<HealthEvent, "startDate" | "endDate" | "status">, today: string) {
  if (e.endDate && e.endDate < e.startDate) throw new CalendarError("invalid_request", "endDate must be on or after startDate");
  if (e.status === "resuelta" && !e.endDate) return { ...e, endDate: today < e.startDate ? e.startDate : today };
  return e;
}

export function addHealthEvent(raw: HealthEventInput, today: string, now = Date.now()): HealthEvent {
  const input = healthInputSchema.parse(raw);
  const status = input.status ?? (input.endDate && input.endDate < today ? "resuelta" : "activa");
  const e = settle({ startDate: input.startDate, endDate: input.endDate ?? null, status }, today);
  const id = randomUUID();
  db()
    .query(
      `INSERT INTO health_events (id, kind, title, body_area, severity, start_date, end_date, status, notes, affected_training, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.kind, input.title, input.bodyArea ?? null, input.severity, e.startDate, e.endDate, e.status, input.notes, input.affectedTraining, now, now);
  return getHealthEvent(id);
}

export function updateHealthEvent(id: string, raw: HealthEventPatch, today: string, now = Date.now()): HealthEvent {
  const patch = healthPatchSchema.parse(raw);
  const merged = { ...getHealthEvent(id), ...patch };
  const e = { ...merged, ...settle(merged, today) };
  db()
    .query(
      "UPDATE health_events SET kind = ?, title = ?, body_area = ?, severity = ?, start_date = ?, end_date = ?, status = ?, notes = ?, affected_training = ?, updated_at = ? WHERE id = ?",
    )
    .run(e.kind, e.title, e.bodyArea, e.severity, e.startDate, e.endDate, e.status, e.notes, e.affectedTraining, now, id);
  return getHealthEvent(id);
}

export function deleteHealthEvent(id: string): HealthEvent {
  const e = getHealthEvent(id);
  db().query("DELETE FROM health_events WHERE id = ?").run(id);
  return e;
}
