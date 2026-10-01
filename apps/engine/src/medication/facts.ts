/**
 * The day facts that moment-linked slots resolve against (see `resolveSlots`),
 * read from training, Health and the calendar. Read-only: nothing here writes
 * to another feature's tables.
 *
 * - A workout is a saved Pulso session or a Health workout (not a duplicate of
 *   another recording, not a walk, at least 10 minutes), dated by when it ended.
 * - A session is in progress when the live session started today.
 * - Planned sessions are the calendar's, still "planned" (skipped and moved ones don't wait).
 * - Meal times are the calendar's for that date; sleep time is its preference.
 */
import type { DoseMeal } from "@pulso/contract";
import { getPreferences, listPlanned, mealTimesBetween } from "../calendar/store";
import { db } from "../db";
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
  for (const r of db().query<{ ended_at: number }, [number, number]>("SELECT ended_at FROM training_sessions WHERE ended_at >= ? AND ended_at < ?").all(startMs, endMs)) {
    addEnd(r.ended_at);
  }
  const workouts = db()
    .query<{ ended_at: number }, [number, number, number, string]>(
      `SELECT ended_at FROM workouts WHERE duplicate_of IS NULL AND ended_at >= ? AND ended_at < ? AND ended_at - started_at >= ? AND activity <> ?`,
    )
    .all(startMs, endMs, MIN_WORKOUT_MS, "walking");
  for (const r of workouts) addEnd(r.ended_at);

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
