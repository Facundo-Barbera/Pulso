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
    "Nights of sleep from–to (inclusive; a night is named after the local date they woke), newest first: in-bed and asleep start/end (epoch ms), minutes per stage, efficiency and stage shares (0–1), " +
      "bedtimeMin/wakeMin (minutes from that date's local midnight, negative = the evening before), a 0–100 score with factors and a Spanish explanation, Spanish insights vs the previous 14 nights. " +
      "A night logged by hand has sourceKind \"manual\", `manual` {id, note}, one asleep span, no stages.",
    { from: date, to: date, includeSegments: z.boolean().default(false).describe("The raw stage timeline.") },
    async ({ from, to, includeSegments }) =>
      text(listSleepNights(from, to).map(({ segments, ...night }) => (includeSegments ? { ...night, segments } : night))),
  ),
  tool(
    "get_sleep_summary",
    "Sleep over the last `days` days with data: average minutes asleep, score (0–100), efficiency (0–1), bedtime/wake (minutes from local midnight, negative = before) with standard deviations, " +
      "regularity (0–100, higher = more regular), sleep debt in minutes (Σ max(0, target − asleep)), the target, Spanish insights.",
    { days: z.number().int().min(2).max(60).default(14) },
    async ({ days }) => text(sleepSummary(days)),
  ),
  tool(
    "set_sleep_target",
    "Set the nightly sleep target in hours (default 8); it drives sleep debt and the score's duration part. Only when the person asks.",
    { hours: z.number().min(4).max(12) },
    async ({ hours }) => text({ targetMin: setSleepTargetMin(hours * 60) }),
  ),
  tool(
    "log_sleep",
    "Log a night Apple Health didn't record, by the person's local clock. A bedtime later than the wake time is the previous day (23:30 → 07:00). " +
      "Must last 1–16 h, not in the future. Refused when Apple Health measured that night (it always counts) or one was already logged by hand (update_sleep_night). " +
      "It then counts like any night (Sueño, Hoy, readiness, the brief). Returns the night with id and durationMin.",
    {
      asleepTime: clock.describe("Fell asleep (or went to bed, if that's all they say)"),
      wakeTime: clock.optional().describe("Omit when they woke just now; ask if unsaid and not now"),
      wakeDate: date.optional().describe("Only for a night other than last night"),
      note: z.string().max(280).optional().describe("Their words"),
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
    "Correct a night logged by hand, by id or night (the date they woke); Apple Health nights can't be edited. Give only what changes, times local 'HH:MM': a new wakeTime keeps the wake day, a new asleepTime is its last occurrence before waking, note replaces ('' clears). Limits as log_sleep.",
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
    "Delete a night logged by hand, by id or night (the date they woke); Apple Health nights can't be deleted. Returns it.",
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

