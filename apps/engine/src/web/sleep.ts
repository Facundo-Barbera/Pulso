/**
 * What the web app's Sueño page draws: one night in full (the newest, or the
 * one asked for), the nights either side of it, the 14-night summary and a
 * 30-day trend. Read-only, from the sleep store.
 */
import type { SleepNight, SleepSummary } from "@pulso/contract";
import { addDays } from "../daily/dates";
import { sleepOverview } from "../sleep/store";

export type SleepTrendPoint = {
  /** Local date of waking up. */
  night: string;
  asleepMin: number | null;
  score: number | null;
};

export type SleepPage = {
  targetMin: number;
  /** The night shown in full; null when there is no sleep at all. */
  night: SleepNight | null;
  /** Adjacent nights with data, for the ‹ › links. */
  newer: string | null;
  older: string | null;
  /** The 14 nights ending at the newest. */
  summary: SleepSummary;
  /** `TREND_NIGHTS` calendar days ending at the newest night, oldest first; nulls where nothing was recorded. */
  trend: SleepTrendPoint[];
};

export const TREND_NIGHTS = 30;
/** How far back the ‹ links reach. */
const BROWSE_NIGHTS = 60;

export function sleepPage(selected?: string | null): SleepPage {
  const { targetMin, nights, summary } = sleepOverview(BROWSE_NIGHTS);
  const index = Math.max(0, nights.findIndex((n) => n.night === selected));
  const newest = nights[0];
  const byNight = new Map(nights.map((n) => [n.night, n]));
  const trend = newest
    ? Array.from({ length: TREND_NIGHTS }, (_, i) => {
        const night = addDays(newest.night, i - TREND_NIGHTS + 1);
        const n = byNight.get(night);
        return { night, asleepMin: n?.minutes.asleep ?? null, score: n?.score.value ?? null };
      })
    : [];
  return {
    targetMin,
    night: nights[index] ?? null,
    newer: nights[index - 1]?.night ?? null,
    older: nights[index + 1]?.night ?? null,
    summary,
    trend,
  };
}
