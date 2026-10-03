/**
 * Zod shapes for the dated plan's changes, shared by the Coach's tools (raw
 * shapes) and the phone and web routes (`planOpSchema`, one body per op).
 */
import { z } from "zod";
import { dateString, macroShape, planItem, slot } from "./inputs";

/** Hard bound on how much any one day moves when compensating, as a % of its goal. */
export const MAX_DAY_CHANGE_PCT = 15;

const where = {
  date: dateString.optional().describe("Local day; default today"),
  slot: slot.optional().describe("Required unless slotId"),
  slotId: z.string().optional().describe("From get_diet_horizon; needed only when a day has two snacks"),
};

const compensate = {
  compensate: z
    .enum(["none", "day", "spread"])
    .default("none")
    .describe("none (minor slip), day (rebalance the rest of that day), spread (over the next days)"),
  spreadDays: z.number().int().min(1).max(7).default(3).describe("For spread"),
  maxChangePct: z.number().min(1).max(MAX_DAY_CHANGE_PCT).default(MAX_DAY_CHANGE_PCT).describe("Most any day may move, % of its kcal goal"),
};

export const fillSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("items"),
    name: z.string().trim().max(120).nullish().describe("Dish name"),
    items: z.array(planItem).min(1).max(30).describe("TOTAL macros for each quantity"),
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
  name: z.string().trim().min(1).max(120).describe("In Spanish, e.g. 'Atún al natural'"),
  ratio: z.number().positive().max(5).default(1).describe("Per unit of the original (1 = same grams)"),
  per100: z.object(macroShape).describe("Per 100 g or ml (per serving when the original is in servings)"),
});

export const opShapes = {
  skip: { ...where, ...compensate, note: z.string().trim().max(200).optional() },
  replace: {
    ...where,
    entryIds: z.array(z.string()).max(20).optional().describe("Logged entries eaten instead"),
    what: z.string().trim().max(200).optional().describe("What they ate, in their words, when not logged"),
    ...compensate,
  },
  ate_out: {
    ...where,
    name: z.string().trim().max(120).optional().describe("What and where, in their words"),
    kcal: z.number().min(0).max(5000).optional().describe("Estimate; omit for the planned meal × 1.3"),
    protein: z.number().min(0).max(500).optional().describe("g"),
    carbs: z.number().min(0).max(800).optional().describe("g"),
    fat: z.number().min(0).max(400).optional().describe("g"),
    fiber: z.number().min(0).max(150).optional().describe("g"),
    eatenAt: z.number().int().optional().describe("Epoch ms; default now (midday on another day)"),
    note: z.string().trim().max(200).optional(),
    ...compensate,
  },
  place: {
    entryIds: z.array(z.string()).min(1).max(20).describe("One day's entries"),
    slot: slot.optional().describe("The meal they were"),
    slotId: z.string().optional().describe("From get_diet_horizon"),
    extra: z.boolean().optional().describe("A snack or extra, no planned meal"),
  },
  rebalance: {
    date: where.date,
    swaps: z
      .array(z.object({ slot, name: z.string().max(120).nullish(), items: z.array(planItem).min(1).max(15) }))
      .max(6)
      .optional()
      .describe("Replacement meals for remaining slots; TOTAL macros per item"),
    slots: z.array(slot).max(6).optional().describe("Override which slots are still ahead"),
    note: z.string().trim().max(200).optional().describe("Why, one short Spanish sentence"),
    resetSwaps: z.boolean().optional(),
    maxChangePct: compensate.maxChangePct,
  },
  spread: {
    date: where.date.describe("Day of the deviation (default today); spreading starts the next day"),
    kcal: z.number().min(-5000).max(5000).describe("Eaten minus planned: positive = ate MORE"),
    days: compensate.spreadDays,
    maxChangePct: compensate.maxChangePct,
  },
  ingredient_unavailable: {
    ingredient: z.string().trim().min(1).max(120).describe("In Spanish, e.g. 'salmón'"),
    substitute: substituteSchema.optional().describe("Omit to preview the affected meals"),
    from: dateString.optional().describe("Default today"),
    to: dateString.optional().describe("Default the horizon's end"),
  },
  no_time_to_cook: {
    date: where.date,
    slot: slot.optional().describe("Default: every meal that day needing over 15 min"),
    strategy: z
      .enum(["auto", "leftover", "move", "quick"])
      .default("auto")
      .describe("leftover: a free batch portion cooked by then; move: swap with the same meal on a later no-cook day; quick: `quick`; auto: leftover, else move"),
    toDate: dateString.optional().describe("For move; default the next no-cook day"),
    quick: fillSchema.optional().describe("For quick: what to eat instead"),
  },
  move: {
    ...where,
    toDate: dateString,
    toSlot: slot.optional().describe("Default the same slot; a meal there swaps with it"),
  },
  swap_days: { a: dateString, b: dateString },
  fill: { ...where, fill: fillSchema, note: z.string().trim().max(200).optional() },
  schedule_prep: {
    recipeId: z.string(),
    cookDate: dateString,
    portions: z.number().int().min(1).max(20).describe("Portions it yields"),
    assign: z.array(z.object({ date: dateString, slot })).max(20).default([]).describe("Slots eating a portion each, on or after cookDate"),
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
