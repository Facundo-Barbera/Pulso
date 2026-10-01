import { tool } from "@anthropic-ai/claude-agent-sdk";
import { SHOPPING_CATEGORIES } from "@pulso/contract";
import { z } from "zod";
import {
  addShoppingItems,
  checkShoppingItems,
  generateSchema,
  generateShoppingList,
  getShoppingList,
  itemInputSchema,
  itemPatchSchema,
  removeShoppingItems,
  updateShoppingItem,
} from "./store";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

async function safely(run: () => unknown) {
  try {
    return json(await run());
  } catch (error) {
    return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
}

const RETURNS =
  "Returns the whole list: items (id, name, amount as shown e.g. '1,4 kg' / '2 L' / '12', the plan's raw need in quantity+unit, " +
  `category, source plan|manual, checked = bought, pantry = 'ya tengo'), done/total progress and a plain-text version. ` +
  `Categories: ${SHOPPING_CATEGORIES.join(", ")}.`;

export const shoppingTools = [
  tool(
    "generate_shopping_list",
    "Builds the shopping list from the active diet plan for the next `days` days (default 7; the app offers 3, 7 or 14) starting `from` " +
      "(local YYYY-MM-DD, default today): adds up the dated plan's meals still to eat (and whole prep batches still to cook) per ingredient, " +
      "rounds up to buyable amounts. Regenerating the same range keeps the person's manual items and " +
      "the bought / 'ya tengo' marks of ingredients still needed; a new start date is a new trip (marks reset). " +
      "Plan changes (ingredient_unavailable, schedule_prep…) rebuild it by themselves. " +
      "Use it after creating a new plan when the person accepts, or when they ask for the list. " +
      RETURNS,
    generateSchema.shape,
    async (input) => safely(() => generateShoppingList(input)),
  ),
  tool(
    "get_shopping_list",
    "The current shopping list. stale = true when the active plan changed since it was generated (offer to regenerate). " + RETURNS,
    {},
    async () => safely(() => getShoppingList()),
  ),
  tool(
    "add_shopping_items",
    "Adds items the person needs that are not in the plan (e.g. 'apunta papel de cocina y café'). amount is free text in Spanish " +
      "('2 kg', '1 paquete'); category is guessed from the name when omitted. " +
      RETURNS,
    { items: z.array(itemInputSchema).min(1).max(50) },
    async ({ items }) => safely(() => addShoppingItems(items)),
  ),
  tool(
    "update_shopping_item",
    "Changes fields of one item by id (only the ones given): rename, change the amount text, move it to another category when it is " +
      "in the wrong aisle, add a note, or set pantry = true when the person already has it at home ('ya tengo')." +
      RETURNS,
    { id: z.string().describe("Item id from get_shopping_list."), ...itemPatchSchema.shape },
    async ({ id, ...patch }) => safely(() => updateShoppingItem(id, patch)),
  ),
  tool(
    "check_shopping_items",
    "Marks items as bought (checked = true) or back to pending (false), e.g. when the person says what they already bought. " + RETURNS,
    { ids: z.array(z.string()).min(1).max(200), checked: z.boolean().default(true) },
    async ({ ids, checked }) => safely(() => checkShoppingItems(ids, checked)),
  ),
  tool(
    "remove_shopping_items",
    "Deletes items from the list by id. Prefer update_shopping_item with pantry = true for a plan ingredient the person already has, " +
      "since a regeneration would bring a deleted plan item back. " +
      RETURNS,
    { ids: z.array(z.string()).min(1).max(200) },
    async ({ ids }) => safely(() => removeShoppingItems(ids)),
  ),
];
