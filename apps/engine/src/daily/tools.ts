import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { addDays, isDate, localDate } from "./dates";
import { listDailyMetrics, readinessFor } from "./store";

const date = z.string().refine(isDate, "expected YYYY-MM-DD");
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

export const dailyTools = [
  tool(
    "get_daily_metrics",
    "Daily Apple Health signals for local dates from–to (inclusive, max 90 days; default the last 7): steps; activeEnergy kcal; exerciseMinutes; restingHeartRate bpm; hrv ms (SDNN); " +
      "sleepMinutes, sleepDeep, sleepCore, sleepRem, sleepAwake in minutes (the night that ENDED that date; sleepManual = logged by hand, no stages); vo2max mL/kg/min; respiratoryRate breaths/min. " +
      "null = not measured; days without data are omitted. restingHeartRateEstimated / exerciseMinutesEstimated = estimated by the phone, approximate.",
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
    "Readiness 0–100 for a local date (default today), level (high ≥75, medium ≥50, low), and factors: HRV (ms) and resting HR (bpm) vs their 28-day baseline, last night's sleep (minutes vs 8 h). " +
      "null score without data. With a Spanish one-line explanation. Check it before suggesting how hard to train today.",
    { date: date.optional() },
    async ({ date }) => text(readinessFor(date ?? localDate())),
  ),
];
