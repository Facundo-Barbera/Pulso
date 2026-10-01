/**
 * The planned training schedule: writing a week's plan for the active program
 * and keeping it valid when availability or health changes. The decisions are
 * in planner.ts; this file reads and writes.
 */
import type { PlannedSession, PlannedSessionPatch, PlanWeekResult, ProgramDay, Replan } from "@pulso/contract";
import { z } from "zod";
import { ANATOMY } from "../training/anatomy";
import { getActiveProgram, getProgram } from "../training/store";
import { conflictOf, findSlot, planWeek, type Context, type PlanDay } from "./planner";
import { expand } from "./recurrence";
import { loggedSessions } from "./sources";
import { CalendarError, clearPlanned, dateSchema, getPlanned, getPreferences, insertPlanned, listBusyBlocks, listHealthEvents, listPlanned, timeSchema, writePlanned, type StoredPlan } from "./store";
import { addDays, local, weekStart } from "./time";

/** How far ahead re-planning looks after a change. */
const HORIZON_DAYS = 60;

export function toPlanDay(day: ProgramDay): PlanDay {
  return {
    id: day.id,
    name: day.name,
    weekday: day.weekday,
    exercises: day.exercises.map((e) => ({ name: e.exerciseName, muscles: ANATOMY[e.exerciseId]?.primary ?? [] })),
  };
}

/** Busy blocks, health events and preferences around [from, to] (±3 days, where moves can land). */
export function contextFor(from: string, to: string, at = new Date()): Context {
  const now = local(at);
  const blocks = listBusyBlocks({ from: addDays(from, -3), to: addDays(to, 3) });
  return {
    busy: expand(blocks, addDays(from, -3), addDays(to, 3)),
    health: listHealthEvents({ activeOnly: true }),
    prefs: getPreferences(),
    today: now.date,
    now: now.time,
  };
}

/** Planned sessions in [from, to] with what actually happened: done when a session of that program day was logged that date. */
export function plannedView(from: string, to: string, today = local().date): PlannedSession[] {
  const logged = loggedSessions(from, to);
  return listPlanned(from, to).map((p) => {
    const session = logged.find((s) => s.date === p.date && (p.dayId ? s.dayId === p.dayId : s.name === p.name));
    const status = session ? "done" : p.status === "skipped" ? "skipped" : p.date < today ? "missed" : p.status;
    return { ...p, status, sessionId: session?.id ?? null };
  });
}

export const placementSchema = z.object({
  dayId: z.string().min(1),
  date: dateSchema,
  time: timeSchema,
  durationMin: z.number().int().min(15).max(240).optional(),
});

/**
 * Writes the active program's plan for the 7 days from `from` (default today),
 * replacing what was planned there from today on. Program days already done
 * this week are left out. With `placements` the Coach decides dates and
 * times itself; clashes come back as warnings.
 */
export function planTrainingWeek(opts: { from?: string; placements?: z.input<typeof placementSchema>[]; reason?: string | null } = {}, at = new Date()): PlanWeekResult {
  const program = getActiveProgram();
  if (!program) throw new CalendarError("invalid_request", "there is no active program to plan: create one first");
  const today = local(at).date;
  const from = opts.from ? dateSchema.parse(opts.from) : today;
  const to = addDays(from, 6);
  const ctx = contextFor(from, to, at);
  const duration = ctx.prefs.sessionMinutes;
  const days = program.days.map(toPlanDay);
  const doneThisWeek = new Set(loggedSessions(weekStart(from), today).map((s) => s.dayId));
  const pending = days.filter((d) => !doneThisWeek.has(d.id));

  let result: Pick<PlanWeekResult, "unplaced" | "warnings"> & { placements: { dayId: string; date: string; time: string; durationMin: number }[] };
  if (opts.placements) {
    const placements = z.array(placementSchema).max(14).parse(opts.placements);
    const warnings: PlanWeekResult["warnings"] = [];
    for (const p of placements) {
      const day = days.find((d) => d.id === p.dayId);
      if (!day) throw new CalendarError("invalid_request", `day ${p.dayId} is not in the active program "${program.name}"`);
      if (p.date < today) throw new CalendarError("invalid_request", `${p.date} is in the past`);
      const clash = conflictOf({ date: p.date, time: p.time, durationMin: p.durationMin ?? duration }, day, ctx);
      if (clash) warnings.push({ dayId: day.id, name: day.name, message: clash.reason });
    }
    result = { placements: placements.map((p) => ({ ...p, durationMin: p.durationMin ?? duration })), unplaced: [], warnings };
  } else {
    const plan = planWeek({ from, to, days: pending, duration, ctx });
    result = { ...plan, placements: plan.placements.map((p) => ({ ...p, durationMin: duration })) };
  }

  clearPlanned(from < today ? today : from, to);
  const nameOf = new Map(days.map((d) => [d.id, d.name]));
  for (const p of result.placements) {
    insertPlanned({ programId: program.id, dayId: p.dayId, name: nameOf.get(p.dayId)!, date: p.date, time: p.time, durationMin: p.durationMin, reason: opts.reason ?? null });
  }
  return { from, to, sessions: plannedView(from, to, today), unplaced: result.unplaced, warnings: result.warnings };
}

/**
 * Checks every upcoming planned session against current busy blocks and
 * health events. A clashing one moves to the nearest free slot (same day,
 * then ±1…±3 days); if none fits, or an injury is the reason, it stays put
 * with `conflict` set for the Coach to decide.
 */
export function replan(at = new Date()): Replan {
  const today = local(at).date;
  const to = addDays(today, HORIZON_DAYS);
  const ctx = contextFor(today, to, at);
  const upcoming = listPlanned(today, to).filter((p) => p.status !== "skipped");
  const taken = new Set(upcoming.map((p) => p.date));
  const days = new Map<string, PlanDay | undefined>();
  const dayOf = (p: StoredPlan) => {
    if (!p.programId || !p.dayId) return undefined;
    if (!days.has(p.programId)) for (const d of getProgram(p.programId)?.days ?? []) days.set(d.id, toPlanDay(d));
    return days.get(p.dayId);
  };

  const result: Replan = { moved: [], unresolved: [] };
  for (const p of upcoming) {
    const clash = conflictOf(p, dayOf(p), ctx);
    if (!clash) {
      if (p.conflict) writePlanned(p.id, { conflict: null });
      continue;
    }
    taken.delete(p.date);
    const slot = clash.movable ? findSlot(p, ctx, taken) : null;
    if (slot) {
      writePlanned(p.id, { date: slot.date, time: slot.time, status: "moved", movedFrom: p.movedFrom ?? p.date, conflict: null, reason: `Movida: ${clash.reason}` });
      result.moved.push({ id: p.id, name: p.name, from: p.date, to: slot.date, time: slot.time });
      taken.add(slot.date);
    } else {
      writePlanned(p.id, { conflict: clash.reason });
      result.unresolved.push({ id: p.id, name: p.name, date: p.date, conflict: clash.reason });
      taken.add(p.date);
    }
  }
  return result;
}

const patchSchema = z.object({
  date: dateSchema.optional(),
  time: timeSchema.optional(),
  durationMin: z.number().int().min(15).max(240).optional(),
  status: z.enum(["planned", "skipped"]).optional(),
  reason: z.string().trim().max(300).nullish(),
});

/** Moves, re-times or skips one planned session. Moving it to another date marks it "moved". */
export function updatePlannedSession(id: string, raw: PlannedSessionPatch, at = new Date()): PlannedSession {
  const patch = patchSchema.parse(raw);
  const current = getPlanned(id);
  const moving = patch.date !== undefined && patch.date !== current.date;
  const next = writePlanned(id, {
    ...patch,
    reason: patch.reason === undefined ? current.reason : patch.reason || null,
    status: patch.status ?? (moving ? "moved" : current.status),
    movedFrom: moving ? (current.movedFrom ?? current.date) : current.movedFrom,
    conflict: null,
  });
  return plannedView(next.date, next.date, local(at).date).find((p) => p.id === id)!;
}
