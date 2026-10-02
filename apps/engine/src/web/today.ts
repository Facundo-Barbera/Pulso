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
import { listSleepNights, sleepSummary } from "../sleep/store";
import { volumeOf } from "../training/segments";
import { listSessions } from "../training/store";
import { listWorkouts } from "../workouts";

export type RecentActivity = {
  id: string;
  kind: "session" | "workout";
  /** Spanish, ready to show */
  title: string;
  startedAt: number;
  endedAt: number;
  /** Spanish, e.g. "18 series · 6.240 kg" */
  detail: string | null;
};

export type TodayOverview = {
  date: string;
  readiness: Readiness;
  /** today's row, if the phone synced one */
  today: DailyMetrics | null;
  /**
   * The last `TREND_DAYS` days, oldest first, one entry per day (null when nothing synced).
   * `sleepMin` is minutes asleep the night ending that day: the sleep store's night when there is
   * one (what the Sueño card and page show), else the phone's daily sum. Every sleep figure on Hoy reads it.
   */
  trend: { date: string; metrics: DailyMetrics | null; sleepMin: number | null }[];
  /** the newest night, if it ended today or yesterday */
  lastNight: SleepNight | null;
  sleep: SleepSummary;
  brief: CoachBrief | null;
  medication: MedicationDay;
  recent: RecentActivity[];
};

export const TREND_DAYS = 14;
const RECENT = 5;

const ACTIVITY_ES: Record<string, string> = {
  running: "Carrera",
  walking: "Caminata",
  hiking: "Senderismo",
  cycling: "Ciclismo",
  swimming: "Natación",
  strength: "Fuerza",
  functional_strength: "Fuerza funcional",
  hiit: "HIIT",
  yoga: "Yoga",
  rowing: "Remo",
  elliptical: "Elíptica",
  core: "Core",
  flexibility: "Flexibilidad",
  cross_training: "Entrenamiento cruzado",
  soccer: "Fútbol",
};

export const activityLabel = (activity: string) => ACTIVITY_ES[activity] ?? "Entrenamiento";

const number = new Intl.NumberFormat("es");

export function recentActivity(limit = RECENT): RecentActivity[] {
  const sessions: RecentActivity[] = listSessions(limit).map((s) => {
    const volume = s.sets.reduce((sum, set) => sum + volumeOf(set), 0);
    const parts = [`${s.sets.length} ${s.sets.length === 1 ? "serie" : "series"}`, volume > 0 ? `${number.format(Math.round(volume))} kg` : null];
    return { id: s.id, kind: "session", title: s.name, startedAt: s.startedAt, endedAt: s.endedAt, detail: parts.filter(Boolean).join(" · ") };
  });
  const workouts: RecentActivity[] = listWorkouts(limit).map((w) => {
    const parts = [w.energy != null ? `${Math.round(w.energy)} kcal` : null, w.distance != null && w.distance > 0 ? `${number.format(Math.round(w.distance / 10) / 100)} km` : null];
    return { id: w.id, kind: "workout", title: activityLabel(w.activity), startedAt: w.startedAt, endedAt: w.endedAt, detail: parts.filter(Boolean).join(" · ") || null };
  });
  return [...sessions, ...workouts].sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}

export function todayOverview(now = new Date()): TodayOverview {
  const date = localDate(now);
  const from = addDays(date, -(TREND_DAYS - 1));
  const byDate = new Map(listDailyMetrics(from, date).map((d) => [d.date, d]));
  // This window's own nights, not the overview's (which ends at the newest night stored, wherever that is).
  const windowNights = listSleepNights(from, date);
  const nights = new Map(windowNights.map((n) => [n.night, n.minutes.asleep]));
  const trend = Array.from({ length: TREND_DAYS }, (_, i) => {
    const day = addDays(from, i);
    const metrics = byDate.get(day) ?? null;
    return { date: day, metrics, sleepMin: nights.get(day) ?? metrics?.sleepMinutes ?? null };
  });
  // Nights come newest first, keyed by the morning they end on; show it only while it is still "last night".
  const newest = windowNights[0] ?? null;
  const lastNight = newest && newest.night >= addDays(date, -1) ? newest : null;
  const { time } = localNow(now);
  return {
    date,
    readiness: readinessFor(date),
    today: byDate.get(date) ?? null,
    trend,
    lastNight,
    sleep: sleepSummary(TREND_DAYS),
    brief: latestBrief("daily"),
    medication: medicationDay(date, time),
    recent: recentActivity(),
  };
}
