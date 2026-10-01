/**
 * The pantry: what is at home. Ticking an item bought or «Ya tengo» on the
 * list stocks it (linked to that item, so unticking takes it back); the person
 * or the Coach can add things by hand. Eating planned meals and cooking prep
 * batches use it up. Amounts are an estimate, never a blocker.
 */
import { randomUUID } from "node:crypto";
import type { PantryItem, ShoppingCategory } from "@pulso/contract";
import { z } from "zod";
import { db } from "../db";
import { localDate } from "../nutrition/dates";
import { buyable, classify, lineKey, nameKey, type Line } from "./aggregate";
import { ShoppingError } from "./errors";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
export const pantryInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  quantity: z.number().positive().max(100000).nullish(),
  unit: z.string().trim().min(1).max(20).nullish(),
  expiresOn: dateString.nullish(),
});
export const pantryPatchSchema = z
  .object({ name: z.string().trim().min(1).max(80), quantity: z.number().min(0).max(100000).nullable(), unit: z.string().trim().max(20).nullable(), expiresOn: dateString.nullable() })
  .partial();

type PantryRow = {
  id: string;
  key: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  category: ShoppingCategory;
  source: PantryItem["source"];
  shopping_item_id: string | null;
  bought_on: string | null;
  expires_on: string | null;
  created_at: number;
  updated_at: number;
};

const toItem = (r: PantryRow): PantryItem => ({
  id: r.id,
  name: r.name,
  quantity: r.quantity === null ? null : Math.round(r.quantity * 10) / 10,
  unit: r.unit,
  amount: r.quantity === null ? null : r.quantity > 0 ? buyable(r.quantity, r.unit ?? "ud", r.key.split("|")[0]) : "0",
  category: r.category,
  source: r.source,
  shoppingItemId: r.shopping_item_id,
  boughtOn: r.bought_on,
  expiresOn: r.expires_on,
  updatedAt: r.updated_at,
});

/** Key and base amount the way the list counts it; a name alone keys on the name. */
function keyed(name: string, quantity: number | null | undefined, unit: string | null | undefined) {
  const line = quantity ? lineKey({ name, quantity, unit: unit ?? "g" }) : null;
  return line ?? { key: `${nameKey(name)}|${unit ?? ""}`, quantity: quantity ?? null, unit: unit ?? null };
}

export function listPantry(): PantryItem[] {
  return db()
    .query<PantryRow, []>("SELECT * FROM pantry_items WHERE quantity IS NULL OR quantity > 0 ORDER BY name")
    .all()
    .map(toItem)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function addPantryItems(inputs: unknown[], today = localDate()): PantryItem[] {
  const parsed = inputs.map((i) => pantryInputSchema.parse(i));
  const now = Date.now();
  db().transaction(() => {
    for (const i of parsed) {
      const base = keyed(i.name, i.quantity, i.unit);
      db()
        .query(
          `INSERT INTO pantry_items (id, key, name, quantity, unit, category, source, bought_on, expires_on, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?)`,
        )
        .run(randomUUID(), base.key, i.name, base.quantity, base.unit, classify(i.name), today, i.expiresOn ?? null, now, now);
    }
  })();
  return listPantry();
}

export function updatePantryItem(id: string, input: unknown): PantryItem[] {
  const patch = pantryPatchSchema.parse(input ?? {});
  const row = db().query<PantryRow, [string]>("SELECT * FROM pantry_items WHERE id = ?").get(id);
  if (!row) throw new ShoppingError("not_found", `No pantry item ${id}.`);
  const name = patch.name ?? row.name;
  const quantity = patch.quantity !== undefined ? patch.quantity : row.quantity;
  const unit = patch.unit !== undefined ? patch.unit : row.unit;
  const key = patch.name !== undefined || patch.unit !== undefined ? keyed(name, quantity || 1, unit).key : row.key;
  db()
    .query("UPDATE pantry_items SET name = ?, key = ?, quantity = ?, unit = ?, expires_on = ?, updated_at = ? WHERE id = ?")
    .run(name, key, quantity, unit, patch.expiresOn !== undefined ? patch.expiresOn : row.expires_on, Date.now(), id);
  return listPantry();
}

export function removePantryItems(ids: string[]): PantryItem[] {
  db().transaction(() => {
    for (const id of ids) {
      if (db().query("DELETE FROM pantry_items WHERE id = ?").run(id).changes === 0) throw new ShoppingError("not_found", `No pantry item ${id}.`);
    }
  })();
  return listPantry();
}

// --- Fed by the shopping list ---

type ListItem = { id: string; key: string | null; name: string; quantity: number | null; unit: string | null; category: ShoppingCategory };

/** A shopping item ticked bought or «Ya tengo»: it is at home now, in the amount the list asked for. */
export function stockFromList(item: ListItem, today = localDate()): void {
  const now = Date.now();
  const key = item.key ?? keyed(item.name, null, null).key;
  db()
    .query(
      `INSERT INTO pantry_items (id, key, name, quantity, unit, category, source, shopping_item_id, bought_on, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'list', ?, ?, ?, ?)
       ON CONFLICT (shopping_item_id) DO UPDATE SET quantity = excluded.quantity, unit = excluded.unit, updated_at = excluded.updated_at`,
    )
    .run(randomUUID(), key, item.name, item.quantity, item.unit, item.category, item.id, today, now, now);
}

/** Unticked: what that tick put in the pantry goes away. */
export function unstockFromList(itemId: string): void {
  db().query("DELETE FROM pantry_items WHERE shopping_item_id = ?").run(itemId);
}

/** A new shopping trip: what the last list's ticks stocked becomes plain pantry. */
export function releaseListLinks(): void {
  db().query("UPDATE pantry_items SET shopping_item_id = NULL WHERE shopping_item_id IS NOT NULL").run();
}

/**
 * What is at home that the current list does not already account for, by key.
 * Infinity for rows without an amount ("tengo sal").
 */
export function freeStock(): Map<string, number> {
  const out = new Map<string, number>();
  const rows = db().query<{ key: string; quantity: number | null }, []>("SELECT key, quantity FROM pantry_items WHERE shopping_item_id IS NULL").all();
  for (const r of rows) out.set(r.key, (out.get(r.key) ?? 0) + (r.quantity === null ? Infinity : r.quantity));
  return out;
}

/**
 * Uses up what `lines` need: plain pantry first (oldest first), then what this
 * list's ticks stocked. Rows without an amount are never used up. Emptied plain
 * rows are deleted; list rows stay at 0 so the tick keeps its link.
 */
export function consume(lines: Line[]): void {
  const select = db().query<PantryRow, [string]>(
    "SELECT * FROM pantry_items WHERE key = ? AND quantity > 0 ORDER BY shopping_item_id IS NOT NULL, created_at",
  );
  const now = Date.now();
  for (const line of lines) {
    const base = lineKey(line);
    if (!base) continue;
    let left = base.quantity;
    for (const row of select.all(base.key)) {
      if (left <= 0) break;
      const used = Math.min(left, row.quantity!);
      left -= used;
      const rest = row.quantity! - used;
      if (rest <= 1e-6 && row.shopping_item_id === null) db().query("DELETE FROM pantry_items WHERE id = ?").run(row.id);
      else db().query("UPDATE pantry_items SET quantity = ?, updated_at = ? WHERE id = ?").run(Math.max(0, rest), now, row.id);
    }
  }
}

/** Pantry things in the same aisle as `ingredient`, other than it: candidates to stand in for it. */
export function pantryAlternatives(ingredient: string): PantryItem[] {
  const category = classify(ingredient);
  const own = nameKey(ingredient);
  return listPantry().filter((p) => p.category === category && nameKey(p.name) !== own);
}

/** Every row as stored, for a revision snapshot. */
export const pantrySnapshot = (): PantryRow[] => db().query<PantryRow, []>("SELECT * FROM pantry_items").all();

export function restorePantry(rows: PantryRow[]): void {
  db().query("DELETE FROM pantry_items").run();
  const insert = db().query(
    `INSERT INTO pantry_items (id, key, name, quantity, unit, category, source, shopping_item_id, bought_on, expires_on, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT id FROM shopping_items WHERE id = ?), ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    insert.run(r.id, r.key, r.name, r.quantity, r.unit, r.category, r.source, r.shopping_item_id, r.bought_on, r.expires_on, r.created_at, r.updated_at);
  }
}
