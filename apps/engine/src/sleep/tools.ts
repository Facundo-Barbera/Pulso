import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ManualSleepNight } from "@pulso/contract";
import { localDate } from "../daily/dates";
import { CLOCK, lastBefore, resolveNight, wakeAt } from "./clock";
import { addManualNight, deleteManualNight, getManualNight, manualNightOn, updateManualNight } from "./manual";
import { setSleepTargetMin, sleepSummary, listSleepNights } from "./store";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const clock = z.string().regex(CLOCK, "HH:MM, 24 h");
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const fail = (error: unknown) => ({ content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true });

/** What the model reads back: the stored night plus its length. */
const shown = (n: ManualSleepNight) => ({ ...n, durationMin: Math.round((n.end - n.start) / 60_000) });

function find({ id, night }: { id?: string; night?: string }): ManualSleepNight {
  if (id) return getManualNight(id);
  const found = night ? manualNightOn(night) : undefined;
  if (!found) throw new Error(`No night logged by hand on ${night ?? "that date"}. Nights measured by Apple Health can't be edited or deleted here.`);
  return found;
}

export const sleepTools = [
  tool(
    "get_sleep_nights",
    "Nights of sleep between two dates (inclusive, YYYY-MM-DD; a night is named after the local date the person woke up), newest first. " +
      "Per night: in-bed and asleep start/end (epoch ms), minutes per stage (core, deep, rem, awake, unspecified), efficiency (asleep/in bed, 0–1), " +
      "stage shares (0–1), bedtimeMin/wakeMin (minutes from local midnight of that date, negative = the evening before), a 0–100 sleep score with its factors and a Spanish explanation, " +
      "and Spanish insights vs. the previous 14 nights. " +
      "Nights come from Apple Health; one the person logged by hand has sourceKind \"manual\", a `manual` {id, note}, a single asleep span, no stages and no efficiency factor. Use it to relate a specific night's sleep to training, diet or how the person feels. Set includeSegments for the raw stage timeline.",
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
  tool(
    "log_sleep",
    "Logs a night of sleep by hand, for nights Apple Health didn't record (the watch was off or not worn). Times are the person's local clock, 24 h \"HH:MM\". " +
      "asleepTime is when they fell asleep (or went to bed, if that's all they say). wakeTime is when they woke up; leave it out when they woke just now " +
      "(\"me acabo de levantar\" = now). If they didn't say when they woke and it isn't clearly now, ask before logging. " +
      "A bedtime later on the clock than the wake time is the previous day (23:30 → 07:00 is one night). wakeDate (YYYY-MM-DD, local) only for a night other than last night. " +
      "The night is named after the morning they woke, must last 1–16 h and can't be in the future. It is refused when Apple Health already measured that night " +
      "(the measured one always counts) or when one was already logged by hand (use update_sleep_night). " +
      "Once logged it counts like any night: Sueño, last night's sleep on Hoy, readiness and the morning brief. Returns the night with its id and durationMin.",
    {
      asleepTime: clock.describe("Fell asleep, local HH:MM"),
      wakeTime: clock.optional().describe("Woke up, local HH:MM; omit for now"),
      wakeDate: date.optional().describe("Local date they woke up; omit for today"),
      note: z.string().max(280).optional().describe("Optional, in their words (e.g. \"sin reloj\")"),
    },
    async ({ asleepTime, wakeTime, wakeDate, note }) => {
      try {
        return text(shown(addManualNight({ ...resolveNight({ asleepTime, wakeTime, wakeDate }, Date.now()), note })));
      } catch (error) {
        return fail(error);
      }
    },
  ),
  tool(
    "update_sleep_night",
    "Corrects a night logged by hand (log_sleep). Find it by id or by night (YYYY-MM-DD, the morning they woke). Measured Apple Health nights can't be edited. " +
      "asleepTime / wakeTime are local \"HH:MM\" (24 h); give only what changes. A new wakeTime keeps the night's wake day; a new asleepTime is taken as the last time the clock read it before waking. " +
      "note replaces the note (empty string clears it). Same limits as log_sleep: 1–16 h, not in the future.",
    {
      id: z.string().optional(),
      night: date.optional(),
      asleepTime: clock.optional(),
      wakeTime: clock.optional(),
      note: z.string().max(280).optional(),
    },
    async ({ id, night, asleepTime, wakeTime, note }) => {
      try {
        const current = find({ id, night });
        const end = wakeTime ? wakeAt(wakeTime, localDate(new Date(current.end)), Date.now()) : current.end;
        const start = asleepTime ? lastBefore(end, asleepTime) : current.start;
        return text(shown(updateManualNight(current.id, { start, end, ...(note === undefined ? {} : { note: note || null }) })));
      } catch (error) {
        return fail(error);
      }
    },
  ),
  tool(
    "delete_sleep_night",
    "Deletes a night logged by hand (by id, or night = YYYY-MM-DD, the morning they woke), e.g. when it was logged by mistake. Measured Apple Health nights can't be deleted. Returns the deleted night.",
    { id: z.string().optional(), night: date.optional() },
    async ({ id, night }) => {
      try {
        return text(shown(deleteManualNight(find({ id, night }).id)));
      } catch (error) {
        return fail(error);
      }
    },
  ),
];

