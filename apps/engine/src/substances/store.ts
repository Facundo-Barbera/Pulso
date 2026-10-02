import { randomUUID } from "node:crypto";
import type { Substance, SubstanceEntry } from "@pulso/contract";
import { z } from "zod";
import { db } from "../db";
import { DATE, localNow, TIME } from "../medication/schedule";

export const AMOUNTS = ["poco", "normal", "mucho"] as const;
export const CONTEXTS = ["social", "solo", "dormir", "estres", "otro"] as const;

// Validation shared by the phone and web routes and the agent tools.
const label = (max: number) => z.string().trim().min(1).max(max);
const substanceFields = {
  name: label(40),
  symbol: z.string().trim().max(40).nullable().transform((v) => v || null),
  unit: label(20),
  forms: z.array(label(24)).max(8).transform((forms) => [...new Set(forms)]),
  maxDaysPerWeek: z.number().int().min(0).max(7).nullable(),
};
export const substanceInputSchema = z.object({
  ...substanceFields,
  symbol: substanceFields.symbol.optional(),
  unit: substanceFields.unit.default("veces"),
  forms: substanceFields.forms.default([]),
  maxDaysPerWeek: substanceFields.maxDaysPerWeek.optional(),
});
export const substancePatchSchema = z.object({ ...substanceFields, archived: z.boolean() }).partial();

const entryFields = {
  substanceId: z.string().min(1),
  date: z.string().regex(DATE, "expected YYYY-MM-DD"),
  time: z.string().regex(TIME, "expected HH:MM (24h)"),
  form: z.string().trim().max(24).nullable(),
  amount: z.enum(AMOUNTS),
  quantity: z.number().positive().max(100_000).nullable(),
  thcMg: z.number().positive().max(2000).nullable(),
  context: z.enum(CONTEXTS).nullable(),
  note: z.string().trim().max(500).nullable().transform((v) => v || null),
};
export const entryInputSchema = z.object({
  ...entryFields,
  substanceId: entryFields.substanceId.optional(),
  date: entryFields.date.optional(),
  time: entryFields.time.optional(),
  form: entryFields.form.optional(),
  amount: entryFields.amount.default("normal"),
  quantity: entryFields.quantity.optional(),
  thcMg: entryFields.thcMg.optional(),
  context: entryFields.context.optional(),
  note: entryFields.note.optional(),
});
export const entryPatchSchema = z.object(entryFields).partial();

export class SubstanceError extends Error {
  constructor(
    public code: "not_found" | "invalid_request",
    message: string,
  ) {
    super(message);
  }
}

// ── Substances ──────────────────────────────────────────────────────────────

type SubstanceRow = {
  id: string;
  name: string;
  symbol: string | null;
  unit: string;
  forms: string;
  max_days_per_week: number | null;
  archived: number;
  position: number;
  builtin: number;
  created_at: number;
  updated_at: number;
};

const toSubstance = (r: SubstanceRow): Substance => ({
  id: r.id,
  name: r.name,
  symbol: r.symbol,
  unit: r.unit,
  forms: JSON.parse(r.forms) as string[],
  maxDaysPerWeek: r.max_days_per_week,
  archived: r.archived === 1,
  position: r.position,
  builtin: r.builtin === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Active ones by position, then the archived ones. */
export function listSubstances(options: { includeArchived?: boolean } = {}): Substance[] {
  return db()
    .query<SubstanceRow, [number]>("SELECT * FROM substances WHERE archived = 0 OR ? ORDER BY archived, position, created_at")
    .all(options.includeArchived === false ? 0 : 1)
    .map(toSubstance);
}

export function getSubstance(id: string): Substance {
  const row = db().query<SubstanceRow, [string]>("SELECT * FROM substances WHERE id = ?").get(id);
  if (!row) throw new SubstanceError("not_found", "No existe esa sustancia.");
  return toSubstance(row);
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

/** By id or by name (any case or accents), archived ones included. For the Coach, which knows names. */
export function findSubstance(idOrName: string): Substance | undefined {
  const key = fold(idOrName);
  return listSubstances().find((s) => s.id === idOrName || fold(s.name) === key);
}

/** The id behind an id or a name; an error that lists what exists otherwise. */
export function resolveSubstance(idOrName: string): Substance {
  const found = findSubstance(idOrName);
  if (found) return found;
  const names = listSubstances({ includeArchived: false }).map((s) => s.name).join(", ");
  throw new SubstanceError("not_found", `No hay una sustancia «${idOrName}». Las que hay: ${names || "ninguna"}.`);
}

export function createSubstance(input: unknown, now = Date.now()): Substance {
  const parsed = substanceInputSchema.parse(input ?? {});
  if (findSubstance(parsed.name)) throw new SubstanceError("invalid_request", `Ya existe «${parsed.name}».`);
  const id = randomUUID();
  const position = (db().query<{ p: number | null }, []>("SELECT MAX(position) AS p FROM substances WHERE archived = 0").get()?.p ?? -1) + 1;
  db()
    .query(
      `INSERT INTO substances (id, name, symbol, unit, forms, max_days_per_week, archived, position, builtin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?)`,
    )
    .run(id, parsed.name, parsed.symbol ?? null, parsed.unit, JSON.stringify(parsed.forms), parsed.maxDaysPerWeek ?? null, position, now, now);
  return getSubstance(id);
}

export function updateSubstance(id: string, patch: unknown, now = Date.now()): Substance {
  const changes = substancePatchSchema.parse(patch ?? {});
  const current = getSubstance(id);
  if (changes.name !== undefined) {
    const clash = findSubstance(changes.name);
    if (clash && clash.id !== id) throw new SubstanceError("invalid_request", `Ya existe «${changes.name}».`);
  }
  const next = { ...current, ...changes };
  // Unarchiving puts it back at the end of the active list.
  const position = current.archived && changes.archived === false ? (db().query<{ p: number | null }, []>("SELECT MAX(position) AS p FROM substances WHERE archived = 0").get()?.p ?? -1) + 1 : current.position;
  db()
    .query("UPDATE substances SET name = ?, symbol = ?, unit = ?, forms = ?, max_days_per_week = ?, archived = ?, position = ?, updated_at = ? WHERE id = ?")
    .run(next.name, next.symbol, next.unit, JSON.stringify(next.forms), next.maxDaysPerWeek, next.archived ? 1 : 0, position, now, id);
  return getSubstance(id);
}

/** `ids` = every active substance in the new order. */
export function reorderSubstances(ids: unknown, now = Date.now()): Substance[] {
  const order = z.array(z.string()).max(200).parse(ids);
  const active = listSubstances({ includeArchived: false }).map((s) => s.id);
  if (order.length !== active.length || !active.every((id) => order.includes(id))) {
    throw new SubstanceError("invalid_request", "El orden debe incluir cada sustancia activa una vez.");
  }
  const update = db().query("UPDATE substances SET position = ?, updated_at = ? WHERE id = ?");
  db().transaction(() => order.forEach((id, i) => update.run(i, now, id)))();
  return listSubstances();
}

// ── Uses ────────────────────────────────────────────────────────────────────

type EntryRow = {
  id: string;
  substance_id: string;
  date: string;
  time: string;
  form: string | null;
  amount: SubstanceEntry["amount"];
  count: number | null;
  thc_mg: number | null;
  context: SubstanceEntry["context"];
  note: string | null;
  created_at: number;
  updated_at: number;
};

const toEntry = (r: EntryRow): SubstanceEntry => ({
  id: r.id,
  substanceId: r.substance_id,
  date: r.date,
  time: r.time,
  form: r.form,
  amount: r.amount,
  quantity: r.count,
  thcMg: r.thc_mg,
  context: r.context,
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** One of the substance's own forms (any case); not given = its first, null = none. */
function resolveForm(substance: Substance, given: string | null | undefined): string | null {
  if (!substance.forms.length || given === null) return null;
  if (given === undefined) return substance.forms[0]!;
  const match = substance.forms.find((f) => fold(f) === fold(given));
  if (!match) throw new SubstanceError("invalid_request", `«${given}» no es una forma de ${substance.name}: ${substance.forms.join(", ")}.`);
  return match;
}

/** THC only describes cannabis edibles. */
const thcFor = (substanceId: string, form: string | null, thcMg: number | null | undefined) => (substanceId === "cannabis" && form === "comestible" ? (thcMg ?? null) : null);

export function getUse(id: string): SubstanceEntry {
  const row = db().query<EntryRow, [string]>("SELECT * FROM substance_entries WHERE id = ?").get(id);
  if (!row) throw new SubstanceError("not_found", "No existe ese registro.");
  return toEntry(row);
}

export function logUse(input: unknown, now = new Date()): SubstanceEntry {
  const parsed = entryInputSchema.parse(input ?? {});
  const clock = localNow(now);
  const substanceId = parsed.substanceId ?? listSubstances({ includeArchived: false })[0]?.id;
  if (!substanceId) throw new SubstanceError("invalid_request", "No hay ninguna sustancia activa.");
  const form = resolveForm(getSubstance(substanceId), parsed.form);
  const id = randomUUID();
  const at = now.getTime();
  db()
    .query(
      `INSERT INTO substance_entries (id, substance_id, date, time, form, amount, count, thc_mg, context, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, substanceId, parsed.date ?? clock.date, parsed.time ?? clock.time, form, parsed.amount, parsed.quantity ?? null, thcFor(substanceId, form, parsed.thcMg), parsed.context ?? null, parsed.note ?? null, at, at);
  return getUse(id);
}

export function updateUse(id: string, patch: unknown, now = Date.now()): SubstanceEntry {
  const changes = entryPatchSchema.parse(patch ?? {});
  const current = getUse(id);
  const next = { ...current, ...changes };
  const moved = next.substanceId !== current.substanceId;
  // An untouched form stays even if the substance's list changed since; a move picks the new substance's default.
  const form = changes.form !== undefined || moved ? resolveForm(getSubstance(next.substanceId), changes.form) : current.form;
  db()
    .query("UPDATE substance_entries SET substance_id = ?, date = ?, time = ?, form = ?, amount = ?, count = ?, thc_mg = ?, context = ?, note = ?, updated_at = ? WHERE id = ?")
    .run(next.substanceId, next.date, next.time, form, next.amount, next.quantity, thcFor(next.substanceId, form, next.thcMg), next.context, next.note, now, id);
  return getUse(id);
}

export function deleteUse(id: string): void {
  if (db().query("DELETE FROM substance_entries WHERE id = ?").run(id).changes === 0) throw new SubstanceError("not_found", "No existe ese registro.");
}

/** Uses from `from` to `to` inclusive, newest first; of the given substances, or all of them. */
export function listUses(from: string, to: string, substanceIds?: string[]): SubstanceEntry[] {
  const rows = db()
    .query<EntryRow, [string, string]>("SELECT * FROM substance_entries WHERE date BETWEEN ? AND ? ORDER BY date DESC, time DESC, created_at DESC")
    .all(from, to)
    .map(toEntry);
  return substanceIds ? rows.filter((e) => substanceIds.includes(e.substanceId)) : rows;
}

/** The first day any of `substanceIds` was logged: before it, "no use" only means "not logging yet". */
export function firstUseDate(substanceIds: string[]): string | null {
  return listAllDates(substanceIds).at(0)?.date ?? null;
}

export function lastUse(substanceIds: string[]): { date: string; time: string } | null {
  return listAllDates(substanceIds).at(-1) ?? null;
}

function listAllDates(substanceIds: string[]): { date: string; time: string }[] {
  if (!substanceIds.length) return [];
  return db()
    .query<{ date: string; time: string }, string[]>(`SELECT date, time FROM substance_entries WHERE substance_id IN (${substanceIds.map(() => "?").join(", ")}) ORDER BY date, time`)
    .all(...substanceIds);
}

// ── Web visibility ──────────────────────────────────────────────────────────

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
