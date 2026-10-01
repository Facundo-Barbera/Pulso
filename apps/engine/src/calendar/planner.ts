/**
 * Pure scheduling: where training fits around busy blocks, rest days and
 * health events, and where a clashing session can move. No database here.
 *
 * Health rules (only events with status "activa" restrict; "recuperandose"
 * only warns):
 * - An illness or surgery of severity ≥ 3, or anything "general" of severity
 *   ≥ 3, takes the whole day out.
 * - An injury whose area hits a program day's exercises (primary muscles)
 *   keeps that day off the plan at severity ≥ 4, and adds a warning below.
 */
import type { BodyArea, CalendarPreferences, HealthEvent, Muscle } from "@pulso/contract";
import type { Occurrence } from "./recurrence";
import { addDays, clock, dateRange, isoWeekday, minutes, overlaps } from "./time";

/** A program day as the planner needs it. */
export type PlanDay = { id: string; name: string; weekday: number | null; exercises: { name: string; muscles: Muscle[] }[] };

export type Context = {
  busy: Occurrence[];
  health: HealthEvent[];
  prefs: CalendarPreferences;
  today: string;
  /** "HH:MM" now; sessions today start after it. */
  now: string;
};

const JOINTS: Record<string, Muscle[]> = {
  knee: ["quads", "hamstrings", "calves"],
  shoulder: ["chest", "front_delts", "side_delts", "rear_delts", "traps"],
  ankle: ["calves"],
  wrist: ["forearms"],
  elbow: ["biceps", "triceps", "forearms"],
  hip: ["glutes", "adductors", "abductors", "hamstrings"],
};

export const AREA_NAMES: Record<BodyArea, string> = {
  knee: "rodilla", shoulder: "hombro", ankle: "tobillo", wrist: "muñeca", elbow: "codo", hip: "cadera", general: "general",
  chest: "pecho", front_delts: "deltoides anterior", side_delts: "deltoides lateral", rear_delts: "deltoides posterior", traps: "trapecio",
  upper_back: "espalda alta", lats: "dorsales", lower_back: "espalda baja", biceps: "bíceps", triceps: "tríceps", forearms: "antebrazos",
  abs: "abdomen", obliques: "oblicuos", glutes: "glúteos", quads: "cuádriceps", hamstrings: "isquiotibiales", adductors: "aductores",
  abductors: "abductores", calves: "gemelos", neck: "cuello",
};

export const activeOn = (e: HealthEvent, date: string) => e.status !== "resuelta" && e.startDate <= date && (e.endDate === null || e.endDate >= date);

const isIllness = (e: HealthEvent) => e.kind === "enfermedad" || e.kind === "cirugia" || e.bodyArea === "general";

/** Why nobody should train on `date` at all, or null. */
export function dayBlock(date: string, ctx: Context): string | null {
  const allDay = ctx.busy.find((o) => o.date === date && o.allDay);
  if (allDay) return `Ocupado todo el día: ${allDay.title}`;
  const sick = ctx.health.find((e) => isIllness(e) && e.status === "activa" && e.severity >= 3 && activeOn(e, date));
  return sick ? `${sick.kind === "cirugia" ? "Cirugía" : "Enfermedad"}: ${sick.title}` : null;
}

/** Exercises of `day` an injury touches, by name. */
function hits(e: HealthEvent, day: PlanDay): string[] {
  if (!e.bodyArea || isIllness(e)) return [];
  const muscles = JOINTS[e.bodyArea] ?? [e.bodyArea as Muscle];
  return day.exercises.filter((x) => x.muscles.some((m) => muscles.includes(m))).map((x) => x.name);
}

/** What active injuries on `date` mean for `day`: `severe` keeps it off the plan, `warning` asks to adapt it. */
export function injuryImpact(day: PlanDay, date: string, health: HealthEvent[]): { severe: string | null; warning: string | null } {
  let severe: string | null = null;
  const warnings: string[] = [];
  for (const e of health) {
    if (!activeOn(e, date)) continue;
    const touched = hits(e, day);
    if (touched.length === 0) continue;
    const text = `${e.title} (${AREA_NAMES[e.bodyArea!]}, ${e.severity}/5) afecta ${touched.join(", ")}`;
    if (e.status === "activa" && e.severity >= 4) severe ??= text;
    else warnings.push(text);
  }
  return { severe, warning: warnings.length ? `${warnings.join("; ")}: adapta o sustituye` : null };
}

/** The start time on `date`, closest to the preferred one, that fits `duration` between wake and sleep without touching a timed busy block. */
export function freeTime(date: string, duration: number, ctx: Context, preferred?: string): string | null {
  const wake = minutes(ctx.prefs.wakeTime);
  const sleep = minutes(ctx.prefs.sleepTime) > wake ? minutes(ctx.prefs.sleepTime) : 24 * 60;
  const earliest = date === ctx.today ? Math.max(wake, minutes(ctx.now)) : wake;
  const busy = ctx.busy.filter((o) => o.date === date && !o.allDay && o.start && o.end).map((o) => [minutes(o.start!), minutes(o.end!)] as const);
  const fits = (start: number) => start >= earliest && start + duration <= sleep && !busy.some(([s, e]) => overlaps(start, start + duration, s, e));
  const wanted = [...(preferred ? [preferred] : []), ...ctx.prefs.trainingTimes].map(minutes);
  // Then every half hour from 30 min after waking, nearest to the first wanted time first.
  const scan: number[] = [];
  for (let t = Math.ceil((wake + 30) / 30) * 30; t + duration <= sleep; t += 30) scan.push(t);
  const anchor = wanted[0];
  if (anchor !== undefined) scan.sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor) || a - b);
  const found = [...wanted, ...scan].find(fits);
  return found === undefined ? null : clock(found);
}

export type Placement = { dayId: string; name: string; date: string; time: string };

export type PlanResult = {
  placements: Placement[];
  unplaced: { dayId: string; name: string; reason: string }[];
  warnings: { dayId: string; name: string; message: string }[];
};

/**
 * Places each program day on a date in [from, to] (never before today): a
 * day pinned to a weekday goes there when it can; the rest spread out,
 * avoiding back-to-back days when possible and keeping program order.
 * `taken` dates already hold a session and are skipped.
 */
export function planWeek(input: { from: string; to: string; days: PlanDay[]; duration: number; taken?: Set<string>; ctx: Context }): PlanResult {
  const { days, duration, ctx } = input;
  const used = new Set(input.taken ?? []);
  const dates = dateRange(input.from, input.to).filter((d) => d >= ctx.today && !ctx.prefs.restDays.includes(isoWeekday(d)));
  const result: PlanResult = { placements: [], unplaced: [], warnings: [] };
  const severeReason = new Map<string, string>();

  const open = (day: PlanDay, date: string): string | null => {
    if (used.has(date) || dayBlock(date, ctx)) return null;
    const { severe } = injuryImpact(day, date, ctx.health);
    if (severe) {
      severeReason.set(day.id, severe);
      return null;
    }
    return freeTime(date, duration, ctx);
  };
  const place = (day: PlanDay, date: string, time: string) => {
    used.add(date);
    result.placements.push({ dayId: day.id, name: day.name, date, time });
    const { warning } = injuryImpact(day, date, ctx.health);
    if (warning) result.warnings.push({ dayId: day.id, name: day.name, message: warning });
  };

  const rest: PlanDay[] = [];
  for (const day of days) {
    const date = day.weekday ? dates.find((d) => isoWeekday(d) === day.weekday) : undefined;
    const time = date && open(day, date);
    if (date && time) place(day, date, time);
    else rest.push(day);
  }

  let last = "";
  for (const day of rest) {
    const adjacent = (d: string) => used.has(addDays(d, -1)) || used.has(addDays(d, 1));
    const best = dates
      .map((date) => ({ date, time: open(day, date) }))
      .filter((c): c is { date: string; time: string } => c.time !== null)
      .sort((a, b) => Number(adjacent(a.date)) - Number(adjacent(b.date)) || Number(a.date <= last) - Number(b.date <= last) || a.date.localeCompare(b.date))[0];
    if (best) {
      place(day, best.date, best.time);
      last = best.date;
    } else {
      result.unplaced.push({ dayId: day.id, name: day.name, reason: severeReason.get(day.id) ?? "No queda un día libre con hueco en este rango" });
    }
  }
  result.placements.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

/** Why a planned session can no longer happen as planned, and whether moving it helps. */
export function conflictOf(session: { date: string; time: string; durationMin: number }, day: PlanDay | undefined, ctx: Context): { reason: string; movable: boolean } | null {
  const blocked = dayBlock(session.date, ctx);
  if (blocked) return { reason: blocked, movable: true };
  const start = minutes(session.time);
  const clash = ctx.busy.find(
    (o) => o.date === session.date && !o.allDay && o.start && o.end && overlaps(start, start + session.durationMin, minutes(o.start), minutes(o.end)),
  );
  if (clash) return { reason: `Choca con ${clash.title} (${clash.start}–${clash.end})`, movable: true };
  const severe = day && injuryImpact(day, session.date, ctx.health).severe;
  return severe ? { reason: severe, movable: false } : null;
}

/** The nearest date (same day first, then ±1…±3) and time a clashing session can move to, or null. */
export function findSlot(session: { date: string; time: string; durationMin: number }, ctx: Context, taken: Set<string>): { date: string; time: string } | null {
  for (const offset of [0, 1, -1, 2, -2, 3, -3]) {
    const date = addDays(session.date, offset);
    if (date < ctx.today || dayBlock(date, ctx)) continue;
    if (offset !== 0 && (taken.has(date) || ctx.prefs.restDays.includes(isoWeekday(date)))) continue;
    const time = freeTime(date, session.durationMin, ctx, session.time);
    if (time) return { date, time };
  }
  return null;
}
