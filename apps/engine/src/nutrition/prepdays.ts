/**
 * Which days of the coming week have room to cook a batch, read from the
 * calendar (busy blocks, planned training, bedtime). The Coach proposes the
 * prep days from this; nothing here decides them.
 */
import type { PlanSlot } from "@pulso/contract";
import { contextFor } from "../calendar/schedule";
import { listPlanned } from "../calendar/store";
import { clock, isoWeekday, minutes } from "../calendar/time";
import { addDays, localDate } from "./dates";
import { requirePlan, slotViews } from "./horizon";
import { listRecipes } from "./recipes";
import { materializeRange, slotRows } from "./slots";
import { dayName } from "./ops";

/** Cooking happens from the afternoon until an hour before bed. */
const WINDOW_START = 16 * 60;

export type PrepDay = {
  date: string;
  weekday: string;
  /** Free minutes between 16:00 and an hour before bed. */
  freeMinutes: number;
  /** The longest free stretch in that window, "HH:MM–HH:MM", or null. */
  bestWindow: string | null;
  busy: string[];
  training: string[];
  /** Planned meals that day needing more than 15 min of cooking. */
  cookingMinutes: number;
  weekend: boolean;
  /** Higher is better: free time, weekends, few cooking meals of its own. */
  score: number;
};

export type PrepDaysView = {
  from: string;
  to: string;
  days: PrepDay[];
  /** Meals in the range that need cooking on a day with little free time: candidates for a batch portion. */
  tightMeals: PlanSlot[];
  batchRecipes: { id: string; name: string; servings: number; prepMinutes: number }[];
};

export function suggestPrepDays(from = localDate(), days = 7): PrepDaysView {
  const plan = requirePlan();
  const to = addDays(from, days - 1);
  materializeRange(plan, from, to);
  const ctx = contextFor(from, to);
  const sessions = listPlanned(from, to).filter((s) => s.status === "planned");
  const end = Math.max(WINDOW_START + 60, minutes(ctx.prefs.sleepTime) - 60);
  const out: PrepDay[] = [];
  const slotsByDate = new Map<string, PlanSlot[]>();
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const busy = ctx.busy.filter((o) => o.date === date);
    const training = sessions.filter((s) => s.date === date);
    const blocked: [number, number][] = [
      ...busy.filter((o) => !o.allDay && o.start && o.end).map((o): [number, number] => [minutes(o.start!), minutes(o.end!)]),
      ...training.map((s): [number, number] => [minutes(s.time), minutes(s.time) + s.durationMin]),
    ];
    const allDay = busy.some((o) => o.allDay);
    // Free stretches inside the window.
    let cursor = WINDOW_START;
    let free = 0;
    let best: [number, number] | null = null;
    for (const [s, e] of blocked.filter(([s, e]) => e > WINDOW_START && s < end).sort((a, b) => a[0] - b[0])) {
      if (s > cursor) {
        free += s - cursor;
        if (!best || s - cursor > best[1] - best[0]) best = [cursor, s];
      }
      cursor = Math.max(cursor, e);
    }
    if (end > cursor) {
      free += end - cursor;
      if (!best || end - cursor > best[1] - best[0]) best = [cursor, end];
    }
    if (allDay) [free, best] = [0, null];
    const slots = slotViews(slotRows(plan.id, date));
    slotsByDate.set(date, slots);
    const cookingMinutes = slots.filter((s) => s.status === "planned" && (s.cookMinutes ?? 0) > 15).reduce((t, s) => t + (s.cookMinutes ?? 0), 0);
    const weekend = isoWeekday(date) >= 6;
    out.push({
      date,
      weekday: dayName(date),
      freeMinutes: free,
      bestWindow: best ? `${clock(best[0])}–${clock(best[1])}` : null,
      busy: busy.map((o) => o.title),
      training: training.map((s) => s.name),
      cookingMinutes,
      weekend,
      score: free + (weekend ? 60 : 0) - training.length * 30,
    });
  }
  const tightMeals = out
    .filter((d) => d.freeMinutes < 90)
    .flatMap((d) => slotsByDate.get(d.date)!.filter((s) => s.status === "planned" && (s.cookMinutes ?? 0) > 15));
  return {
    from,
    to,
    days: [...out].sort((a, b) => b.score - a.score),
    tightMeals,
    batchRecipes: listRecipes()
      .filter((r) => r.batch && r.variantOf === null)
      .map((r) => ({ id: r.id, name: r.name, servings: r.servings, prepMinutes: r.prepMinutes })),
  };
}
