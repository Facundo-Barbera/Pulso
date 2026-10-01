import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { setSleepTargetMin, sleepSummary, listSleepNights } from "./store";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

export const sleepTools = [
  tool(
    "get_sleep_nights",
    "Nights of sleep from Apple Health between two dates (inclusive, YYYY-MM-DD; a night is named after the local date the person woke up), newest first. " +
      "Per night: in-bed and asleep start/end (epoch ms), minutes per stage (core, deep, rem, awake, unspecified), efficiency (asleep/in bed, 0–1), " +
      "stage shares (0–1), bedtimeMin/wakeMin (minutes from local midnight of that date, negative = the evening before), a 0–100 sleep score with its factors and a Spanish explanation, " +
      "and Spanish insights vs. the previous 14 nights. Use it to relate a specific night's sleep to training, diet or how the person feels. Set includeSegments for the raw stage timeline.",
    { from: date, to: date, includeSegments: z.boolean().default(false) },
    async ({ from, to, includeSegments }) =>
      text(listSleepNights(from, to).map(({ segments, ...night }) => (includeSegments ? { ...night, segments } : night))),
  ),
  tool(
    "get_sleep_summary",
    "Sleep summary over the last `days` days that have data: average minutes asleep, average score (0–100) and efficiency (0–1), average bedtime/wake " +
      "(minutes from local midnight, negative = before midnight) and their standard deviations in minutes, a regularity index (0–100, higher = more regular schedule), " +
      "sleep debt in minutes vs. the target (max(0, Σ(target − asleep))), the target in minutes, and Spanish insights. Use it for recovery or habit questions.",
    { days: z.number().int().min(2).max(60).default(14) },
    async ({ days }) => text(sleepSummary(days)),
  ),
  tool(
    "set_sleep_target",
    "Sets the person's nightly sleep target in hours (default 8). It drives sleep debt and the duration part of the sleep score. Only call it when the person asks to change their target.",
    { hours: z.number().min(4).max(12) },
    async ({ hours }) => text({ targetMin: setSleepTargetMin(hours * 60) }),
  ),
];
