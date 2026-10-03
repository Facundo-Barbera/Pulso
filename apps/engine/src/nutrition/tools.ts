import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { FoodProduct, MealInput, PortionEstimate } from "@pulso/contract";
import { z } from "zod";
import { lookupBarcode, normalizeBarcode } from "./barcode";
import { dishTools, safely } from "./dish-tools";
import { dishName } from "./dishes";
import { addToDish } from "./logged-dishes";
import { parseTime } from "./dates";
import { estimatePortion, PortionError } from "./portion";
import { dateString, macroShape, mealShape, planItem, planShape, slot, targetsShape, toMealInput } from "./inputs";
import { addDays, createPlan, dailySummary, deleteMeal, getTargets, listMeals, localDate, logMeals, planForDay, setTargets } from "./store";
import { planTools } from "./plan-tools";
import { setHorizonDays } from "./slots";
import { getWaterSettings, logWater, setWaterSettings, toMl, waterDay } from "./water";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

const timeDescription = "Local 'HH:MM' (24 h) or ISO 8601 date-time; default now";

/** What log_meal needs from an estimate: the amount as said, the total macros and the barcode. */
export function logItem(estimate: PortionEstimate) {
  const { measure, quantity, unit, macros } = estimate;
  return {
    name: estimate.name,
    ...(measure ? { measure: { ...measure, base: unit } } : { quantity, unit }),
    ...macros,
    barcode: estimate.barcode || null,
  };
}

export const nutritionTools = [
  tool(
    "log_meal",
    "Log food or drinks the person had (plain water: log_water) as one meal. Foods eaten together are ONE dish: one item per food and the dish's name in `dish`, never several foods in one item's name; items sharing a slot become one dish anyway. A saved dish that matches (list_dishes) → log_dish. " +
      "Item macros are TOTALS for the amount (not per 100 g): kcal and grams. `at` is the time they said, `description` their words. " +
      "With an active plan each meal is tied to a plan slot by itself (slotId, else the planned item by planItemId or name, else the item's slot, else the time window): «eaten as planned» or «ate this instead», undoable. Snacks and drinks under ~250 kcal between meals stay extras; the day's first food is breakfast. " +
      "Returns the entries with slotId (null = extra); fix a wrong one with place_meal.",
    {
      items: z
        .array(z.object({ ...mealShape, planItemId: z.string().optional().describe("Plan item it fulfils (get_active_plan)") }))
        .min(1)
        .max(30)
        .describe("One per food; one meal shares a slot"),
      at: z.string().max(40).optional().describe(timeDescription),
      date: dateString.optional().describe("Local day it counts toward; default `at`'s"),
      description: z.string().trim().max(300).optional().describe("The person's own words, in Spanish"),
      offPlan: z.boolean().optional().describe("Legacy, rarely needed: with slotId, counts it as eaten instead of that slot even if it matches the plan"),
      slotId: z.string().optional().describe("Plan slot (get_diet_horizon), only when the time would pick the wrong meal"),
      dish: z.string().trim().min(1).max(120).optional().describe("Dish name in Spanish, e.g. 'Batido de proteína con fresas'"),
      addToDish: z.string().optional().describe("Logged dish id (entry.dish.id) to add these to ('también le puse fresas'); ignores at, slotId, dish"),
    },
    async ({ items, at, date, description, offPlan, slotId, dish, addToDish: into }) => {
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
          slotId: slotId ?? null,
        });
      }
      if (into) return safely(() => addToDish(into, meal.map(({ slot: _s, eatenAt: _e, date: _d, ...food }) => food), "agent"));
      const bySlot = new Map<string, MealInput[]>();
      for (const m of meal) bySlot.set(m.slot, [...(bySlot.get(m.slot) ?? []), m]);
      const named = bySlot.size === 1 ? dish : undefined;
      return json(
        [...bySlot.values()].flatMap((group) =>
          group.length > 1 || named ? logMeals(group, "agent", { name: named ?? dishName(group) }) : logMeals(group, "agent"),
        ),
      );
    },
  ),
  tool(
    "estimate_portion",
    "Turn an amount of a packaged product in words ('una cucharada', 'media taza', 'la mitad del paquete', '2 de 6 galletas', 'un scoop', '20 %') into grams and macros. " +
      "Give `barcode` (looked up in Open Food Facts) or else `product` with its label values. Spoons and cups of solids use a food-specific density (level: cucharada 15 ml, cucharadita 5 ml, taza 240 ml); shares use the package size; counts use unitGrams, unitsPerPackage or a typical weight. " +
      "Returns `estimate` (g, or ml for drinks; total macros; package share; `assumption`, a Spanish line to tell the person) and `logItem`, to pass as is (plus slot) in log_meal's items. An error is a question to ask the person.",
    {
      barcode: z.string().optional().describe("8 to 14 digits"),
      product: z
        .object({
          name: z.string().trim().min(1).max(120),
          per100g: z.object(macroShape).describe("Per 100 g (100 ml when liquid)"),
          liquid: z.boolean().default(false),
          packageSize: z.number().positive().max(100000).nullish().describe("g (ml when liquid)"),
          servingGrams: z.number().positive().max(5000).nullish(),
        })
        .optional()
        .describe("Label values, without a barcode"),
      amount: z.string().trim().min(1).max(120).describe("How much, in the person's words"),
      unitGrams: z.number().positive().max(2000).optional().describe("Grams of one counted unit (a cookie, a slice)"),
      unitsPerPackage: z.number().int().positive().max(500).optional().describe("e.g. '12 galletas'"),
      density: z.number().positive().max(3).optional().describe("g per ml, overriding the table"),
    },
    async ({ barcode, product: given, amount, unitGrams, unitsPerPackage, density }) => {
      let product: FoodProduct | null = null;
      if (barcode) {
        const code = normalizeBarcode(barcode);
        if (!code) return fail("Barcode must be 8 to 14 digits");
        try {
          product = await lookupBarcode(code);
        } catch (error) {
          if (!given) return fail(`Open Food Facts unavailable (${(error as Error).message}): ask for the label values and pass them as product`);
        }
        if (!product && !given) return fail(`Barcode ${code} is not in Open Food Facts: ask for the label values (kcal and macros per 100 g, package size) and pass them as product`);
      }
      if (!product && given) {
        product = { barcode: barcode ?? "", brand: null, imageUrl: null, packageKind: null, ...given, packageSize: given.packageSize ?? null, servingGrams: given.servingGrams ?? null };
      }
      if (!product) return fail("Give a barcode or the product's label values");
      try {
        const estimate = estimatePortion(product, amount, { unitGrams, unitsPerPackage, density });
        return json({ estimate, logItem: logItem(estimate) });
      } catch (error) {
        if (error instanceof PortionError) return fail(error.message);
        throw error;
      }
    },
  ),
  tool(
    "delete_meal",
    "Delete a logged food entry by id (list_meals or log_meal).",
    { id: z.string() },
    async ({ id }) => (deleteMeal(id) ? json({ deleted: id }) : fail(`No meal entry ${id}`)),
  ),
  tool(
    "list_meals",
    "Logged food and drink entries for local days from–to (inclusive; default today; max 62 days), oldest first. Per entry: total macros (kcal, g); quantity + unit normalized (g, ml, serving); measure as said (size null = the unit's default) or null; caffeineMg, alcoholG; eatenAt epoch ms; dish ({ id, name, savedDishId }, components together; null alone); slotId (the plan meal it is, null = extra); offPlan (eaten instead of it); note (their words).",
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
    "What was eaten on a local day (default today) vs the daily targets, kcal and g: totals, targets, remaining (negative = over), zones (each nutrient vs its min/max/kind: below, inZone, above), inZone (kcal in zone and protein at least its min), per-slot totals, caffeineMg, alcoholG.",
    { date: dateString.optional() },
    async ({ date }) => json(dailySummary(date ?? localDate())),
  ),
  tool(
    "get_targets",
    "Daily nutrition targets (kcal; g of protein, carbs, fat, fiber), each with its zone (min, max, kind: min = at least, range = between, max = under; custom when set by hand). null if never set.",
    {},
    async () => json(getTargets()),
  ),
  tool(
    "set_targets",
    "Replace the daily nutrition targets and their zones (the Dieta rings' bands; adherence counts days in zone). Pass zones only to change a derived one (e.g. protein { min: 150 }); custom zones not passed again are dropped.",
    targetsShape,
    async (targets) => json(setTargets(targets)),
  ),
  tool(
    "create_diet_plan",
    "Create a NEW diet plan: days → meals by slot → items with quantity and TOTAL macros (kcal, g). Days repeat from startsOn, laid out as dated slots over horizonDays. By default it replaces the active plan and its dated changes. Only when the person asks for a new plan, never for a deviation (skip_slot, ingredient_unavailable, no_time_to_cook… do those). Items should add up near the targets; set_targets if they change.",
    planShape,
    async ({ horizonDays, ...input }) => {
      const plan = createPlan(input);
      if (horizonDays) setHorizonDays(plan.id, horizonDays);
      return json(plan);
    },
  ),
  tool(
    "get_active_plan",
    "The active diet plan (null if none) and its plan for a local day (default today; from today on with its changes, skipped and replaced meals left out), which items are already eaten, and the day's rebalance_day adjustment if any. Slot ids and status: get_diet_horizon.",
    { date: dateString.optional() },
    async ({ date }) => json(planForDay(date ?? localDate())),
  ),
  tool(
    "lookup_food_barcode",
    "Look up a packaged food by EAN/UPC barcode in Open Food Facts: name, brand, macros per 100 g (kcal, g), serving g; null if unknown. Scale per100g by grams/100 before logging.",
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
    "Log plain water. amount in the unit they used: ml, l, vaso or botella (their sizes: get_water). Returns the entry (amountMl), the day's totalMl and goalMl.",
    {
      amount: z.number().positive().max(10000).describe("How much, in `unit`"),
      unit: z.enum(["ml", "l", "vaso", "botella"]).default("ml"),
      at: z.string().max(40).optional().describe(timeDescription),
      date: dateString.optional().describe("Local day; default `at`'s"),
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
    "Water on a local day (default today), ml: total, goal (theirs, else 35 ml/kg within 2000–3700, else 2000), entries, and settings (preferred unit, glass and bottle ml).",
    { date: dateString.optional() },
    async ({ date }) => json(waterDay(date ?? localDate())),
  ),
  tool(
    "set_water_goal",
    "Set the daily water goal in ml; null = automatic (35 ml/kg, within 2–3.7 L).",
    { goalMl: z.number().min(250).max(10000).nullable() },
    async ({ goalMl }) => json(setWaterSettings({ ...getWaterSettings(), goalMl })),
  ),
  ...dishTools,
  ...planTools,
];
