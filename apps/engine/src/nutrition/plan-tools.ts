/** The Coach's tools for the dated plan: reading it, small local changes (each undoable), recipes and prep batches. */
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { localDate } from "./dates";
import { dietHorizon, requirePlan } from "./horizon";
import { dateString } from "./inputs";
import {
  ateOut,
  fillSlot,
  ingredientUnavailable,
  moveSlot,
  noTimeToCook,
  placeEntries,
  prepCooked,
  rebalanceDay,
  replaceSlot,
  schedulePrep,
  skipSlot,
  spread,
  swapDays,
  undo,
  useLeftover,
} from "./ops";
import { opShapes } from "./plan-inputs";
import { suggestPrepDays } from "./prepdays";
import { createRecipe, listRecipes, recipeShape } from "./recipes";
import { listRevisions } from "./revisions";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

async function safely(run: () => unknown) {
  try {
    return json(await run());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : (error as Error).message;
    return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
  }
}

const CHANGE =
  "Changes only the slots it names; never regenerates the plan. Returns the change: summary (one Spanish line to tell the person, e.g. 'Cambié salmón por atún en 2 comidas (mar, jue)'), " +
  "revision (its id undoes it with undo_plan_change), the touched slots as they are now, compensation when asked, and whether the shopping list was rebuilt to follow.";

const rebalanceDescription =
  "Rewrite what is LEFT of a day's plan so the day still lands near its goal (targets plus any kcal spread onto it): scales the remaining planned meals by one factor, " +
  "rounded to sensible portions, never moving them more than maxChangePct (default 15 %) of the day's goal in total — what doesn't fit stays a deviation; use spread_deviation for that if it is big. " +
  "Pass `swaps` to replace a remaining meal with something better suited (e.g. a lighter, high-protein dinner after a heavy lunch). Each call replaces the day's adjustment; earlier swaps for meals still ahead are kept unless replaced or resetSwaps. " +
  "The Dieta tab shows it with an 'Ajustado por el Coach' badge. " +
  CHANGE;

export const planTools = [
  tool(
    "get_diet_horizon",
    "The active plan laid out as dated slots, from `from` (default today) for `days` (default the plan's horizon, usually 14): per day its slots (id, slot, kind items|recipe|prep|eat_out, name, items as planned, " +
      "adjusted portions when the day was rebalanced, macros now in kcal and grams, status planned|eaten|replaced|skipped, real = what was actually eaten for it (label, entryIds, macros, asPlanned), " +
      "missed = still pending well after its time with nothing logged («sin registrar»: ask, don't assume a skip), cookMinutes), the day's planned total, asPlanned (all the plan had) vs real (all logged) totals, extraIds (entries that are no meal), goalKcal and shiftKcal; " +
      "prep batches (portions, leftover = free portions, status); and lastRevision (the change undo_plan_change would undo). null without an active plan. Read it before changing anything.",
    { from: dateString.optional(), days: z.number().int().min(1).max(31).optional() },
    async ({ from, days }) => safely(() => dietHorizon(from, days)),
  ),
  tool(
    "skip_slot",
    "The person skipped a planned meal and ate nothing instead ('no desayuné', 'me la salté'). Marks that slot skipped (use it for a meal shown missed once they confirm). Then compensate by magnitude: 'none' for a minor slip (≲10 % of the day), 'day' to rebalance the rest of that day, " +
      "'spread' to share a big gap over the next spreadDays days. Every day stays within maxChangePct (≤15 %) of its goal. " +
      CHANGE,
    opShapes.skip,
    async (input) => safely(() => skipSlot(input)),
  ),
  tool(
    "replace_slot",
    "The person ate something else INSTEAD of a planned meal but you can't log it as food (they don't know what or how much): marks the slot replaced with `what`. " +
      "When it can be logged, just log_meal it — that ties it to the meal by itself — and use this only to compensate, or pass logged entryIds to move them here. Works out the difference in kcal; compensate by magnitude as with skip_slot ('none' when it is within ~10 % of the day). " +
      CHANGE,
    opShapes.replace,
    async (input) => safely(() => replaceSlot(input)),
  ),
  tool(
    "ate_out",
    "The person ate out unexpectedly ('salí a cenar', 'comí en la calle') instead of a planned meal. Logs what they ate as that meal's real meal: name in their words and, when you can estimate it, kcal and grams " +
      "(look restaurant food up as for log_meal); without kcal it counts the planned meal × 1.3. Refused when the meal already has entries (log_meal them instead). " +
      "Then decide by magnitude (compensate none|day|spread). Planned meals that no longer make sense (tonight's quesadilla ingredients) can be moved with move_slot — suggest it, don't force it. " +
      CHANGE,
    opShapes.ate_out,
    async (input) => safely(() => ateOut(input)),
  ),
  tool(
    "place_meal",
    "Fix which meal some logged entries were: 'eso fue mi desayuno' → slot desayuno (or slotId); 'eso fue un snack' → extra true, and it is never tied to a meal again. " +
      "The meal they leave goes back to pending when nothing else is in it. entryIds from list_meals or log_meal, all of one day. " +
      CHANGE,
    opShapes.place,
    async (input) => safely(() => placeEntries(input)),
  ),
  tool("rebalance_day", rebalanceDescription, opShapes.rebalance, async (input) => safely(() => rebalanceDay(input))),
  tool(
    "adjust_day_plan",
    "Same as rebalance_day (older name, kept for old conversations), returning the day's adjustment itself plus the revision. " + rebalanceDescription,
    opShapes.rebalance,
    async (input) =>
      safely(() => {
        const { adjustment, revision, shoppingRefreshed } = rebalanceDay(input);
        return { ...adjustment, revision, shoppingRefreshed };
      }),
  ),
  tool(
    "spread_deviation",
    "Spread a big deviation over the next days: kcal is eaten minus planned (positive = ate more → lighter days; negative = ate less → slightly bigger days), " +
      "shared evenly over `days` (default 3) starting the day after `date`, never more than maxChangePct (≤15 %) of a day's goal; what doesn't fit is left as is, never extreme days. " +
      "Each day's remaining meals are rescaled to match. Use for big deviations only (a dinner out, a party); small ones are absorbed the same day or ignored. " +
      CHANGE,
    opShapes.spread,
    async (input) => safely(() => spread(input)),
  ),
  tool(
    "ingredient_unavailable",
    "The person can't get an ingredient (not at the supermarket, ran out). Without `substitute` it only previews: which planned meals use it and which pantry items (same aisle) could stand in — prefer those, then ask or pick a close equivalent. " +
      "With `substitute` (name, ratio of amount, macros per 100 g/ml) it swaps the ingredient only in the affected meals still planned (and in batches not yet cooked, as a recipe variant), keeps everything else, and rebuilds the shopping list. " +
      CHANGE,
    opShapes.ingredient_unavailable,
    async (input) => safely(() => ingredientUnavailable(input)),
  ),
  tool(
    "no_time_to_cook",
    "The person has no time to cook a meal ('hoy no cocino'). Default (auto): use a free portion of a prep batch cooked by then; else swap it with the same meal on a later day that needs no cooking. " +
      "strategy quick puts in the fill you give (something quick or eat_out). Without slot it handles every meal that day needing more than 15 min. " +
      CHANGE,
    opShapes.no_time_to_cook,
    async (input) => safely(() => noTimeToCook(input)),
  ),
  tool(
    "move_slot",
    "Move a planned meal to another day and/or slot; if the target holds a planned meal, the two swap. " + CHANGE,
    opShapes.move,
    async (input) => safely(() => moveSlot(input)),
  ),
  tool(
    "swap_days",
    "Swap the remaining planned meals of two days (e.g. the heavier training-day menu onto the day they now train). Eaten or skipped meals stay put. " + CHANGE,
    opShapes.swap_days,
    async (input) => safely(() => swapDays(input)),
  ),
  tool(
    "fill_slot",
    "Set what a slot should be: an item list (quantities and TOTAL macros per item, kcal and grams), portions of a saved recipe cooked that day, a portion of a prep batch, or an eat_out budget (kcal and grams). " +
      "Adds the slot if that day has none for the meal (e.g. an extra snack). Use it to plan, not to record what was eaten (log_meal does that). " +
      CHANGE,
    opShapes.fill,
    async (input) => safely(() => fillSlot(input)),
  ),
  tool(
    "create_recipe",
    "Save a recipe: ingredients for the whole pot (quantity + unit in g, ml, serving or a household unit like lata or taza, with TOTAL macros for that amount), servings it makes, active prep minutes, and batch = true when it keeps well for meal prep. " +
      "Returns it with perServing macros. Use with fill_slot (cook it that day) or schedule_prep (cook once for several days).",
    recipeShape,
    async (input) => safely(() => createRecipe(input)),
  ),
  tool(
    "list_recipes",
    "Saved recipes, newest first: ingredients, servings, prepMinutes, batch flag, perServing macros (kcal, grams); variantOf is set on versions made by swapping an ingredient.",
    {},
    async () => safely(() => listRecipes()),
  ),
  tool(
    "suggest_prep_days",
    "Where cooking a batch fits in the coming days, from the calendar: per day the free minutes between 16:00 and an hour before bed, the best free window, busy blocks, planned training and how much cooking its own meals need, ranked best first; " +
      "meals on tight days that a batch portion could cover; and batch-friendly recipes. Use it weekly to PROPOSE one or two prep days to the person, then schedule_prep once they agree.",
    { from: dateString.optional(), days: z.number().int().min(3).max(14).default(7) },
    async ({ from, days }) => safely(() => suggestPrepDays(from ?? localDate(), days)),
  ),
  tool(
    "schedule_prep",
    "Plan a batch: cook recipeId on cookDate yielding `portions`, and give a portion to each slot in `assign` (on or after cookDate; what those slots had is replaced). Portions not assigned stay free as leftovers. " +
      "The shopping list then asks for the whole batch's ingredients once. " +
      CHANGE,
    opShapes.schedule_prep,
    async (input) => safely(() => schedulePrep(input)),
  ),
  tool(
    "mark_prep_cooked",
    "The person cooked a batch (cooked true) or not yet (false). Cooking uses its ingredients up from the pantry. " + CHANGE,
    opShapes.prep_cooked,
    async (input) => safely(() => prepCooked(input)),
  ),
  tool(
    "use_leftover",
    "Put one free portion of a batch (leftover > 0 in get_diet_horizon) into a slot, replacing what it had. " + CHANGE,
    opShapes.use_leftover,
    async (input) => safely(() => useLeftover(input)),
  ),
  tool(
    "list_plan_changes",
    "Recent changes to the active plan, newest first: id, op, Spanish summary, dates, and undoneAt when undone.",
    { limit: z.number().int().min(1).max(50).default(10) },
    async ({ limit }) => safely(() => listRevisions(requirePlan().id, limit)),
  ),
  tool(
    "undo_plan_change",
    "Undo a plan change: the latest one by default, or `id` from list_plan_changes (refused while a later change touches the same days: undo that first). Puts the touched slots, adjustments and batches back as they were and rebuilds the shopping list.",
    { id: z.string().optional() },
    async ({ id }) => safely(() => undo(id)),
  ),
];
