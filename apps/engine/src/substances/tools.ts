import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { addDays, localNow } from "../medication/schedule";
import { AMOUNTS, CONTEXTS, createSubstance, deleteUse, listSubstances, listUses, logUse, resolveSubstance, updateSubstance } from "./store";
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

const SUBSTANCE = z.string().min(1).describe("The substance's name (e.g. 'Cannabis', 'Alcohol') or id, from list_substances.");

export const substanceTools = [
  tool(
    "list_substances",
    `The substances the person tracks: id, name, unit (what quantity counts), forms (how it can be taken), their own weekly goal (maxDaysPerWeek) and archived. ` +
      `Cannabis and Alcohol come built in; the rest are theirs. ${TONE}`,
    {},
    async () => safely(() => ({ substances: listSubstances() })),
  ),
  tool(
    "log_substance_use",
    `Records one use the person tells you about ("anoche fumé", "me tomé dos cervezas en una fiesta"). substance: name or id (default Cannabis); ` +
      `if they name one they don't track, ask whether to create it (create_substance) instead of guessing. ` +
      `date 'YYYY-MM-DD' and time 'HH:MM' are local; omit both for now. form: one of that substance's forms (default its first). ` +
      `amount in their own terms: poco, normal (default), mucho; quantity in the substance's unit when they count it; thcMg for cannabis edibles when they know it. ` +
      `context: social, solo, dormir (para dormir), estres, otro. note: their words. Alcoholic drinks they want counted in their diet still go to log_meal; ` +
      `this only records the occasion. Confirm in one short line, without commentary. ${TONE}`,
    {
      substance: SUBSTANCE.default("Cannabis"),
      date: z.string().optional(),
      time: z.string().optional(),
      form: z.string().optional(),
      amount: z.enum(AMOUNTS).default("normal"),
      quantity: z.number().positive().optional(),
      thcMg: z.number().positive().optional(),
      context: z.enum(CONTEXTS).optional(),
      note: z.string().optional(),
    },
    async ({ substance, ...input }) => safely(() => logUse({ ...input, substanceId: resolveSubstance(substance).id })),
  ),
  tool(
    "list_substance_use",
    `The logged uses between two local dates (default the last 30 days), newest first: id, substanceId, date, time, form, amount, quantity, thcMg, context, note. ${TONE}`,
    {
      from: z.string().optional().describe("YYYY-MM-DD, default 30 days ago."),
      to: z.string().optional().describe("YYYY-MM-DD, default today."),
      substance: SUBSTANCE.optional().describe("Only this substance; default all."),
    },
    async ({ from, to, substance }) =>
      safely(() => {
        const today = localNow().date;
        return { uses: listUses(from ?? addDays(today, -29), to ?? today, substance ? [resolveSubstance(substance).id] : undefined) };
      }),
  ),
  tool(
    "substance_summary",
    `How often and when, over the last 8 weeks, for one substance or all of them together (omit substance): per-day heatmap, days per week, days without use so far (daysWithout) and the longest run, ` +
      `time of day, forms and contexts, the substance's own weekly goal if they set one, and soft comparisons of nights with and without use (sleep minutes and score, next-morning HRV and resting HR, next-day readiness, eating after 22:00), ` +
      `each with sample sizes; only cite those with enough=true and say they are averages from their own data, not causes. ` +
      `A night with use = a use from noon to 05:59 the next morning. For Alcohol, drinkDays counts days with alcoholic drinks logged as meals. ${TONE}`,
    { substance: SUBSTANCE.optional().describe("Default: all active substances together.") },
    async ({ substance }) => safely(() => substanceSummary(substance ? resolveSubstance(substance).id : null)),
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
    "create_substance",
    `Adds a substance to track, ONLY when the person asks you to ("empieza a registrar el tabaco"). name; unit for quantity (sesiones, mg, ml, unidades, tragos…; default veces); ` +
      `optional forms in order (e.g. fumado, vapeado); optional symbol (an emoji). ${TONE}`,
    {
      name: z.string().min(1).max(40),
      unit: z.string().min(1).max(20).optional(),
      forms: z.array(z.string().min(1).max(24)).max(8).optional(),
      symbol: z.string().max(40).optional(),
    },
    async (input) => safely(() => createSubstance(input)),
  ),
  tool(
    "set_substance_goal",
    `Sets the person's own weekly limit for one substance ("máximo 2 días por semana de cannabis") ONLY when they ask for it; never propose or impose one. maxDaysPerWeek 0–7, null removes it. ${TONE}`,
    { substance: SUBSTANCE.default("Cannabis"), maxDaysPerWeek: z.number().int().min(0).max(7).nullable() },
    async ({ substance, maxDaysPerWeek }) => safely(() => updateSubstance(resolveSubstance(substance).id, { maxDaysPerWeek })),
  ),
];
