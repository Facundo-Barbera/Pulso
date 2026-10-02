import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { addDays, localNow } from "../medication/schedule";
import { deleteUse, entryInputSchema, listUses, logUse, SUBSTANCES, updateSettings } from "./store";
import { substanceSummary } from "./summary";

/** Said once in every tool so the model keeps the tone wherever it starts. */
const TONE =
  "This is the person's private Sustancias log (harm reduction, self-awareness). Neutral and factual: never lecture, shame or push them to quit; " +
  "bring it up only when they do or when it clearly bears on what they asked (sleep, recovery, appetite).";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

async function safely(run: () => unknown) {
  try {
    return json(await run());
  } catch (error) {
    return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
}

export const substanceTools = [
  tool(
    "log_substance_use",
    `Records one use the person tells you about ("anoche fumé", "me tomé dos cervezas en una fiesta"). substance: cannabis (default), alcohol or nicotina. ` +
      `date 'YYYY-MM-DD' and time 'HH:MM' are local; omit both for now. form (cannabis only): fumado (default), vapeado, comestible, otro. ` +
      `amount in their own terms: poco, normal (default), mucho; count = sesiones or caladas when they count them; thcMg for edibles when they know it. ` +
      `context: social, solo, dormir (para dormir), estres, otro. note: their words. Alcoholic drinks they want counted in their diet still go to log_meal; ` +
      `this only records the occasion. Confirm in one short line, without commentary. ${TONE}`,
    entryInputSchema.shape,
    async (input) => safely(() => logUse(input)),
  ),
  tool(
    "list_substance_use",
    `The logged uses between two local dates (default the last 30 days), newest first: id, substance, date, time, form, amount, count, thcMg, context, note. ${TONE}`,
    {
      from: z.string().optional().describe("YYYY-MM-DD, default 30 days ago."),
      to: z.string().optional().describe("YYYY-MM-DD, default today."),
      substance: z.enum(SUBSTANCES).optional().describe("Only this substance; default all."),
    },
    async ({ from, to, substance }) =>
      safely(() => {
        const today = localNow().date;
        return { uses: listUses(from ?? addDays(today, -29), to ?? today, substance) };
      }),
  ),
  tool(
    "substance_summary",
    `How often and when, over the last 8 weeks: per-day heatmap, days per week, days without use so far (daysWithout) and the longest run, time of day, forms and contexts, ` +
      `their own weekly goal if they set one, and soft comparisons of nights with and without use (sleep minutes and score, next-morning HRV and resting HR, next-day readiness, eating after 22:00), ` +
      `each with sample sizes; only cite those with enough=true and say they are averages from their own data, not causes. ` +
      `A night with use = a use from noon to 05:59 the next morning. For alcohol, drinkDays counts days with alcoholic drinks logged as meals. ${TONE}`,
    { substance: z.enum(SUBSTANCES).default("cannabis") },
    async ({ substance }) => safely(() => substanceSummary(substance)),
  ),
  tool(
    "delete_substance_use",
    `Deletes one logged use by id (from list_substance_use), when the person says it was logged by mistake or twice. ${TONE}`,
    { id: z.string() },
    async ({ id }) =>
      safely(() => {
        deleteUse(id);
        return { deleted: id };
      }),
  ),
  tool(
    "set_substance_goal",
    `Sets the person's own weekly limit ("máximo 2 días por semana") ONLY when they ask for it; never propose or impose one. maxDaysPerWeek 0–7, null removes it. ${TONE}`,
    { maxDaysPerWeek: z.number().int().min(0).max(7).nullable() },
    async ({ maxDaysPerWeek }) => safely(() => updateSettings({ maxDaysPerWeek })),
  ),
];
