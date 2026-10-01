import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { MealInput } from "@pulso/contract";
import { z } from "zod";
import { adjustDayPlan } from "./adjust";
import { lookupBarcode, normalizeBarcode } from "./barcode";
import { parseTime } from "./dates";
import { dateString, mealShape, planItem, planShape, slot, targetsShape, toMealInput } from "./inputs";
import { addDays, createPlan, dailySummary, deleteMeal, getTargets, listMeals, localDate, logMeals, planForDay, setTargets } from "./store";
import { getWaterSettings, logWater, setWaterSettings, toMl, waterDay } from "./water";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

const timeDescription = "Local time it happened, 'HH:MM' 24 h (e.g. '14:30'), or an ISO 8601 date-time. Defaults to now";

export const nutritionTools = [
  tool(
    "log_meal",
    "Log what the person ate or drank (except plain water: use log_water), as one meal: one or more foods or drinks with the time. Give each item's amount as `measure` in the person's own words ('2 latas', '1 taza', '250 ml', '30 g', 'un puño', '2 galletas Oreo' → '2 galletas'); it is stored as said and converted to g or ml. Each item's macros are TOTALS for that amount (not per 100 g or per unit): kcal for energy, grams for protein/carbs/fat/fiber. Estimate them when the person doesn't give them; for branded, packaged, restaurant or regional foods and drinks look the values up on the web first. Add caffeineMg for coffee, tea, mate, cola or energy drinks and alcoholG for alcoholic drinks. Snacks and drinks between meals go in slot 'snack', at any hour, as many per day as happen. Drinks other than water never count toward the water goal. Set `at` to the time they said ('a las 14:30' → '14:30'), `description` to their own words, and `offPlan: true` when it was not what the active plan had for that meal (or there is no plan). For a planned item eaten as written pass its planItemId from get_active_plan. Returns the stored entries with their ids. If there is an active plan, call adjust_day_plan right after.",
    {
      items: z
        .array(z.object({ ...mealShape, planItemId: z.string().optional().describe("The active plan's item this fulfils, from get_active_plan") }))
        .min(1)
        .max(30)
        .describe("Foods and drinks; items of one meal share a slot"),
      at: z.string().max(40).optional().describe(timeDescription),
      date: dateString.optional().describe("Local day (YYYY-MM-DD) the meal counts toward. Defaults to the day of `at`, i.e. today"),
      description: z.string().trim().max(300).optional().describe("The person's own words for the meal, in Spanish, e.g. 'Big Mac y papas medianas en McDonald's'"),
      offPlan: z.boolean().optional().describe("true when this was not the active plan's meal: eaten instead of it or on top of it"),
    },
    async ({ items, at, date, description, offPlan }) => {
      const when = at ? parseTime(at, date) : null;
      if (at && !when) return fail(`Unreadable time '${at}': use 'HH:MM' or ISO 8601`);
      const meal: MealInput[] = [];
      for (const { planItemId, ...fields } of items) {
        const item = toMealInput(fields);
        if (typeof item === "string") return fail(item);
        meal.push({
          ...item,
          planItemId,
          eatenAt: item.eatenAt ?? when?.at,
          date: item.date ?? when?.date ?? date,
          note: description ?? null,
          offPlan: offPlan ?? false,
        });
      }
      return json(logMeals(meal, "agent"));
    },
  ),
  tool(
    "adjust_day_plan",
    "After the person eats something, rewrite what is LEFT of today's diet plan so the day still lands on target. It works out what was eaten versus the daily targets, which planned meals are still ahead, and scales their portions by one factor (never below 50 % nor above 150 %), rounding to sensible portions. Pass `swaps` to replace a remaining meal with something better suited (e.g. a lighter, high-protein dinner after a heavy lunch): give each swap's items with quantity and total macros; everything else is scaled around them. Each call replaces the day's adjustment; earlier swaps for meals still ahead are kept unless you pass new ones or resetSwaps. The plan itself never changes. Returns the adjusted meals, the factor, eaten/targets/projected macros (kcal, grams) and a one-line Spanish summary; the Dieta tab shows it with an 'Ajustado por el Coach' badge.",
    {
      date: dateString.optional().describe("Local day (YYYY-MM-DD). Defaults to today"),
      swaps: z
        .array(z.object({ slot, name: z.string().max(120).nullish().describe("Dish name"), items: z.array(planItem).min(1).max(15) }))
        .max(6)
        .optional()
        .describe("Replacement meals for some remaining slots; macros are totals per item"),
      slots: z.array(slot).max(6).optional().describe("Override which planned slots are still ahead, only if the default (slots with nothing logged after the last meal) is wrong"),
      note: z.string().trim().max(200).optional().describe("Why, in one short Spanish sentence, shown in Dieta"),
      resetSwaps: z.boolean().optional().describe("Drop earlier swaps and go back to scaled plan meals"),
    },
    async ({ date, ...options }) => {
      try {
        return json(adjustDayPlan(date ?? localDate(), options));
      } catch (error) {
        return fail((error as Error).message);
      }
    },
  ),
  tool(
    "delete_meal",
    "Delete a logged food entry by id (from list_meals or log_meal), e.g. to fix a wrong log.",
    { id: z.string() },
    async ({ id }) => (deleteMeal(id) ? json({ deleted: id }) : fail(`No meal entry ${id}`)),
  ),
  tool(
    "list_meals",
    "Logged food and drink entries between two local days (YYYY-MM-DD, inclusive), oldest first. Macros are totals per entry: kcal and grams. quantity + unit is the normalized amount (g, ml or serving); measure is the amount as the person said it (e.g. 2 lata, size null = 355 ml each), or null. caffeineMg and alcoholG when known. eatenAt is epoch ms; offPlan and note say whether it was off the plan and how the person described it. Defaults to today. Max 62 days.",
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
    "Totals eaten on a local day versus the daily targets: totals, targets, remaining (targets minus totals; negative means over), per-slot totals, and the day's caffeineMg and alcoholG. kcal and grams. Defaults to today. Use before suggesting what to eat next.",
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
    "The active diet plan, plus which plan day applies on the given local day (default today), which of its items are already logged as eaten, and the day's adjustment (the remaining meals as adjust_day_plan rewrote them) if any. null if there is no active plan.",
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
  tool(
    "log_water",
    "Log water the person drank. Give the amount in their words: ml, litres ('l'), or glasses ('vaso') and bottles ('botella') of the sizes they set in the app (see get_water's settings). Returns the entry (amountMl) and the day's total against the goal, in ml.",
    {
      amount: z.number().positive().max(10000).describe("How much, in `unit`"),
      unit: z.enum(["ml", "l", "vaso", "botella"]).default("ml"),
      at: z.string().max(40).optional().describe(timeDescription),
      date: dateString.optional().describe("Local day (YYYY-MM-DD). Defaults to the day of `at`, i.e. today"),
    },
    async ({ amount, unit, at, date }) => {
      const when = at ? parseTime(at, date) : null;
      if (at && !when) return fail(`Unreadable time '${at}': use 'HH:MM' or ISO 8601`);
      const amountMl = toMl(amount, unit);
      if (amountMl > 5000) return fail("More than 5 L in one go: log it in parts or check the amount");
      const entry = logWater({ amountMl, loggedAt: when?.at, date: when?.date ?? date, source: "agent" });
      const day = waterDay(entry.date);
      return json({ entry, totalMl: day.totalMl, goalMl: day.goalMl });
    },
  ),
  tool(
    "get_water",
    "Water drunk on a local day (default today), in ml: total, goal (the person's own, else 35 ml/kg of body weight kept within 2000–3700, else 2000), each entry, and their settings (preferred unit and glass/bottle sizes in ml). Use it to tell them how much is left in their own unit.",
    { date: dateString.optional() },
    async ({ date }) => json(waterDay(date ?? localDate())),
  ),
  tool(
    "set_water_goal",
    "Set the person's daily water goal in ml, or null to go back to the automatic one (35 ml per kg of body weight, kept within 2–3.7 L).",
    { goalMl: z.number().min(250).max(10000).nullable() },
    async ({ goalMl }) => json(setWaterSettings({ ...getWaterSettings(), goalMl })),
  ),
];
