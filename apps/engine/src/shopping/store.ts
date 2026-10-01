import { randomUUID } from "node:crypto";
import {
  SHOPPING_CATEGORIES,
  SHOPPING_CATEGORY_LABELS,
  SHOPPING_MAX_DAYS,
  type ShoppingCategory,
  type ShoppingItem,
  type ShoppingList,
} from "@pulso/contract";
import { z } from "zod";
import { db } from "../db";
import { addDays, localDate } from "../nutrition/dates";
import { activePlan } from "../nutrition/store";
import { aggregate, classify } from "./aggregate";

// Validation shared by the phone routes and the agent tools.
const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
const category = z.enum(SHOPPING_CATEGORIES);
export const generateSchema = z.object({
  days: z.number().int().min(1).max(SHOPPING_MAX_DAYS).default(7),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD").optional(),
});
export const itemInputSchema = z.object({ name: text(80), amount: optText(30), category: category.nullish(), note: optText(200) });
export const itemPatchSchema = z
  .object({ name: text(80), amount: optText(30), category, checked: z.boolean(), pantry: z.boolean(), note: optText(200) })
  .partial();

export class ShoppingError extends Error {
  constructor(
    public code: "not_found" | "no_plan",
    message: string,
  ) {
    super(message);
  }
}

type ItemRow = {
  id: string;
  key: string | null;
  name: string;
  amount: string | null;
  quantity: number | null;
  unit: string | null;
  category: ShoppingCategory;
  source: ShoppingItem["source"];
  checked: number;
  pantry: number;
  note: string | null;
  created_at: number;
  updated_at: number;
};
type ListRow = { plan_id: string | null; plan_name: string | null; from_date: string; days: number; generated_at: number };

const toItem = (r: ItemRow): ShoppingItem => ({
  id: r.id,
  name: r.name,
  amount: r.amount,
  quantity: r.quantity,
  unit: r.unit,
  category: r.category,
  source: r.source,
  checked: r.checked === 1,
  pantry: r.pantry === 1,
  note: r.note,
  updatedAt: r.updated_at,
});

const order = (c: ShoppingCategory) => SHOPPING_CATEGORIES.indexOf(c);
const byAisle = (a: ShoppingItem, b: ShoppingItem) => order(a.category) - order(b.category) || a.name.localeCompare(b.name, "es");

const shortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });

/** The items still to buy, grouped by aisle, ready to paste into a chat. */
export function shareText(items: ShoppingItem[], from: string | null, to: string | null): string {
  const pending = items.filter((i) => !i.checked && !i.pantry);
  const title = from && to ? `Lista de compras (${shortDate(from)} – ${shortDate(to)})` : "Lista de compras";
  if (!pending.length) return `${title}\n\nNada pendiente.`;
  const sections = SHOPPING_CATEGORIES.map((c) => {
    const lines = pending.filter((i) => i.category === c).map((i) => `• ${i.name}${i.amount ? ` — ${i.amount}` : ""}${i.note ? ` (${i.note})` : ""}`);
    return lines.length ? `${SHOPPING_CATEGORY_LABELS[c]}\n${lines.join("\n")}` : null;
  });
  return [title, ...sections.filter(Boolean)].join("\n\n");
}

export function getShoppingList(): ShoppingList {
  const meta = db().query<ListRow, []>("SELECT * FROM shopping_list WHERE id = 1").get();
  const items = db().query<ItemRow, []>("SELECT * FROM shopping_items").all().map(toItem).sort(byAisle);
  const plan = activePlan();
  const to = meta ? addDays(meta.from_date, meta.days - 1) : null;
  const toBuy = items.filter((i) => !i.pantry);
  return {
    from: meta?.from_date ?? null,
    to,
    days: meta?.days ?? null,
    planId: meta?.plan_id ?? null,
    planName: meta?.plan_name ?? null,
    generatedAt: meta?.generated_at ?? null,
    hasPlan: plan !== null,
    stale: meta !== null && plan !== null && plan.id !== meta.plan_id,
    items,
    done: toBuy.filter((i) => i.checked).length,
    total: toBuy.length,
    text: shareText(items, meta?.from_date ?? null, to),
  };
}

/**
 * Rebuilds the plan items for `days` days from `from` (default today). Manual items
 * stay as they are; a plan ingredient that was already on the list keeps its id,
 * name, aisle, bought and "ya tengo" marks, and only its amount is recomputed.
 */
export function generateShoppingList(input: unknown): ShoppingList {
  const { days, from = localDate() } = generateSchema.parse(input ?? {});
  const plan = activePlan();
  if (!plan) throw new ShoppingError("no_plan", "There is no active diet plan to build the list from.");
  const needed = aggregate(plan, from, days);
  const now = Date.now();
  const existing = new Map(
    db()
      .query<ItemRow, []>("SELECT * FROM shopping_items WHERE source = 'plan'")
      .all()
      .map((r) => [r.key, r]),
  );
  db().transaction(() => {
    const keep = new Set(needed.map((n) => n.key));
    for (const [key, row] of existing) if (!keep.has(key!)) db().query("DELETE FROM shopping_items WHERE id = ?").run(row.id);
    for (const n of needed) {
      const row = existing.get(n.key);
      if (row) {
        db()
          .query("UPDATE shopping_items SET amount = ?, quantity = ?, unit = ?, updated_at = ? WHERE id = ?")
          .run(n.amount, n.quantity, n.unit, now, row.id);
      } else {
        db()
          .query(
            "INSERT INTO shopping_items (id, key, name, amount, quantity, unit, category, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'plan', ?, ?)",
          )
          .run(randomUUID(), n.key, n.name, n.amount, n.quantity, n.unit, n.category, now, now);
      }
    }
    db()
      .query("INSERT OR REPLACE INTO shopping_list (id, plan_id, plan_name, from_date, days, generated_at) VALUES (1, ?, ?, ?, ?, ?)")
      .run(plan.id, plan.name, from, days, now);
  })();
  return getShoppingList();
}

/** Adds the person's own items. The aisle is guessed from the name unless given. */
export function addShoppingItems(inputs: unknown[]): ShoppingList {
  const parsed = inputs.map((i) => itemInputSchema.parse(i));
  const now = Date.now();
  db().transaction(() => {
    for (const i of parsed) {
      db()
        .query(
          "INSERT INTO shopping_items (id, name, amount, category, source, note, created_at, updated_at) VALUES (?, ?, ?, ?, 'manual', ?, ?, ?)",
        )
        .run(randomUUID(), i.name, i.amount, i.category ?? classify(i.name), i.note, now, now);
    }
  })();
  return getShoppingList();
}

/** Changes only the given fields. Bought and "ya tengo" exclude each other: setting one clears the other. */
export function updateShoppingItem(id: string, input: unknown): ShoppingList {
  patchItem(id, input);
  return getShoppingList();
}

function patchItem(id: string, input: unknown): void {
  const patch = itemPatchSchema.parse(input ?? {});
  const row = db().query<ItemRow, [string]>("SELECT * FROM shopping_items WHERE id = ?").get(id);
  if (!row) throw new ShoppingError("not_found", `No shopping item ${id}.`);
  const item = { ...toItem(row), ...patch };
  if (patch.checked) item.pantry = false;
  if (patch.pantry) item.checked = false;
  db()
    .query("UPDATE shopping_items SET name = ?, amount = ?, category = ?, checked = ?, pantry = ?, note = ?, updated_at = ? WHERE id = ?")
    .run(item.name, item.amount, item.category, item.checked ? 1 : 0, item.pantry ? 1 : 0, item.note, Date.now(), id);
}

/** Marks items bought (or not). An unknown id fails the whole call, so nothing changes. */
export function checkShoppingItems(ids: string[], checked = true): ShoppingList {
  db().transaction(() => {
    for (const id of ids) patchItem(id, { checked });
  })();
  return getShoppingList();
}

export function removeShoppingItems(ids: string[]): ShoppingList {
  db().transaction(() => {
    for (const id of ids) {
      if (db().query("DELETE FROM shopping_items WHERE id = ?").run(id).changes === 0) throw new ShoppingError("not_found", `No shopping item ${id}.`);
    }
  })();
  return getShoppingList();
}
