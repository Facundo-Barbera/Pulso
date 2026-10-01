/**
 * Zod shapes for the dated plan's changes, shared by the Coach's tools (raw
 * shapes) and the phone and web routes (`planOpSchema`, one body per op).
 */
import { z } from "zod";
import { dateString, macroShape, planItem, slot } from "./inputs";

/** Hard bound on how much any one day moves when compensating, as a % of its goal. */
export const MAX_DAY_CHANGE_PCT = 15;

const where = {
  date: dateString.optional().describe("Local day (YYYY-MM-DD). Defaults to today"),
  slot: slot.optional().describe("Meal slot on that day; required unless slotId is given"),
  slotId: z.string().optional().describe("Exact slot id from get_diet_horizon (needed only when a day has two snacks)"),
};

const compensate = {
  compensate: z
    .enum(["none", "day", "spread"])
    .default("none")
    .describe("How to make up for the difference: none (minor slip, let it go), day (rebalance the rest of that day), spread (over the next days)"),
  spreadDays: z.number().int().min(1).max(7).default(3).describe("Days to spread over when compensate = spread"),
  maxChangePct: z.number().min(1).max(MAX_DAY_CHANGE_PCT).default(MAX_DAY_CHANGE_PCT).describe(`Most any day may move, % of its kcal goal (max ${MAX_DAY_CHANGE_PCT})`),
};

export const fillSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("items"),
    name: z.string().trim().max(120).nullish().describe("Dish name"),
    items: z.array(planItem).min(1).max(30).describe("Foods with quantity and the TOTAL macros for that quantity"),
  }),
  z.object({ kind: z.literal("recipe"), recipeId: z.string(), portions: z.number().positive().max(10).default(1) }),
  z.object({ kind: z.literal("prep"), prepId: z.string(), portions: z.number().positive().max(10).default(1) }),
  z.object({
    kind: z.literal("eat_out"),
    name: z.string().trim().max(120).nullish().describe("e.g. 'Cena con amigos'"),
    ...macroShape,
  }),
]);
export type Fill = z.infer<typeof fillSchema>;

export const substituteSchema = z.object({
  name: z.string().trim().min(1).max(120).describe("What to use instead, in Spanish, e.g. 'Atún en conserva al natural'"),
  ratio: z.number().positive().max(5).default(1).describe("Amount of substitute per unit of the original (1 = same grams)"),
  per100: z
    .object(macroShape)
    .describe("Macros of the substitute per 100 g or 100 ml (per 1 serving when the original is counted in servings): kcal and grams"),
});

export const opShapes = {
  skip: { ...where, ...compensate, note: z.string().trim().max(200).optional() },
  replace: {
    ...where,
    entryIds: z.array(z.string()).max(20).optional().describe("Logged entries (from log_meal) eaten instead"),
    what: z.string().trim().max(200).optional().describe("What was eaten instead, in the person's words, when not logged"),
    ...compensate,
  },
  ate_out: {
    ...where,
    name: z.string().trim().max(120).optional().describe("What and where, in the person's words, e.g. 'Tacos al pastor con amigos'"),
    kcal: z.number().min(0).max(5000).optional().describe("Estimated kcal of what they ate; omit to estimate as the planned meal × 1.3"),
    protein: z.number().min(0).max(500).optional().describe("Grams, with kcal"),
    carbs: z.number().min(0).max(800).optional().describe("Grams, with kcal"),
    fat: z.number().min(0).max(400).optional().describe("Grams, with kcal"),
    fiber: z.number().min(0).max(150).optional().describe("Grams, with kcal"),
    eatenAt: z.number().int().optional().describe("Epoch ms; default now (or midday for another day)"),
    note: z.string().trim().max(200).optional(),
    ...compensate,
  },
  place: {
    entryIds: z.array(z.string()).min(1).max(20).describe("Logged entries of one day (list_meals ids)"),
    slot: slot.optional().describe("The meal they were, on their day (desayuno, comida…)"),
    slotId: z.string().optional().describe("Exact slot id from get_diet_horizon"),
    extra: z.boolean().optional().describe("true: they were a snack or extra, not any planned meal"),
  },
  rebalance: {
    date: where.date,
    swaps: z
      .array(z.object({ slot, name: z.string().max(120).nullish(), items: z.array(planItem).min(1).max(15) }))
      .max(6)
      .optional()
      .describe("Replacement meals for some remaining slots; macros are totals per item"),
    slots: z.array(slot).max(6).optional().describe("Override which slots are still ahead, only if the default is wrong"),
    note: z.string().trim().max(200).optional().describe("Why, in one short Spanish sentence"),
    resetSwaps: z.boolean().optional(),
    maxChangePct: compensate.maxChangePct,
  },
  spread: {
    date: where.date.describe("The day the deviation happened (YYYY-MM-DD); spreading starts the day after. Defaults to today"),
    kcal: z.number().min(-5000).max(5000).describe("The deviation in kcal: positive when the person ate MORE than planned, negative when less"),
    days: compensate.spreadDays,
    maxChangePct: compensate.maxChangePct,
  },
  ingredient_unavailable: {
    ingredient: z.string().trim().min(1).max(120).describe("What can't be had, in Spanish, e.g. 'salmón'"),
    substitute: substituteSchema.optional().describe("Omit to preview the affected meals"),
    from: dateString.optional().describe("First day to change (default today)"),
    to: dateString.optional().describe("Last day to change (default the end of the plan's horizon)"),
  },
  no_time_to_cook: {
    date: where.date,
    slot: slot.optional().describe("The meal they can't cook; default every meal that day that needs more than 15 min"),
    strategy: z
      .enum(["auto", "leftover", "move", "quick"])
      .default("auto")
      .describe("leftover: a portion from a batch already planned or cooked; move: swap with the same meal on a later day that needs no cooking; quick: the fill you give; auto: leftover, else move"),
    toDate: dateString.optional().describe("For move: the day to swap with (default the next one that needs no cooking)"),
    quick: fillSchema.optional().describe("For quick: what to eat instead (items, a quick recipe, or eat_out)"),
  },
  move: {
    ...where,
    toDate: dateString.describe("Day to move it to"),
    toSlot: slot.optional().describe("Slot on that day (default the same slot). If it holds a meal, the two swap"),
  },
  swap_days: { a: dateString, b: dateString },
  fill: { ...where, fill: fillSchema, note: z.string().trim().max(200).optional() },
  schedule_prep: {
    recipeId: z.string(),
    cookDate: dateString.describe("Day they cook the batch"),
    portions: z.number().int().min(1).max(20).describe("Portions the batch yields"),
    assign: z.array(z.object({ date: dateString, slot })).max(20).default([]).describe("Slots that eat a portion each, on or after cookDate"),
  },
  prep_cooked: { prepId: z.string(), cooked: z.boolean().default(true) },
  use_leftover: { prepId: z.string(), date: dateString, slot },
} as const;

export type OpName = keyof typeof opShapes;
export const OP_NAMES = Object.keys(opShapes) as OpName[];

/** A route body: `{ op, ...fields }`. */
export const planOpSchema = z.discriminatedUnion(
  "op",
  OP_NAMES.map((op) => z.object({ op: z.literal(op), ...opShapes[op] })) as unknown as [z.ZodObject<{ op: z.ZodLiteral<OpName> }>, ...z.ZodObject<{ op: z.ZodLiteral<OpName> }>[]],
);

export type OpInput<K extends OpName> = z.infer<z.ZodObject<(typeof opShapes)[K]>>;
