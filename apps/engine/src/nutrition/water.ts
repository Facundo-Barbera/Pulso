import { randomUUID } from "node:crypto";
import type { WaterDay, WaterEntry, WaterSettings, WaterUnit } from "@pulso/contract";
import { series } from "../body/store";
import { db } from "../db";
import { localDate } from "./dates";

const ML_PER_KG = 35;
const DEFAULT_GOAL_ML = 2000;
/** 35 ml/kg overshoots for heavy people (120 kg → 4.2 L); the derived goal stays in a sensible daily range. */
const MIN_DERIVED_ML = 2000;
const MAX_DERIVED_ML = 3700;
const DEFAULTS: WaterSettings = { goalMl: null, unit: "vaso", glassMl: 250, bottleMl: 500 };

type EntryRow = { id: string; date: string; logged_at: number; amount_ml: number; source: WaterEntry["source"] };
const toEntry = (r: EntryRow): WaterEntry => ({ id: r.id, date: r.date, loggedAt: r.logged_at, amountMl: r.amount_ml, source: r.source });

export function getWaterSettings(): WaterSettings {
  const row = db()
    .query<{ goal_ml: number | null; unit: WaterUnit; glass_ml: number; bottle_ml: number }, []>("SELECT * FROM water_settings WHERE id = 1")
    .get();
  return row ? { goalMl: row.goal_ml, unit: row.unit, glassMl: row.glass_ml, bottleMl: row.bottle_ml } : { ...DEFAULTS };
}

/** Merges into the stored settings. `goalMl: null` goes back to the derived goal. */
export function setWaterSettings(patch: Partial<WaterSettings>): WaterSettings {
  const next = { ...getWaterSettings(), ...patch };
  db()
    .query(
      `INSERT INTO water_settings (id, goal_ml, unit, glass_ml, bottle_ml) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET goal_ml = excluded.goal_ml, unit = excluded.unit, glass_ml = excluded.glass_ml, bottle_ml = excluded.bottle_ml`,
    )
    .run(next.goalMl, next.unit, next.glassMl, next.bottleMl);
  return next;
}

/** The daily goal: the person's own, else 35 ml per kg of their latest weight (to 50 ml, within 2–3.7 L), else 2 L. */
export function waterGoal(settings = getWaterSettings(), weight: number | null = series("weight").at(-1)?.value ?? null): { goalMl: number; goalSource: WaterDay["goalSource"] } {
  if (settings.goalMl) return { goalMl: settings.goalMl, goalSource: "custom" };
  if (weight) {
    const derived = Math.round((weight * ML_PER_KG) / 50) * 50;
    return { goalMl: Math.min(MAX_DERIVED_ML, Math.max(MIN_DERIVED_ML, derived)), goalSource: "weight" };
  }
  return { goalMl: DEFAULT_GOAL_ML, goalSource: "default" };
}

/** Millilitres in `amount` of `unit`, with the person's glass and bottle sizes. */
export function toMl(amount: number, unit: WaterUnit | "l", settings = getWaterSettings()): number {
  const per = { ml: 1, l: 1000, vaso: settings.glassMl, botella: settings.bottleMl }[unit];
  return Math.round(amount * per);
}

export function logWater(input: { amountMl: number; loggedAt?: number; date?: string; source?: WaterEntry["source"] }): WaterEntry {
  const loggedAt = Math.round(input.loggedAt ?? Date.now());
  const entry: WaterEntry = {
    id: randomUUID(),
    date: input.date ?? localDate(loggedAt),
    loggedAt,
    amountMl: Math.round(input.amountMl),
    source: input.source ?? "manual",
  };
  db()
    .query("INSERT INTO water_entries (id, date, logged_at, amount_ml, source) VALUES (?, ?, ?, ?, ?)")
    .run(entry.id, entry.date, entry.loggedAt, entry.amountMl, entry.source);
  return entry;
}

export function deleteWater(id: string): boolean {
  return db().query("DELETE FROM water_entries WHERE id = ?").run(id).changes > 0;
}

export function waterDay(date: string): WaterDay {
  const entries = db()
    .query<EntryRow, [string]>("SELECT * FROM water_entries WHERE date = ? ORDER BY logged_at")
    .all(date)
    .map(toEntry);
  const settings = getWaterSettings();
  return { date, totalMl: entries.reduce((sum, e) => sum + e.amountMl, 0), ...waterGoal(settings), entries, settings };
}

/** Millilitres per day from `from` to `to` inclusive; days without water are absent. */
export function waterTotals(from: string, to: string): Record<string, number> {
  const rows = db()
    .query<{ date: string; total: number }, [string, string]>(
      "SELECT date, sum(amount_ml) AS total FROM water_entries WHERE date BETWEEN ? AND ? GROUP BY date",
    )
    .all(from, to);
  return Object.fromEntries(rows.map((r) => [r.date, r.total]));
}
