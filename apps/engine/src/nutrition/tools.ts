import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { FoodProduct, MealInput, PortionEstimate } from "@pulso/contract";
import { z } from "zod";
import { lookupBarcode, normalizeBarcode } from "./barcode";
import { parseTime } from "./dates";
import { usePantryFor, pantryRowFor } from "./pantry-use";
import { estimatePortion, PortionError } from "./portion";
import { dateString, macroShape, mealShape, planItem, planShape, slot, targetsShape, toMealInput } from "./inputs";
import { addDays, createPlan, dailySummary, deleteMeal, getTargets, listMeals, localDate, logMeals, planForDay, setTargets } from "./store";
import { planTools } from "./plan-tools";
import { setHorizonDays } from "./slots";
import { getWaterSettings, logWater, setWaterSettings, toMl, waterDay } from "./water";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

const timeDescription = "Local time it happened, 'HH:MM' 24 h (e.g. '14:30'), or an ISO 8601 date-time. Defaults to now";

/** What log_meal needs from an estimate: the amount as said, the total macros and the barcode (which links the pantry). */
export function logItem(estimate: PortionEstimate) {
  const { measure, quantity, unit, macros } = estimate;
  return {
    name: estimate.name,
    ...(measure ? { measure: { ...measure, base: unit } } : { quantity, unit }),
    ...macros,
    barcode: estimate.barcode || null,
  };
}

/** Package sizes by barcode, from the cache (a scanned product was just looked up). */
async function packageSizes(codes: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  for (const code of new Set(codes)) out.set(code, (await lookupBarcode(code).catch(() => null))?.packageSize ?? null);
  return out;
}

export const nutritionTools = [
  tool(
    "log_meal",
    "Log what the person ate or drank (except plain water: use log_water), as one meal: one or more foods or drinks with the time. Give each item's amount as `measure` in the person's own words ('2 latas', '1 taza', '250 ml', '30 g', 'un puño', '2 galletas Oreo' → '2 galletas'); it is stored as said and converted to g or ml. Each item's macros are TOTALS for that amount (not per 100 g or per unit): kcal for energy, grams for protein/carbs/fat/fiber. Estimate them when the person doesn't give them; for branded, packaged, restaurant or regional foods and drinks look the values up on the web first. Add caffeineMg for coffee, tea, mate, cola or energy drinks and alcoholG for alcoholic drinks. Set `at` to the time they said ('a las 14:30' → '14:30') and `description` to their own words. Pick the item slot from what it was: the meal (desayuno, comida, cena…) for a main meal, 'snack' for snacks and drinks between meals. " +
      "With an active plan every meal is tied to the plan automatically (Planeado → Real): the slot you pass, else the planned item it is (planItemId from get_active_plan, or the same food name), else the meal it was logged as, else the meal whose time window holds it; it then reads «eaten as planned» when it is the plan's food and «ate this instead» otherwise, and that is undoable. Snacks and drinks under ~250 kcal between meals stay extras; the first food of the day is breakfast. " +
      "Pass slotId (get_diet_horizon) only when you know better than the time (e.g. breakfast eaten at 12:30). Each returned entry has slotId: the meal it became (null = extra). If that is wrong, fix it with place_meal. Then decide by magnitude whether to compensate (rebalance_day, spread_deviation, or nothing)",
    {
      items: z
        .array(z.object({ ...mealShape, planItemId: z.string().optional().describe("The active plan's item this fulfils, from get_active_plan") }))
        .min(1)
        .max(30)
        .describe("Foods and drinks; items of one meal share a slot"),
      at: z.string().max(40).optional().describe(timeDescription),
      date: dateString.optional().describe("Local day (YYYY-MM-DD) the meal counts toward. Defaults to the day of `at`, i.e. today"),
      description: z.string().trim().max(300).optional().describe("The person's own words for the meal, in Spanish, e.g. 'Big Mac y papas medianas en McDonald's'"),
      offPlan: z.boolean().optional().describe("Legacy, rarely needed: with slotId, counts the meal as eaten instead of that slot even if it matches the plan's foods. Whether a meal was the plan or not is worked out automatically"),
      slotId: z.string().optional().describe("The plan slot (get_diet_horizon) this meal is, when the time alone would put it in the wrong meal. Omit otherwise"),
    },
    async ({ items, at, date, description, offPlan, slotId }) => {
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
      const entries = logMeals(meal, "agent");
      const stocked = entries.flatMap((e) => (e.barcode && pantryRowFor(e.name) ? [e.barcode] : []));
      const pantry = stocked.length ? usePantryFor(entries, await packageSizes(stocked)) : [];
      if (!pantry.length) return json(entries);
      // A second block, so the entries keep the shape every caller reads.
      return { content: [...json(entries).content, { type: "text" as const, text: JSON.stringify({ pantryLeft: pantry }) }] };
    },
  ),
  tool(
    "estimate_portion",
    "Work out how much of a packaged product the person ate when they say it in words: 'una cucharada', '2 cucharaditas', 'media taza', 'la mitad del paquete', 'un tercio de la botella', '2 de 6 galletas', '3 galletas', 'un scoop', '30 g', '20 %'. " +
      "Give the product by `barcode` (a scanned product in the message has one; it is looked up in Open Food Facts) or, without one, as `product` with its label values. " +
      "Spoons and cups of a solid are converted with a food-specific density (azúcar, harina, avena, arroz crudo/cocido, crema de cacahuate, mayonesa, miel, aceite, leche/proteína en polvo, mantequilla, queso rallado, cereal…; level spoons: cucharada 15 ml, cucharadita 5 ml, taza 240 ml); shares use the package size; counts use `unitGrams`, `unitsPerPackage` (from the label or the photo) or a typical weight (galleta ~10 g). " +
      "Returns `estimate` (quantity in g, or ml for drinks; total macros: kcal and grams; share of the package; `assumption`, one Spanish line to tell the person, e.g. '1 cucharada de Crema de cacahuete (rasa, ~16 g como crema de cacahuate) ≈ 16 g → 94 kcal'), `logItem` to pass as is (adding slot) in log_meal's items, and `pantry` when the product is in the pantry (log_meal then uses it up and says what is left). " +
      "An error is a question to ask the person (e.g. how much each one weighs).",
    {
      barcode: z.string().optional().describe("8 to 14 digits"),
      product: z
        .object({
          name: z.string().trim().min(1).max(120),
          per100g: z.object(macroShape).describe("Macros per 100 g (per 100 ml when liquid)"),
          liquid: z.boolean().default(false),
          packageSize: z.number().positive().max(100000).nullish().describe("g (ml when liquid) in the package"),
          servingGrams: z.number().positive().max(5000).nullish(),
        })
        .optional()
        .describe("The product's label values, when there is no barcode"),
      amount: z.string().trim().min(1).max(120).describe("How much, in the person's words"),
      unitGrams: z.number().positive().max(2000).optional().describe("Grams of one counted unit (one cookie, one slice), when the label says"),
      unitsPerPackage: z.number().int().positive().max(500).optional().describe("Units in the package ('12 galletas'), when the label says"),
      density: z.number().positive().max(3).optional().describe("g per ml, to override the table for spoons and cups"),
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
        const row = pantryRowFor(product.name);
        return json({ estimate, logItem: logItem(estimate), pantry: row ? { name: row.name, quantity: row.quantity, unit: row.unit } : null });
      } catch (error) {
        if (error instanceof PortionError) return fail(error.message);
        throw error;
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
    "Logged food and drink entries between two local days (YYYY-MM-DD, inclusive), oldest first. Macros are totals per entry: kcal and grams. quantity + unit is the normalized amount (g, ml or serving); measure is the amount as the person said it (e.g. 2 lata, size null = 355 ml each), or null. caffeineMg and alcoholG when known. eatenAt is epoch ms; slotId is the plan meal it is the real meal of (null = an extra), offPlan true when it was eaten instead of that meal, note how the person described it. Defaults to today. Max 62 days.",
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
    "Create a complete NEW diet plan in one call: days → meals (by slot) → items with quantity and the macros for that quantity (kcal, grams). Days repeat cyclically from startsOn and are laid out as dated slots over the horizon (horizonDays, 7 or 14). By default it becomes the active plan, replacing the previous one and its dated changes. Only when the person asks for a new plan: for anything that went differently (a skipped meal, a missing ingredient, no time to cook) use the small changes (skip_slot, replace_slot, ingredient_unavailable, no_time_to_cook, move_slot…). Item macros should add up close to the daily targets; call set_targets too if they change.",
    planShape,
    async ({ horizonDays, ...input }) => {
      const plan = createPlan(input);
      if (horizonDays) setHorizonDays(plan.id, horizonDays);
      return json(plan);
    },
  ),
  tool(
    "get_active_plan",
    "The active diet plan, plus the plan as written for the given local day (default today; from today on it is the dated plan with its changes, skipped and replaced meals left out), which of its items are already logged as eaten, and the day's adjustment (the remaining meals as rebalance_day rewrote them) if any. null if there is no active plan. get_diet_horizon has the dated slots with ids and status.",
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
  ...planTools,
];
