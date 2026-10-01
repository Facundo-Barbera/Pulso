/**
 * The one-off repair that turns foods logged together before dishes existed
 * into dishes: the same day and meal, logged within a few minutes of each other
 * (one request, or the same time said twice). A food that says it went into a
 * shake ("Fresas (5 medianas, en el batido)") joins the shake logged closest to
 * it that day. Names come from the plan meal they were eaten as, when it was
 * exactly that, else from the foods (dishes.ts). Totals do not change: the
 * entries stay as they were, now as components. Idempotent.
 */
import { db } from "../db";
import { attachDish, dishName } from "./dishes";
import { tie, type Logged } from "./reconcile";
import { findSlotRow } from "./slots";

const REPAIR = "dishes-backfill";
const TOGETHER_MS = 5 * 60_000;
const HINT_MS = 90 * 60_000;
const IN_SHAKE = /\ben (el|la|mi) (batido|licuado|smoothie|shake)\b/;
const SHAKE_PART = /\b(batido|licuado|smoothie|shake|whey|scoop|proteina)\b/;

type Row = Logged & { seq: number; slot_id: string | null; role: string | null; pinned: number };
type Group = { rows: Row[]; link: string | null };

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const fits = (group: Group, row: Row) => !group.link || !row.slot_id || group.link === row.slot_id;
const add = (group: Group, row: Row) => {
  group.rows.push(row);
  group.link ??= row.slot_id;
};

/** Groups one day's loose entries (in eating order) into what was eaten together. */
export function eatenAsOne(rows: Row[]): Row[][] {
  const groups: Group[] = [];
  for (const row of rows) {
    const group = groups.findLast((g) => g.rows[0]!.slot === row.slot && row.eatenAt - g.rows[0]!.eatenAt <= TOGETHER_MS && fits(g, row));
    if (group) add(group, row);
    else groups.push({ rows: [row], link: row.slot_id });
  }
  for (const lone of groups.filter((g) => g.rows.length === 1 && IN_SHAKE.test(fold(g.rows[0]!.name)))) {
    const row = lone.rows[0]!;
    const distance = (g: Group) => Math.min(...g.rows.map((r) => Math.abs(r.eatenAt - row.eatenAt)));
    const shake = groups
      .filter((g) => g !== lone && g.rows.length && g.rows.some((r) => SHAKE_PART.test(fold(r.name))) && fits(g, row) && distance(g) <= HINT_MS)
      .sort((a, b) => distance(a) - distance(b))[0];
    if (!shake) continue;
    lone.rows = [];
    add(shake, { ...row, slot: shake.rows[0]!.slot });
  }
  return groups.map((g) => g.rows.sort((a, b) => a.eatenAt - b.eatenAt || a.seq - b.seq)).filter((rows) => rows.length > 1);
}

/** The plan meal's name when the group was exactly that meal, else one made from its foods. */
function nameFor(rows: Row[]): string {
  const link = rows[0]!.slot_id;
  if (link && rows.every((r) => r.slot_id === link && r.role === "planned")) {
    const name = findSlotRow(link)?.name;
    if (name) return name;
  }
  return dishName(rows);
}

/** Makes dishes of every group of loose entries eaten together. Returns how many. */
export function backfillDishes(): number {
  const rows = db()
    .query<Row, []>(
      `SELECT m.rowid AS seq, m.id, m.date, m.eaten_at AS eatenAt, m.slot, m.name, m.quantity, m.unit, m.kcal, m.plan_item_id AS planItemId,
         l.slot_id, l.role, (p.entry_id IS NOT NULL) AS pinned
       FROM meal_entries m LEFT JOIN meal_slot_links l ON l.entry_id = m.id LEFT JOIN meal_entry_pins p ON p.entry_id = m.id
       WHERE NOT EXISTS (SELECT 1 FROM meal_dish_components c WHERE c.entry_id = m.id)
       ORDER BY m.date, m.eaten_at, m.rowid`,
    )
    .all();
  const byDate = new Map<string, Row[]>();
  for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
  let made = 0;
  for (const day of byDate.values()) {
    for (const group of eatenAsOne(day)) {
      for (const r of group) db().query("UPDATE meal_entries SET slot = ? WHERE id = ? AND slot != ?").run(group[0]!.slot, r.id, group[0]!.slot);
      attachDish(group.map((r) => r.id), nameFor(group));
      // A dish is one meal: what was loose joins the meal the rest of it is.
      const link = group.find((r) => r.slot_id)?.slot_id;
      const row = link ? findSlotRow(link) : null;
      const loose = group.filter((r) => !r.slot_id && !r.pinned);
      if (row && loose.length) tie(loose, row);
      made++;
    }
  }
  return made;
}

const repaired = new WeakSet<object>();

/** Runs the backfill once per database, the first time a day is read. */
export function repairDishesOnce(): void {
  const database = db();
  if (repaired.has(database)) return;
  repaired.add(database);
  if (database.query("SELECT 1 FROM nutrition_repairs WHERE name = ?").get(REPAIR)) return;
  database.transaction(() => {
    backfillDishes();
    database.query("INSERT OR IGNORE INTO nutrition_repairs (name, ran_at) VALUES (?, ?)").run(REPAIR, Date.now());
  })();
}
