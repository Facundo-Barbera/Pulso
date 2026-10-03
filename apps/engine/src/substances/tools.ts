import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { addDays, localNow } from "../medication/schedule";
import { AMOUNTS, CONTEXTS, createSubstance, deleteUse, listSubstances, listUses, logUse, resolveSubstance, updateSubstance } from "./store";
import { substanceSummary } from "./summary";

/** Said once in every tool so the model keeps the tone wherever it starts. */
const TONE = "Private log (harm reduction): neutral and factual, never lecture or push them to quit; raise it only when they do or it bears on what they asked.";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

async function safely(run: () => unknown) {
  try {
    return json(await run());
  } catch (error) {
    return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
}

const SUBSTANCE = z.string().min(1).describe("Name or id (list_substances).");

export const substanceTools = [
  tool(
    "list_substances",
    `Tracked substances (Cannabis and Alcohol built in): id, name, unit (what quantity counts), forms, their weekly goal (maxDaysPerWeek), archived. ${TONE}`,
    {},
    async () => safely(() => ({ substances: listSubstances() })),
  ),
  tool(
    "log_substance_use",
    `Record one use they tell you about ("anoche fumé"). An untracked substance: ask whether to create it (create_substance), don't guess. ` +
      `date 'YYYY-MM-DD' and time 'HH:MM' local, both omitted = now. form: one of its forms (default the first). quantity in its unit, when they count. context dormir = para dormir. ` +
      `Alcohol for the diet still goes to log_meal; this only records the occasion. ${TONE}`,
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
    `Logged uses between local dates (default the last 30 days), newest first: id, substanceId, date, time, form, amount, quantity, thcMg, context, note. ${TONE}`,
    {
      from: z.string().optional().describe("YYYY-MM-DD"),
      to: z.string().optional().describe("YYYY-MM-DD"),
      substance: SUBSTANCE.optional().describe("Default all."),
    },
    async ({ from, to, substance }) =>
      safely(() => {
        const today = localNow().date;
        return { uses: listUses(from ?? addDays(today, -29), to ?? today, substance ? [resolveSubstance(substance).id] : undefined) };
      }),
  ),
  tool(
    "substance_summary",
    `How often and when over the last 8 weeks, for one substance or all together: daily heatmap, days per week, daysWithout and the longest run, time of day, forms, contexts, their weekly goal, ` +
      `and comparisons of nights with and without use (sleep minutes and score, next-morning HRV and resting HR, next-day readiness, eating after 22:00) with sample sizes: cite only enough=true ones, as averages from their data, not causes. ` +
      `A night with use = a use from noon to 05:59. Alcohol's drinkDays counts days with alcoholic drinks logged as meals. ${TONE}`,
    { substance: SUBSTANCE.optional().describe("Default all active ones together.") },
    async ({ substance }) => safely(() => substanceSummary(substance ? resolveSubstance(substance).id : null)),
  ),
  tool(
    "delete_substance_use",
    `Delete one logged use by id (list_substance_use). ${TONE}`,
    { id: z.string() },
    async ({ id }) =>
      safely(() => {
        deleteUse(id);
        return { deleted: id };
      }),
  ),
  tool(
    "create_substance",
    `Add a substance to track, ONLY when the person asks. unit for quantity (sesiones, mg, tragos…; default veces); forms in order (fumado, vapeado); symbol an emoji. ${TONE}`,
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
    `Set their own weekly limit for a substance ("máximo 2 días por semana") ONLY when they ask; never propose one. null removes it. ${TONE}`,
    { substance: SUBSTANCE.default("Cannabis"), maxDaysPerWeek: z.number().int().min(0).max(7).nullable() },
    async ({ substance, maxDaysPerWeek }) => safely(() => updateSubstance(resolveSubstance(substance).id, { maxDaysPerWeek })),
  ),
];
