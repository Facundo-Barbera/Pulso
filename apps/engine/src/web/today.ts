/**
 * What the web app's Hoy page draws, assembled from the feature stores in one
 * call. Read-only: the page and `GET /api/web/hoy` both use it, so the
 * server component and any client refresh see the same shape.
 */
import type { CoachBrief, DailyMetrics, MedicationDay, Readiness, SleepNight, SleepSummary } from "@pulso/contract";
import { latestBrief } from "../coach/store";
import { addDays, localDate } from "../daily/dates";
import { listDailyMetrics, readinessFor } from "../daily/store";
import { localNow } from "../medication/schedule";
import { medicationDay } from "../medication/store";
import { sleepOverview } from "../sleep/store";
import { recentActivity as mergedActivity } from "../workouts-merge";

export type RecentActivity = {
  id: string;
  kind: "session" | "workout";
  /** Spanish, ready to show */
  title: string;
  startedAt: number;
  endedAt: number;
  /** Spanish, e.g. "18 series · 6.240 kg" */
  detail: string | null;
  /** a session with Apple Watch workouts merged in */
  merged: boolean;
};

export type TodayOverview = {
  date: string;
  readiness: Readiness;
  /** today's row, if the phone synced one */
  today: DailyMetrics | null;
  /** the last `TREND_DAYS` days, oldest first, one entry per day (null when nothing synced) */
  trend: { date: string; metrics: DailyMetrics | null }[];
  /** the newest night, if it ended today or yesterday */
  lastNight: SleepNight | null;
  sleep: SleepSummary;
  brief: CoachBrief | null;
  medication: MedicationDay;
  recent: RecentActivity[];
};

export const TREND_DAYS = 14;
const RECENT = 5;

export { activityLabel } from "../workouts-merge";

const number = new Intl.NumberFormat("es");

/** Sessions (with what the Watch recorded during them merged in) and Health workouts on their own: each workout once. */
export function recentActivity(limit = RECENT): RecentActivity[] {
  return mergedActivity(limit).map((a) => {
    const parts =
      a.kind === "session"
        ? [`${a.sets} ${a.sets === 1 ? "serie" : "series"}`, a.volumeKg ? `${number.format(a.volumeKg)} kg` : null, a.merged && a.energy != null ? `${Math.round(a.energy)} kcal` : null]
        : [a.energy != null ? `${Math.round(a.energy)} kcal` : null, a.distance != null ? `${number.format(Math.round(a.distance / 10) / 100)} km` : null];
    return { id: a.id, kind: a.kind, title: a.title, startedAt: a.startedAt, endedAt: a.endedAt, detail: parts.filter(Boolean).join(" · ") || null, merged: a.merged };
  });
}

export function todayOverview(now = new Date()): TodayOverview {
  const date = localDate(now);
  const from = addDays(date, -(TREND_DAYS - 1));
  const byDate = new Map(listDailyMetrics(from, date).map((d) => [d.date, d]));
  const trend = Array.from({ length: TREND_DAYS }, (_, i) => {
    const day = addDays(from, i);
    return { date: day, metrics: byDate.get(day) ?? null };
  });
  const sleep = sleepOverview(TREND_DAYS);
  // Nights come newest first, keyed by the morning they end on; show it only while it is still "last night".
  const newest = sleep.nights[0] ?? null;
  const lastNight = newest && newest.night >= addDays(date, -1) ? newest : null;
  const { time } = localNow(now);
  return {
    date,
    readiness: readinessFor(date),
    today: byDate.get(date) ?? null,
    trend,
    lastNight,
    sleep: sleep.summary,
    brief: latestBrief("daily"),
    medication: medicationDay(date, time),
    recent: recentActivity(),
  };
}
