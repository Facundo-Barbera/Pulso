import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ShoppingItem, ShoppingList } from "@pulso/contract";
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
  "Returns one line per item («id · name · amount · category · 'a mano' if added by hand · comprado · ya tengo · «note»»), progress = bought/to buy («ya tengo» excluded), stale.";
const RETURNS_CHANGED = "Returns the items it touched, as get_shopping_list lines, and the progress.";

export const shoppingTools = [
  tool(
    "generate_shopping_list",
    "Build the shopping list from the active plan's meals still to eat (and batches to cook) for `days` from `from` (local YYYY-MM-DD, default today), per ingredient, in buyable amounts. " +
      "The same range keeps manual items and the bought / 'ya tengo' marks still needed; a new start date is a new trip (marks reset). Plan changes rebuild it by themselves. " +
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
    "Add items not in the plan ('apunta papel de cocina'). amount is Spanish free text ('2 kg'); category is guessed when omitted. " + RETURNS_CHANGED,
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
    "Change one item by id, only the fields given; pantry true = 'ya tengo' (they have it at home). " + RETURNS_CHANGED,
    { id: z.string(), ...itemPatchSchema.shape },
    async ({ id, ...patch }) => safely(() => changed(updateShoppingItem(id, patch), [id])),
  ),
  tool(
    "check_shopping_items",
    "Mark items bought (checked true) or back to pending (false). " + RETURNS_CHANGED,
    { ids: z.array(z.string()).min(1).max(200), checked: z.boolean().default(true) },
    async ({ ids, checked }) => safely(() => changed(checkShoppingItems(ids, checked), ids)),
  ),
  tool(
    "remove_shopping_items",
    "Delete items by id. For a plan ingredient they already have, prefer pantry true (update_shopping_item): a regeneration brings deleted plan items back. " + RETURNS_CHANGED,
    { ids: z.array(z.string()).min(1).max(200) },
    async ({ ids }) => safely(() => changed(removeShoppingItems(ids), ids)),
  ),
];
