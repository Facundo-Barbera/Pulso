import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { lookupBarcode, normalizeBarcode } from "./barcode";
import { dateString, mealSchema, planShape, targetsShape } from "./inputs";
import { addDays, createPlan, dailySummary, deleteMeal, getTargets, listMeals, localDate, logMeals, planForDay, setTargets } from "./store";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

export const nutritionTools = [
  tool(
    "log_meal",
    "Log one or more foods the person ate. Each item's macros are TOTALS for the quantity eaten (not per 100 g): kcal for energy, grams for protein/carbs/fat/fiber. Estimate them when the person doesn't give them. Use for anything eaten; returns the stored entries with their ids.",
    { items: z.array(mealSchema).min(1).max(30).describe("Foods to log; items of one meal share a slot") },
    async ({ items }) => json(logMeals(items, "agent")),
  ),
  tool(
    "delete_meal",
    "Delete a logged food entry by id (from list_meals or log_meal), e.g. to fix a wrong log.",
    { id: z.string() },
    async ({ id }) => (deleteMeal(id) ? json({ deleted: id }) : fail(`No meal entry ${id}`)),
  ),
  tool(
    "list_meals",
    "Logged food entries between two local days (YYYY-MM-DD, inclusive), oldest first. Macros are totals per entry: kcal and grams. Defaults to today. Max 62 days.",
    { from: dateString.optional(), to: dateString.optional() },
    async ({ from, to }) => {
      const start = from ?? localDate();
      const end = to ?? (from ? start : localDate());
      if (end < start || end > addDays(start, 61)) return fail("Range must be 1 to 62 days with from <= to");
      return json(listMeals(start, end));
    },
  ),
  tool(
    "daily_summary",
    "Totals eaten on a local day versus the daily targets: totals, targets, remaining (targets minus totals; negative means over) and per-slot totals. kcal and grams. Defaults to today. Use before suggesting what to eat next.",
    { date: dateString.optional() },
    async ({ date }) => json(dailySummary(date ?? localDate())),
  ),
  tool(
    "get_targets",
    "The person's daily nutrition targets: kcal and grams of protein, carbs, fat and fiber. null if never set.",
    {},
    async () => json(getTargets()),
  ),
  tool(
    "set_targets",
    "Replace the daily nutrition targets (kcal; grams of protein, carbs, fat, fiber). Set them when you design or adjust a diet; the Dieta tab's rings and adherence use them.",
    targetsShape,
    async (targets) => json(setTargets(targets)),
  ),
  tool(
    "create_diet_plan",
    "Create a complete diet plan in one call: days → meals (by slot) → items with quantity and the macros for that quantity (kcal, grams). Days repeat cyclically from startsOn. By default it becomes the active plan, replacing the previous one. Item macros should add up close to the daily targets; call set_targets too if they change.",
    planShape,
    async (plan) => json(createPlan(plan)),
  ),
  tool(
    "get_active_plan",
    "The active diet plan, plus which plan day applies on the given local day (default today) and which of its items are already logged as eaten. null if there is no active plan.",
    { date: dateString.optional() },
    async ({ date }) => json(planForDay(date ?? localDate())),
  ),
  tool(
    "lookup_food_barcode",
    "Look up a packaged food by its EAN/UPC barcode in Open Food Facts. Returns name, brand, macros per 100 g (kcal, grams) and serving size in grams, or null if unknown. Scale per100g by grams/100 before logging.",
    { barcode: z.string().describe("8 to 14 digits") },
    async ({ barcode }) => {
      const code = normalizeBarcode(barcode);
      if (!code) return fail("Barcode must be 8 to 14 digits");
      try {
        return json(await lookupBarcode(code));
      } catch (error) {
        return fail(`Open Food Facts unavailable: ${(error as Error).message}`);
      }
    },
  ),
];
