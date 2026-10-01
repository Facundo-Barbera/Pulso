import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { addDays, isDate, localDate } from "./dates";
import { listDailyMetrics, readinessFor } from "./store";

const date = z.string().refine(isDate, "expected YYYY-MM-DD");
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

export const dailyTools = [
  tool(
    "get_daily_metrics",
    "Per-day Apple Health signals for a date range (inclusive, local dates YYYY-MM-DD, max 90 days; defaults to the last 7 days). " +
      "Each day: steps; activeEnergy kcal; exerciseMinutes min; restingHeartRate bpm; hrv ms (SDNN); " +
      "sleepMinutes, sleepDeep, sleepCore, sleepRem, sleepAwake in minutes (sleep is the night that ENDED on that date); " +
      "vo2max mL/kg/min; respiratoryRate breaths/min. Any field may be null when not measured. Days with no data are omitted. " +
      "restingHeartRateEstimated / exerciseMinutesEstimated are true when Health had no value and the phone estimated it " +
      "(lowest overnight heart rate; summed workout minutes), so treat those as approximate. " +
      "Use for trends in activity, sleep or recovery signals.",
    { from: date.optional(), to: date.optional() },
    async ({ from, to }) => {
      const end = to ?? localDate();
      const start = from ?? addDays(end, -6);
      if (start > end) return { ...text({ error: "from is after to" }), isError: true };
      if (start < addDays(end, -89)) return { ...text({ error: "range is longer than 90 days" }), isError: true };
      return text(listDailyMetrics(start, end));
    },
  ),
  tool(
    "get_readiness",
    "Recovery/readiness score 0–100 for a local date (YYYY-MM-DD, defaults to today), with level (high ≥75, medium ≥50, low) " +
      "and its factors: HRV (ms) and resting heart rate (bpm) compared with the person's 28-day baseline, and last night's sleep " +
      "(minutes vs. an 8 h target). Score is null when there is no data. Includes a one-line Spanish explanation. " +
      "Use before suggesting how hard to train today or when the person asks how recovered they are.",
    { date: date.optional() },
    async ({ date }) => text(readinessFor(date ?? localDate())),
  ),
];
