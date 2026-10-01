/**
 * Every change to the dated plan is a revision: the rows it touched, as they
 * were, plus a Spanish line saying what changed. Undo puts those rows back.
 * A revision can be undone while no later live revision touched the same
 * dates or batches (undo those first); the latest can always be undone.
 */
import { randomUUID } from "node:crypto";
import type { PlanRevision } from "@pulso/contract";
import { db } from "../db";
import type { PrepRow } from "./recipes";
import type { DayRow, LinkRow, SlotRow } from "./slots";

type AdjustmentRow = { date: string; plan_id: string; adjustment_json: string; created_at: number };
type PinRow = { entry_id: string; pin: string };

const pinsOn = (dates: string[]) =>
  dates.length
    ? db().query<PinRow, string[]>(`SELECT p.* FROM meal_entry_pins p JOIN meal_entries m ON m.id = p.entry_id WHERE m.date IN (${marks(dates.length)})`).all(...dates)
    : [];

type Snapshot = {
  dates: string[];
  prepIds: string[];
  days: DayRow[];
  slots: SlotRow[];
  links: LinkRow[];
  adjustments: AdjustmentRow[];
  preps: PrepRow[];
  /** «Extra» marks on the dates' log entries (older snapshots have none). */
  pins?: PinRow[];
  /** Log entries the change itself created (an estimate for eating out): undo deletes them. */
  logged?: string[];
};

type RevisionRow = {
  id: string;
  plan_id: string;
  op: string;
  summary: string;
  dates_json: string;
  prep_ids_json: string;
  before_json: string;
  created_at: number;
  undone_at: number | null;
};

export class RevisionError extends Error {}

const toRevision = (r: RevisionRow): PlanRevision => ({
  id: r.id,
  planId: r.plan_id,
  op: r.op,
  summary: r.summary,
  dates: JSON.parse(r.dates_json) as string[],
  createdAt: r.created_at,
  undoneAt: r.undone_at,
});

const marks = (n: number) => Array(n).fill("?").join(",");

/** Slots on `dates` plus every slot holding a portion of `prepIds`, wherever it is. */
function touchedSlots(planId: string, dates: string[], prepIds: string[]): SlotRow[] {
  const byDate = dates.length
    ? db().query<SlotRow, string[]>(`SELECT * FROM plan_slots WHERE plan_id = ? AND date IN (${marks(dates.length)})`).all(planId, ...dates)
    : [];
  const byPrep = prepIds.length ? db().query<SlotRow, string[]>(`SELECT * FROM plan_slots WHERE prep_id IN (${marks(prepIds.length)})`).all(...prepIds) : [];
  const seen = new Map([...byDate, ...byPrep].map((r) => [r.id, r]));
  return [...seen.values()];
}

function capture(planId: string, dates: string[], prepIds: string[]): Snapshot {
  // A batch's portions widen the change to their days; restore rewrites whole days, so take all of each.
  const allDates = [...new Set([...dates, ...touchedSlots(planId, dates, prepIds).map((s) => s.date)])].sort();
  const slots = touchedSlots(planId, allDates, prepIds);
  const ids = slots.map((s) => s.id);
  return {
    dates: allDates,
    prepIds,
    days: allDates.length ? db().query<DayRow, string[]>(`SELECT * FROM plan_days WHERE plan_id = ? AND date IN (${marks(allDates.length)})`).all(planId, ...allDates) : [],
    slots,
    links: ids.length ? db().query<LinkRow, string[]>(`SELECT * FROM meal_slot_links WHERE slot_id IN (${marks(ids.length)})`).all(...ids) : [],
    adjustments: allDates.length
      ? db().query<AdjustmentRow, string[]>(`SELECT * FROM plan_adjustments WHERE date IN (${marks(allDates.length)})`).all(...allDates)
      : [],
    preps: prepIds.length ? db().query<PrepRow, string[]>(`SELECT * FROM prep_batches WHERE id IN (${marks(prepIds.length)})`).all(...prepIds) : [],
    pins: pinsOn(allDates),
  };
}

function restore(planId: string, snap: Snapshot): void {
  const current = touchedSlots(planId, snap.dates, snap.prepIds);
  const ids = [...new Set([...current.map((s) => s.id), ...snap.slots.map((s) => s.id)])];
  if (ids.length) {
    db().query(`DELETE FROM meal_slot_links WHERE slot_id IN (${marks(ids.length)})`).run(...ids);
    db().query(`DELETE FROM plan_slots WHERE id IN (${marks(ids.length)})`).run(...ids);
  }
  const insertSlot = db().query(
    `INSERT INTO plan_slots (id, plan_id, date, slot, position, kind, name, recipe_id, prep_id, portions, items_json, status, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const s of snap.slots) {
    insertSlot.run(s.id, s.plan_id, s.date, s.slot, s.position, s.kind, s.name, s.recipe_id, s.prep_id, s.portions, s.items_json, s.status, s.note, s.updated_at);
  }
  // A log entry deleted since keeps no link.
  const link = db().query("INSERT OR IGNORE INTO meal_slot_links (entry_id, slot_id, role) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM meal_entries WHERE id = ?)");
  for (const l of snap.links) link.run(l.entry_id, l.slot_id, l.role, l.entry_id);
  for (const d of snap.days) {
    db()
      .query("INSERT INTO plan_days (plan_id, date, label, shift_kcal) VALUES (?, ?, ?, ?) ON CONFLICT (plan_id, date) DO UPDATE SET label = excluded.label, shift_kcal = excluded.shift_kcal")
      .run(d.plan_id, d.date, d.label, d.shift_kcal);
  }
  if (snap.dates.length) db().query(`DELETE FROM plan_adjustments WHERE date IN (${marks(snap.dates.length)})`).run(...snap.dates);
  for (const a of snap.adjustments) {
    db().query("INSERT INTO plan_adjustments (date, plan_id, adjustment_json, created_at) VALUES (?, ?, ?, ?)").run(a.date, a.plan_id, a.adjustment_json, a.created_at);
  }
  if (snap.prepIds.length) db().query(`DELETE FROM prep_batches WHERE id IN (${marks(snap.prepIds.length)})`).run(...snap.prepIds);
  for (const p of snap.preps) {
    db()
      .query("INSERT INTO prep_batches (id, plan_id, recipe_id, cook_date, portions, status, cooked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(p.id, p.plan_id, p.recipe_id, p.cook_date, p.portions, p.status, p.cooked_at, p.created_at);
  }
  if (snap.pins) {
    for (const p of pinsOn(snap.dates)) db().query("DELETE FROM meal_entry_pins WHERE entry_id = ?").run(p.entry_id);
    for (const p of snap.pins) db().query("INSERT OR IGNORE INTO meal_entry_pins (entry_id, pin) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM meal_entries WHERE id = ?)").run(p.entry_id, p.pin, p.entry_id);
  }
  if (snap.logged?.length) db().query(`DELETE FROM meal_entries WHERE id IN (${marks(snap.logged.length)})`).run(...snap.logged);
}

export type Scope = { planId: string; op: string; dates: string[]; prepIds?: string[] };

/**
 * Runs a change in one transaction and records it. `run` returns the Spanish
 * summary (and anything else the caller needs back); `logged` lists entries it
 * created, which undo deletes.
 */
export function revise<T extends { summary: string; logged?: string[] }>(scope: Scope, run: () => T): T & { revision: PlanRevision } {
  return db().transaction(() => {
    const before = capture(scope.planId, scope.dates, scope.prepIds ?? []);
    const result = run();
    if (result.logged?.length) before.logged = result.logged;
    const row: RevisionRow = {
      id: randomUUID(),
      plan_id: scope.planId,
      op: scope.op,
      summary: result.summary,
      dates_json: JSON.stringify(before.dates),
      prep_ids_json: JSON.stringify(before.prepIds),
      before_json: JSON.stringify(before),
      created_at: Date.now(),
      undone_at: null,
    };
    // Same-millisecond revisions still order by insertion.
    const last = db().query<{ t: number | null }, [string]>("SELECT max(created_at) AS t FROM plan_revisions WHERE plan_id = ?").get(scope.planId)?.t ?? 0;
    row.created_at = Math.max(row.created_at, last + 1);
    db()
      .query(
        "INSERT INTO plan_revisions (id, plan_id, op, summary, dates_json, prep_ids_json, before_json, created_at, undone_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)",
      )
      .run(row.id, row.plan_id, row.op, row.summary, row.dates_json, row.prep_ids_json, row.before_json, row.created_at);
    return { ...result, revision: toRevision(row) };
  })();
}

export function listRevisions(planId: string, limit = 20): PlanRevision[] {
  return db()
    .query<RevisionRow, [string, number]>("SELECT * FROM plan_revisions WHERE plan_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(planId, limit)
    .map(toRevision);
}

export function lastRevision(planId: string): PlanRevision | null {
  const row = db().query<RevisionRow, [string]>("SELECT * FROM plan_revisions WHERE plan_id = ? AND undone_at IS NULL ORDER BY created_at DESC LIMIT 1").get(planId);
  return row ? toRevision(row) : null;
}

/** Puts back what revision `id` (default: the latest live one) changed. */
export function undoRevision(planId: string, id?: string): PlanRevision & { dates: string[] } {
  const row = id
    ? db().query<RevisionRow, [string, string]>("SELECT * FROM plan_revisions WHERE id = ? AND plan_id = ?").get(id, planId)
    : db().query<RevisionRow, [string]>("SELECT * FROM plan_revisions WHERE plan_id = ? AND undone_at IS NULL ORDER BY created_at DESC LIMIT 1").get(planId);
  if (!row) throw new RevisionError(id ? `No change ${id} in the active plan.` : "Nothing to undo in the active plan.");
  if (row.undone_at !== null) throw new RevisionError("That change was already undone.");
  const snap = JSON.parse(row.before_json) as Snapshot;
  const later = db()
    .query<RevisionRow, [string, number]>("SELECT * FROM plan_revisions WHERE plan_id = ? AND undone_at IS NULL AND created_at > ? ORDER BY created_at DESC")
    .all(planId, row.created_at);
  const blocking = later.find((r) => {
    const dates = JSON.parse(r.dates_json) as string[];
    const preps = JSON.parse(r.prep_ids_json) as string[];
    return dates.some((d) => snap.dates.includes(d)) || preps.some((p) => snap.prepIds.includes(p));
  });
  if (blocking) throw new RevisionError(`A later change touches the same days: undo «${blocking.summary}» first.`);
  const undoneAt = Date.now();
  db().transaction(() => {
    restore(planId, snap);
    db().query("UPDATE plan_revisions SET undone_at = ? WHERE id = ?").run(undoneAt, row.id);
  })();
  return { ...toRevision(row), undoneAt };
}
