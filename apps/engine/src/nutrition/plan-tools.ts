/** The Coach's tools for the dated plan: reading it, small local changes (each undoable), recipes and prep batches. */
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { PlanSlot } from "@pulso/contract";
import { z } from "zod";
import { withCard } from "../agent/card";
import { horizonForCoach, planResultForCoach } from "./coach-view";
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

/** Runs a tool, turning mistakes into an error the model can fix. A plan change reaches the model as lines; its card gets it whole. */
async function safely(run: () => unknown, relevant?: (s: PlanSlot) => boolean) {
  try {
    const value = await run();
    const forCoach = planResultForCoach(value, relevant);
    return forCoach === value ? json(value) : withCard(forCoach, value);
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : (error as Error).message;
    return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
  }
}

const CHANGE =
  "Touches only the slots named. Returns summary (a Spanish line to tell the person), revisionId (for undo_plan_change), the touched slots as get_diet_horizon lines, compensation if asked, and whether the shopping list was rebuilt.";

const rebalanceDescription =
  "Rescale what is LEFT of a day's plan so the day lands near its goal (targets plus kcal spread onto it), in sensible portions, moving at most maxChangePct of the goal; what doesn't fit stays a deviation. " +
  "`swaps` replace remaining meals (e.g. a lighter dinner after a heavy lunch). Each call replaces the day's adjustment; earlier swaps still ahead are kept unless replaced or resetSwaps. Shown in Dieta as 'Ajustado por el Coach'. " +
  CHANGE;

export const planTools = [
  tool(
    "get_diet_horizon",
    "The active plan as dated slots from `from` (default today) for `days` (default 7): per day goalKcal, shiftKcal (kcal spread onto it), planned and real (logged) totals, extraIds (entries that are no meal), the rebalance summary, and one line per slot: " +
      "«<slot id> · meal · «dish» · items as to eat now (\"(ajustado)\" if rebalanced) or receta/tanda <id> × portions or comer fuera · kcal · protein · planned|eaten|replaced|skipped» plus what happened: «(sin registrar)» = pending past its time (ask, don't assume a skip), «en su lugar», «real: … [entry ids]», cooking minutes, note. " +
      "Then prep batches (id, recipe, cook date, portions assigned/eaten/free, status) and lastRevision (what undo_plan_change would undo). null without an active plan.",
    { from: dateString.optional(), days: z.number().int().min(1).max(31).optional() },
    async ({ from, days }) => safely(() => horizonForCoach(dietHorizon(from, days ?? 7))),
  ),
  tool(
    "skip_slot",
    "They skipped a planned meal and ate nothing ('no desayuné'): marks the slot skipped (a meal shown missed, only once they confirm). compensate by magnitude: none for ≲10 % of the day. " + CHANGE,
    opShapes.skip,
    async (input) => safely(() => skipSlot(input)),
  ),
  tool(
    "replace_slot",
    "They ate something else instead of a planned meal that can't be logged as food: marks the slot replaced with `what`. If it can be logged, log_meal ties it by itself; use this only to compensate or to move logged entryIds here. compensate as in skip_slot. " +
      CHANGE,
    opShapes.replace,
    async (input) => safely(() => replaceSlot(input)),
  ),
  tool(
    "ate_out",
    "They ate out instead of a planned meal ('salí a cenar'): logs it as that meal's real meal. Refused when the meal already has entries (log_meal those). compensate as in skip_slot. " + CHANGE,
    opShapes.ate_out,
    async (input) => safely(() => ateOut(input)),
  ),
  tool(
    "place_meal",
    "Fix which meal logged entries were: 'eso fue mi desayuno' → slot or slotId; 'eso fue un snack' → extra (never tied to a meal again). The meal they leave goes back to pending if empty. " + CHANGE,
    opShapes.place,
    async (input) => safely(() => placeEntries(input)),
  ),
  tool("rebalance_day", rebalanceDescription, opShapes.rebalance, async (input) => safely(() => rebalanceDay(input))),
  tool(
    "adjust_day_plan",
    "Legacy name of rebalance_day, kept for old conversations: same input and effect, returning the day's adjustment itself plus the revision. Prefer rebalance_day.",
    opShapes.rebalance,
    async (input) =>
      safely(() => {
        const { adjustment, revision, shoppingRefreshed } = rebalanceDay(input);
        return { ...adjustment, revision, shoppingRefreshed };
      }),
  ),
  tool(
    "spread_deviation",
    "Spread a big deviation (a dinner out, a party) evenly over `days` after `date`, rescaling their remaining meals: lighter days when they ate more, slightly bigger when less. No day moves over maxChangePct; what doesn't fit is left. " +
      CHANGE,
    opShapes.spread,
    async (input) => safely(() => spread(input)),
  ),
  tool(
    "ingredient_unavailable",
    "An ingredient can't be had (not at the store, ran out). Without `substitute` it previews the planned meals using it. With it, swaps it only in those meals still planned (and uncooked batches, as a recipe variant). " +
      CHANGE,
    opShapes.ingredient_unavailable,
    // Only the meals that now have the substitute: the rest of those days didn't change.
    async (input) => safely(() => ingredientUnavailable(input), (s) => !input.substitute || (s.adjusted ?? s.items).some((i) => i.name === input.substitute!.name)),
  ),
  tool(
    "no_time_to_cook",
    "No time to cook a meal ('hoy no cocino'); see strategy. " + CHANGE,
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
    "Swap the remaining planned meals of two days (e.g. the training-day menu onto the day they now train). Eaten or skipped meals stay. " + CHANGE,
    opShapes.swap_days,
    async (input) => safely(() => swapDays(input)),
  ),
  tool(
    "fill_slot",
    "Plan what a slot should be (to record what was eaten: log_meal): items, portions of a recipe cooked that day, a prep batch portion, or an eat_out budget. Adds the slot if the day has none for that meal. " +
      CHANGE,
    opShapes.fill,
    async (input) => safely(() => fillSlot(input)),
  ),
  tool(
    "create_recipe",
    "Save a recipe (ingredients for the whole pot). Returns it with perServing macros. Use with fill_slot (cooked that day) or schedule_prep (a batch for several days).",
    recipeShape,
    async (input) => safely(() => createRecipe(input)),
  ),
  tool(
    "list_recipes",
    "Saved recipes, newest first: ingredients, servings, prepMinutes, batch, perServing macros; variantOf on versions made by swapping an ingredient.",
    {},
    async () => safely(() => listRecipes()),
  ),
  tool(
    "suggest_prep_days",
    "Where a cooking batch fits in the coming days, best first: per day free minutes from 16:00 to an hour before bed, best window, busy blocks, training, cooking its meals need; tight-day meals a batch could cover; batch-friendly recipes. To propose prep days; schedule_prep once they agree.",
    { from: dateString.optional(), days: z.number().int().min(3).max(14).default(7) },
    async ({ from, days }) => safely(() => suggestPrepDays(from ?? localDate(), days)),
  ),
  tool(
    "schedule_prep",
    "Plan a batch: cook recipeId on cookDate, a portion to each slot in `assign` (replacing what they had); the rest stay free as leftovers. The shopping list asks for the whole batch once. " +
      CHANGE,
    opShapes.schedule_prep,
    async (input) => safely(() => schedulePrep(input)),
  ),
  tool(
    "mark_prep_cooked",
    "The person cooked a batch (cooked true) or not yet (false). " + CHANGE,
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
    "Undo a plan change: the latest by default, or `id` from list_plan_changes (refused while a later change touches the same days: undo that first). Restores the slots, adjustments and batches and rebuilds the shopping list.",
    { id: z.string().optional() },
    async ({ id }) => safely(() => undo(id)),
  ),
];
