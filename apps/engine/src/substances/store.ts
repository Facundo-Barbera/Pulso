import { randomUUID } from "node:crypto";
import type { Substance, SubstanceEntry, SubstanceSettings } from "@pulso/contract";
import { z } from "zod";
import { db } from "../db";
import { DATE, localNow, TIME } from "../medication/schedule";

export const SUBSTANCES = ["cannabis", "alcohol", "nicotina"] as const;
export const FORMS = ["fumado", "vapeado", "comestible", "otro"] as const;
export const AMOUNTS = ["poco", "normal", "mucho"] as const;
export const CONTEXTS = ["social", "solo", "dormir", "estres", "otro"] as const;

// Validation shared by the phone and web routes and the agent tools.
const fields = {
  substance: z.enum(SUBSTANCES),
  date: z.string().regex(DATE, "expected YYYY-MM-DD"),
  time: z.string().regex(TIME, "expected HH:MM (24h)"),
  form: z.enum(FORMS).nullable(),
  amount: z.enum(AMOUNTS),
  count: z.number().int().min(1).max(100).nullable(),
  thcMg: z.number().positive().max(2000).nullable(),
  context: z.enum(CONTEXTS).nullable(),
  note: z.string().trim().max(500).nullable().transform((v) => v || null),
};
export const entryInputSchema = z.object({
  ...fields,
  substance: fields.substance.default("cannabis"),
  date: fields.date.optional(),
  time: fields.time.optional(),
  form: fields.form.optional(),
  amount: fields.amount.default("normal"),
  count: fields.count.optional(),
  thcMg: fields.thcMg.optional(),
  context: fields.context.optional(),
  note: fields.note.optional(),
});
export const entryPatchSchema = z.object(fields).partial();
export const settingsPatchSchema = z.object({ maxDaysPerWeek: z.number().int().min(0).max(7).nullable() }).partial();

export class SubstanceError extends Error {
  constructor(
    public code: "not_found",
    message: string,
  ) {
    super(message);
  }
}

type Row = {
  id: string;
  substance: Substance;
  date: string;
  time: string;
  form: SubstanceEntry["form"];
  amount: SubstanceEntry["amount"];
  count: number | null;
  thc_mg: number | null;
  context: SubstanceEntry["context"];
  note: string | null;
  created_at: number;
  updated_at: number;
};

const toEntry = (r: Row): SubstanceEntry => ({
  id: r.id,
  substance: r.substance,
  date: r.date,
  time: r.time,
  form: r.form,
  amount: r.amount,
  count: r.count,
  thcMg: r.thc_mg,
  context: r.context,
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Form and THC only describe cannabis; a cannabis use without a form was smoked, the usual case. */
function normalize<T extends { substance: Substance; form?: SubstanceEntry["form"]; thcMg?: number | null }>(entry: T): T {
  if (entry.substance !== "cannabis") return { ...entry, form: null, thcMg: null };
  return { ...entry, form: entry.form ?? "fumado" };
}

export function getUse(id: string): SubstanceEntry {
  const row = db().query<Row, [string]>("SELECT * FROM substance_entries WHERE id = ?").get(id);
  if (!row) throw new SubstanceError("not_found", "No existe ese registro.");
  return toEntry(row);
}

export function logUse(input: unknown, now = new Date()): SubstanceEntry {
  const parsed = entryInputSchema.parse(input ?? {});
  const clock = localNow(now);
  const entry = normalize({ ...parsed, date: parsed.date ?? clock.date, time: parsed.time ?? clock.time });
  const id = randomUUID();
  const at = now.getTime();
  db()
    .query(
      `INSERT INTO substance_entries (id, substance, date, time, form, amount, count, thc_mg, context, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, entry.substance, entry.date, entry.time, entry.form ?? null, entry.amount, entry.count ?? null, entry.thcMg ?? null, entry.context ?? null, entry.note ?? null, at, at);
  return getUse(id);
}

export function updateUse(id: string, patch: unknown, now = Date.now()): SubstanceEntry {
  const changes = entryPatchSchema.parse(patch ?? {});
  const entry = normalize({ ...getUse(id), ...changes });
  db()
    .query("UPDATE substance_entries SET substance = ?, date = ?, time = ?, form = ?, amount = ?, count = ?, thc_mg = ?, context = ?, note = ?, updated_at = ? WHERE id = ?")
    .run(entry.substance, entry.date, entry.time, entry.form, entry.amount, entry.count, entry.thcMg, entry.context, entry.note, now, id);
  return getUse(id);
}

export function deleteUse(id: string): void {
  if (db().query("DELETE FROM substance_entries WHERE id = ?").run(id).changes === 0) throw new SubstanceError("not_found", "No existe ese registro.");
}

/** Uses from `from` to `to` inclusive, newest first; every substance unless one is given. */
export function listUses(from: string, to: string, substance?: Substance): SubstanceEntry[] {
  return db()
    .query<Row, [string, string, string | null, string | null]>(
      "SELECT * FROM substance_entries WHERE date BETWEEN ? AND ? AND (? IS NULL OR substance = ?) ORDER BY date DESC, time DESC, created_at DESC",
    )
    .all(from, to, substance ?? null, substance ?? null)
    .map(toEntry);
}

/** The first day anything of `substance` was logged: before it, "no use" only means "not logging yet". */
export function firstUseDate(substance: Substance): string | null {
  return db().query<{ date: string | null }, [string]>("SELECT MIN(date) AS date FROM substance_entries WHERE substance = ?").get(substance)?.date ?? null;
}

export function lastUse(substance: Substance): { date: string; time: string } | null {
  return db().query<{ date: string; time: string }, [string]>("SELECT date, time FROM substance_entries WHERE substance = ? ORDER BY date DESC, time DESC LIMIT 1").get(substance) ?? null;
}

export function getSettings(): SubstanceSettings {
  const row = db().query<{ max_days_per_week: number | null }, []>("SELECT max_days_per_week FROM substance_settings WHERE id = 1").get();
  return { maxDaysPerWeek: row?.max_days_per_week ?? null };
}

export function updateSettings(patch: unknown, now = Date.now()): SubstanceSettings {
  const changes = settingsPatchSchema.parse(patch ?? {});
  const next = { ...getSettings(), ...changes };
  db()
    .query("INSERT INTO substance_settings (id, max_days_per_week, updated_at) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET max_days_per_week = excluded.max_days_per_week, updated_at = excluded.updated_at")
    .run(next.maxDaysPerWeek, now);
  return getSettings();
}

/** The web key of this Mac; paired browsers use their device id. */
export const MAC = "mac";

/** Whether a web client shows Sustancias: on by default on the Mac, off on every other browser until turned on there. */
export function visibleOn(deviceKey: string): boolean {
  const row = db().query<{ visible: number }, [string]>("SELECT visible FROM substance_visibility WHERE device_key = ?").get(deviceKey);
  return row ? row.visible === 1 : deviceKey === MAC;
}

export function setVisibleOn(deviceKey: string, visible: boolean, now = Date.now()): boolean {
  db()
    .query("INSERT INTO substance_visibility (device_key, visible, updated_at) VALUES (?, ?, ?) ON CONFLICT (device_key) DO UPDATE SET visible = excluded.visible, updated_at = excluded.updated_at")
    .run(deviceKey, visible ? 1 : 0, now);
  return visibleOn(deviceKey);
}
