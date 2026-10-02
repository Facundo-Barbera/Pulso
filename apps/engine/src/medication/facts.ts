/**
 * The day facts that moment-linked slots resolve against (see `resolveSlots`),
 * read from training, Health and the calendar. Read-only: nothing here writes
 * to another feature's tables.
 *
 * - A workout is a saved Pulso session or a Health workout (not a duplicate of
 *   another recording, not a walk, at least 10 minutes), dated by when it ended.
 *   A Health workout recorded during a session is that session: the session
 *   ends when the last of them does, and the workout adds no end of its own.
 * - A session is in progress when the live session started today.
 * - Planned sessions are the calendar's, still "planned" (skipped and moved ones don't wait).
 * - Meal times are the calendar's for that date; sleep time is its preference.
 */
import type { DoseMeal } from "@pulso/contract";
import { getPreferences, listPlanned, mealTimesBetween } from "../calendar/store";
import { db } from "../db";
import { attachmentsBetween } from "../workouts-merge";
import { addDays, type DayFacts, fromMinutes, localNow, toMinutes } from "./schedule";

const MIN_WORKOUT_MS = 10 * 60_000;
const MEALS: DoseMeal[] = ["desayuno", "comida", "cena"];

/** Local midnight of a "YYYY-MM-DD", as epoch ms in this process's time zone. */
const midnight = (date: string) => new Date(`${date}T00:00:00`).getTime();

/** Facts for every date in [from, to]; `today` decides whether a live session counts. */
export function dayFacts(from: string, to: string, today: string): (date: string) => DayFacts {
  const startMs = midnight(from);
  const endMs = midnight(addDays(to, 1));
  const ends = new Map<string, string[]>();
  const addEnd = (endedAt: number) => {
    const { date, time } = localNow(new Date(endedAt));
    ends.set(date, [...(ends.get(date) ?? []), time]);
  };
  const merged = attachmentsBetween(startMs, endMs);
  for (const s of merged.sessions) {
    const end = Math.max(s.endedAt, ...(merged.bySession.get(s.id) ?? []).map((a) => a.workout.endedAt));
    if (end >= startMs && end < endMs) addEnd(end);
  }
  for (const w of merged.workouts) {
    if (merged.sessionOf.has(w.id) || merged.hidden.has(w.id)) continue;
    if (w.endedAt >= startMs && w.endedAt < endMs && w.endedAt - w.startedAt >= MIN_WORKOUT_MS && w.activity !== "walking") addEnd(w.endedAt);
  }

  const liveRow = db().query<{ data: string }, []>("SELECT data FROM live_sessions ORDER BY updated_at DESC LIMIT 1").get();
  const liveStart = liveRow ? (JSON.parse(liveRow.data) as { startedAt?: number }).startedAt : undefined;
  const liveToday = liveStart !== undefined && localNow(new Date(liveStart)).date === today;

  const planned = new Map<string, DayFacts["planned"]>();
  for (const p of listPlanned(from, to)) {
    if (p.status !== "planned") continue;
    planned.set(p.date, [...(planned.get(p.date) ?? []), { start: p.time, end: fromMinutes(toMinutes(p.time) + p.durationMin) }]);
  }

  const meals = mealTimesBetween(from, to);
  const { sleepTime } = getPreferences();

  return (date) => ({
    workoutEnds: ends.get(date) ?? [],
    live: liveToday && date === today,
    planned: planned.get(date) ?? [],
    meals: Object.fromEntries((meals[date] ?? []).filter((m) => (MEALS as string[]).includes(m.slot)).map((m) => [m.slot, m.time])),
    sleepTime,
  });
}
