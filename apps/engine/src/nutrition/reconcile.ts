/**
 * Planeado → Real. The plan is a suggestion; what was eaten is the truth. Every
 * log finds the day's meal it belongs to and ties to it — as planned when it is
 * the plan's own items, instead of it otherwise — so each meal reads «planned
 * this, ate that» with no ceremony. Small snacks and drinks between meals stay
 * extras. Inferred ties are revisions (undo unties them); deleting the last
 * entry of a meal puts it back to pending. Low level like slots.ts: the store's
 * meal log calls into it, so it must not import the store.
 */
import type { MealEntry, MealSlot } from "@pulso/contract";
import { mealTimesBetween } from "../calendar/store";
import { db } from "../db";
import { nameKey } from "../shopping/aggregate";
import { consume } from "../shopping/pantry";
import { addDays, localDate } from "./dates";
import { sum } from "./macros";
import { revise } from "./revisions";
import { eatenLines, findSlotRow, itemsOf, linksOf, slotOrder, slotRows, slotWithItem, updateSlot, type LinkRow, type SlotRow } from "./slots";

/** A snack or drink under this many kcal, logged without saying which meal, stays an extra. */
export const EXTRA_KCAL = 250;
/** Under this (or drinks only), entries never stand for a meal on their own. */
const TRIVIAL_KCAL = 50;
/** A meal still pending this long after its time reads «sin registrar». */
export const MISSED_AFTER_MIN = 120;

/** When each meal happens when the person set no meal times. */
export const DEFAULT_MEAL_TIMES: Record<MealSlot, string> = {
  desayuno: "08:00",
  media_manana: "11:00",
  comida: "14:00",
  merienda: "17:30",
  cena: "20:30",
  snack: "16:30",
};

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const minuteOfDay = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};

/** Minutes after midnight of each meal on `date`: the person's meal times (calendar), else the defaults. */
export function mealClock(date: string): Record<MealSlot, number> {
  const out = Object.fromEntries(Object.entries(DEFAULT_MEAL_TIMES).map(([s, t]) => [s, toMinutes(t)])) as Record<MealSlot, number>;
  for (const m of mealTimesBetween(date, date)[date] ?? []) out[m.slot] = toMinutes(m.time);
  return out;
}

export type MealWindow = { row: SlotRow; at: number; start: number; end: number };

/**
 * Each of the day's meals owns the hours closest to it: a boundary falls 90 min
 * before the next meal (halfway when they are closer), so with breakfast at 8
 * and lunch at 14 anything before 12:30 is breakfast.
 */
export function mealWindows(rows: SlotRow[], clock: Record<MealSlot, number>): MealWindow[] {
  const timed = rows
    .map((row) => ({ row, at: clock[row.slot] }))
    .sort((a, b) => a.at - b.at || slotOrder(a.row.slot) - slotOrder(b.row.slot) || a.row.position - b.row.position);
  const boundary = (a: { at: number }, b: { at: number }) => b.at - Math.min(90, (b.at - a.at) / 2);
  return timed.map((t, i) => ({
    ...t,
    start: i > 0 ? boundary(timed[i - 1]!, t) : 0,
    end: i < timed.length - 1 ? boundary(t, timed[i + 1]!) : 24 * 60,
  }));
}

export function activePlanId(): string | null {
  return db().query<{ id: string }, []>("SELECT id FROM diet_plans WHERE active = 1 ORDER BY created_at DESC LIMIT 1").get()?.id ?? null;
}

// --- Words ---

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const TITLES: Record<MealSlot, string> = { desayuno: "Desayuno", media_manana: "Media mañana", comida: "Comida", merienda: "Merienda", cena: "Cena", snack: "Snack" };
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const listWords = (words: string[]) => (words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} y ${words.at(-1)}`);
const where = (row: SlotRow) => `${TITLES[row.slot]} del ${WEEKDAYS[new Date(`${row.date}T00:00:00Z`).getUTCDay()]} ${Number(row.date.slice(8))}`;
const signed = (kcal: number) => `${kcal > 0 ? "+" : kcal < 0 ? "−" : "±"}${Math.abs(Math.round(kcal)).toLocaleString("es-ES")}`;
/** What a slot had planned, in a few words. */
export const plannedWords = (row: SlotRow) => lower(row.name ?? listWords(itemsOf(row).map((i) => lower(i.name))));
/** What some entries were, in a few words: "Tortitas de carne de res, queso amarillo y arroz blanco". */
export const eatenWords = (names: string[]) => {
  const text = listWords(names.map((n, i) => (i ? lower(n) : n)));
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// --- Tying entries to meals ---

export type Logged = Pick<MealEntry, "id" | "date" | "eatenAt" | "slot" | "name" | "quantity" | "unit" | "kcal" | "planItemId">;
type EntryRow = Logged & { protein: number; carbs: number; fat: number; fiber: number };

const ENTRY_COLUMNS = "id, date, eaten_at AS eatenAt, slot, name, quantity, unit, kcal, protein, carbs, fat, fiber, plan_item_id AS planItemId";

/** Entries logged on `date` that no meal holds, oldest first; pinned extras left out unless asked. */
export function looseEntries(date: string, withPinned = false): EntryRow[] {
  return db()
    .query<EntryRow, [string]>(
      `SELECT ${ENTRY_COLUMNS} FROM meal_entries m WHERE date = ? AND NOT EXISTS (SELECT 1 FROM meal_slot_links l WHERE l.entry_id = m.id)
       ${withPinned ? "" : "AND NOT EXISTS (SELECT 1 FROM meal_entry_pins p WHERE p.entry_id = m.id)"} ORDER BY eaten_at`,
    )
    .all(date);
}

const plannedOnly = (row: SlotRow, links: LinkRow[]) => {
  const own = links.filter((l) => l.slot_id === row.id);
  return own.length > 0 && own.every((l) => l.role === "planned");
};

/** True when nothing but drinks or nothing at all was eaten on `date` before `before`. */
function firstFood(date: string, before: number): boolean {
  return !db().query<{ n: number }, [string, number]>("SELECT 1 AS n FROM meal_entries WHERE date = ? AND eaten_at < ? AND unit != 'ml' LIMIT 1").get(date, before);
}

/**
 * The meal a group of entries eaten together belongs to, or null for an extra:
 * the slot given; the slot holding its plan item; the meal the entry was logged
 * as (lunch is lunch even at 16:00); else the meal whose window holds the time —
 * unless it is a small snack or drink, or that meal was already eaten as planned.
 * The first food of the day in the first meal's window is that meal whatever its
 * size; a coffee or a diet soda never is.
 */
export function placeFor(group: Logged[], slotId: string | null = null): { row: SlotRow; inferred: boolean } | null {
  if (slotId) {
    const row = findSlotRow(slotId);
    return row ? { row, inferred: false } : null;
  }
  const first = group[0]!;
  const withItem = group.find((e) => e.planItemId);
  const byItem = withItem ? slotWithItem(first.date, withItem.planItemId!) : null;
  if (byItem) return { row: byItem, inferred: false };
  const planId = activePlanId();
  if (!planId) return null;
  const rows = slotRows(planId, first.date);
  if (!rows.length) return null;
  const links = linksOf(rows.map((r) => r.id));
  const kcal = sum(group as EntryRow[]).kcal;
  // A coffee or a diet soda is never a meal, whatever it was logged as.
  const trivial = kcal < TRIVIAL_KCAL || group.every((e) => e.unit === "ml");
  const same = first.slot === "snack" || trivial ? [] : rows.filter((r) => r.slot === first.slot);
  if (same.length) {
    const open = same.find((r) => !plannedOnly(r, links));
    return open ? { row: open, inferred: true } : null;
  }
  const windows = mealWindows(rows, mealClock(first.date));
  const minute = minuteOfDay(first.eatenAt);
  const window = windows.find((w) => minute >= w.start && minute < w.end);
  if (!window || window.row.status === "skipped" || plannedOnly(window.row, links)) return null;
  const opensTheDay = window === windows[0] && !trivial && firstFood(first.date, first.eatenAt);
  if (kcal < EXTRA_KCAL && !opensTheDay) return null;
  return { row: window.row, inferred: true };
}

/**
 * A slot's stored status after its links changed: replaced while anything
 * eaten instead is tied to it; otherwise back to planned (eaten is derived from
 * planned links), a skip kept only while nothing is tied.
 */
export function settle(slotId: string): void {
  const row = findSlotRow(slotId);
  if (!row) return;
  const own = linksOf([slotId]);
  const status = own.some((l) => l.role === "replacement") ? "replaced" : own.length || row.status === "replaced" ? "planned" : row.status;
  if (status !== row.status) updateSlot(slotId, { status });
}

/**
 * Ties entries to a slot: plan items as planned (using up the pantry), anything
 * else instead of it. A plan item is one logged from the plan (a swapped item of
 * the Coach's adjustment has an id of its own) or one named like the slot's foods
 * ("Avena" for the planned avena, told to the Coach).
 */
export function tie(entries: Logged[], row: SlotRow, forceReplacement = false): void {
  const planned = new Set([row.name, ...itemsOf(row).map((i) => i.name)].filter((n): n is string => !!n).map(nameKey));
  for (const e of entries) {
    const asPlanned = !forceReplacement && (!!e.planItemId || planned.has(nameKey(e.name)));
    db().query("DELETE FROM meal_entry_pins WHERE entry_id = ?").run(e.id);
    db().query("INSERT OR REPLACE INTO meal_slot_links (entry_id, slot_id, role) VALUES (?, ?, ?)").run(e.id, row.id, asPlanned ? "planned" : "replacement");
    if (asPlanned) consume(eatenLines(e, row));
  }
  settle(row.id);
}

/** Unties entries from their meals (before deleting or moving them); each meal left settles. */
export function untie(entryIds: string[]): string[] {
  if (!entryIds.length) return [];
  const marks = entryIds.map(() => "?").join(",");
  const slots = db().query<{ slot_id: string }, string[]>(`SELECT DISTINCT slot_id FROM meal_slot_links WHERE entry_id IN (${marks})`).all(...entryIds).map((r) => r.slot_id);
  db().query(`DELETE FROM meal_slot_links WHERE entry_id IN (${marks})`).run(...entryIds);
  for (const id of slots) settle(id);
  return slots;
}

/** One line for what tying did, e.g. "Comida del mié 1: tortitas de carne de res y arroz blanco en vez de pasta boloñesa (+348 kcal)." */
function tieSummary(row: SlotRow, entries: Logged[], before: LinkRow[]): string {
  const what = lower(eatenWords(entries.map((e) => e.name)));
  const after = linksOf([row.id]);
  if (before.length) return `${where(row)}: también ${what}.`;
  if (after.every((l) => l.role === "planned")) return `${where(row)}: como estaba planeado.`;
  const eaten = sum(entries as EntryRow[]).kcal;
  const planned = sum(itemsOf(row)).kcal;
  return `${where(row)}: ${what} en vez de ${plannedWords(row)} (${signed(eaten - planned)} kcal).`;
}

/**
 * Finds and ties the meal a group of entries eaten together belongs to. An
 * explicit slot as planned is the person ticking the plan and leaves no
 * revision; anything inferred or eaten instead is a revision undo can untie.
 * Returns the slot id, or null when the entries stay extras.
 */
export function reconcileGroup(group: Logged[], slotId: string | null = null, offPlan = false): string | null {
  if (!group.length) return null;
  const place = placeFor(group, slotId);
  if (!place) return null;
  const { row } = place;
  const replaces = offPlan || group.some((e) => !e.planItemId);
  // Ticking the plan's own slot is no change to the plan.
  if (!place.inferred && !replaces) {
    tie(group, row);
    return row.id;
  }
  revise({ planId: row.plan_id, op: "log", dates: [row.date] }, () => {
    const before = linksOf([row.id]);
    tie(group, row, offPlan && !!slotId);
    return { summary: tieSummary(row, group, before) };
  });
  return row.id;
}

/** Groups entries logged together (same day, time and meal) in eating order. */
export function eatenTogether<T extends Logged>(entries: T[]): T[][] {
  const groups: T[][] = [];
  for (const e of [...entries].sort((a, b) => a.eatenAt - b.eatenAt)) {
    const last = groups.at(-1)?.[0];
    if (last && last.date === e.date && last.eatenAt === e.eatenAt && last.slot === e.slot) groups.at(-1)!.push(e);
    else groups.push([e]);
  }
  return groups;
}

// --- Backfill ---

const REPAIR = "reconcile-backlog";
const repaired = new WeakSet<object>();

/**
 * Ties entries logged before reconciling existed (two weeks back, on dates the
 * active plan laid out) to their meals, as if they had just been logged.
 * Idempotent: tied entries and pinned extras are left alone. Returns how many
 * groups found a meal.
 */
export function reconcileBacklog(today = localDate(), days = 14): number {
  const planId = activePlanId();
  if (!planId) return 0;
  const dates = db()
    .query<{ date: string }, [string, string, string]>("SELECT date FROM plan_days WHERE plan_id = ? AND date BETWEEN ? AND ? ORDER BY date")
    .all(planId, addDays(today, 1 - days), today)
    .map((r) => r.date);
  let tied = 0;
  for (const date of dates) {
    for (const group of eatenTogether(looseEntries(date))) if (reconcileGroup(group)) tied++;
  }
  return tied;
}

/** Runs the backfill once per database, the first time a day is read with an active plan. */
export function repairOnce(): void {
  const database = db();
  if (repaired.has(database)) return;
  if (!activePlanId()) return;
  repaired.add(database);
  if (database.query("SELECT 1 FROM nutrition_repairs WHERE name = ?").get(REPAIR)) return;
  database.transaction(() => {
    reconcileBacklog();
    database.query("INSERT OR IGNORE INTO nutrition_repairs (name, ran_at) VALUES (?, ?)").run(REPAIR, Date.now());
  })();
}
