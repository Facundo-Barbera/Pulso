import { tool } from "@anthropic-ai/claude-agent-sdk";
import { SHOPPING_CATEGORIES, type ShoppingItem, type ShoppingList } from "@pulso/contract";
import { z } from "zod";
import { withCard } from "../agent/card";
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

/** `<id> · Pechuga de pollo · 1,4 kg · carne · comprado`: one item as the Coach reads it. */
const itemLine = (i: ShoppingItem) =>
  [i.id, i.name, i.amount, i.category, i.source === "manual" && "a mano", i.checked && "comprado", i.pantry && "ya tengo", i.note && `«${i.note}»`].filter(Boolean).join(" · ");

/** The whole list for the Coach: one line per item, no plain-text copy. */
const listForCoach = (l: ShoppingList) => ({
  from: l.from,
  to: l.to,
  planName: l.planName,
  stale: l.stale,
  progress: `${l.done}/${l.total}`,
  items: l.items.map(itemLine),
});

/** After an edit: only the items it touched (or how many went) and the progress; the card gets the whole list. */
const changed = (l: ShoppingList, ids: string[]) => {
  const items = l.items.filter((i) => ids.includes(i.id));
  return withCard({ changed: items.map(itemLine), ...(items.length < ids.length ? { removed: ids.length - items.length } : {}), progress: `${l.done}/${l.total}`, stale: l.stale }, l);
};

async function safely(run: () => unknown) {
  try {
    const value = await run();
    return value && typeof value === "object" && "content" in value ? (value as ReturnType<typeof json>) : json(value);
  } catch (error) {
    return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
}

const RETURNS =
  "Returns the whole list: one line per item («id · name · amount as shown, e.g. '1,4 kg' / '2 L' / '12' · category · 'a mano' when added by hand · comprado · ya tengo · «note»»), progress = bought/to buy («ya tengo» excluded), stale. " +
  `Categories: ${SHOPPING_CATEGORIES.join(", ")}.`;
const RETURNS_CHANGED = "Returns only the items it touched, as lines like get_shopping_list's, and the progress.";

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
    async (input) => safely(() => listForCoach(generateShoppingList(input))),
  ),
  tool(
    "get_shopping_list",
    "The current shopping list. stale = true when the active plan changed since it was generated (offer to regenerate). " + RETURNS,
    {},
    async () => safely(() => listForCoach(getShoppingList())),
  ),
  tool(
    "add_shopping_items",
    "Adds items the person needs that are not in the plan (e.g. 'apunta papel de cocina y café'). amount is free text in Spanish " +
      "('2 kg', '1 paquete'); category is guessed from the name when omitted. " +
      RETURNS_CHANGED,
    { items: z.array(itemInputSchema).min(1).max(50) },
    async ({ items }) =>
      safely(() => {
        const before = new Set(getShoppingList().items.map((i) => i.id));
        const list = addShoppingItems(items);
        return changed(list, list.items.filter((i) => !before.has(i.id)).map((i) => i.id));
      }),
  ),
  tool(
    "update_shopping_item",
    "Changes fields of one item by id (only the ones given): rename, change the amount text, move it to another category when it is " +
      "in the wrong aisle, add a note, or set pantry = true when the person already has it at home ('ya tengo'). " +
      RETURNS_CHANGED,
    { id: z.string().describe("Item id from get_shopping_list."), ...itemPatchSchema.shape },
    async ({ id, ...patch }) => safely(() => changed(updateShoppingItem(id, patch), [id])),
  ),
  tool(
    "check_shopping_items",
    "Marks items as bought (checked = true) or back to pending (false), e.g. when the person says what they already bought. " + RETURNS_CHANGED,
    { ids: z.array(z.string()).min(1).max(200), checked: z.boolean().default(true) },
    async ({ ids, checked }) => safely(() => changed(checkShoppingItems(ids, checked), ids)),
  ),
  tool(
    "remove_shopping_items",
    "Deletes items from the list by id. Prefer update_shopping_item with pantry = true for a plan ingredient the person already has, " +
      "since a regeneration would bring a deleted plan item back. " +
      RETURNS_CHANGED,
    { ids: z.array(z.string()).min(1).max(200) },
    async ({ ids }) => safely(() => changed(removeShoppingItems(ids), ids)),
  ),
];
