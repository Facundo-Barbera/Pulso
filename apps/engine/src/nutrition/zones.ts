/**
 * Target zones: the "estás bien aquí" band of each nutrient. Targets stay single
 * numbers; every nutrient also gets a zone, derived from its target and the body
 * goal unless the Coach or the person set one (`nutrition_target_zones`).
 */
import type { Macros, NutrientZone, TargetZone, ZoneInput, ZoneKind, ZoneStatus } from "@pulso/contract";
import { listGoals, series } from "../body/store";
import { db } from "../db";
import { MACRO_KEYS } from "./macros";

export type Direction = "loss" | "maintain" | "gain";
type Nutrient = keyof Macros;

/** Where a `min` zone's band ends, as a factor of its minimum. */
const MIN_BAND = 1.25;

/** Default zones as factors of the target. For `min` zones `max` only ends the band drawn. */
const DEFAULTS: Record<Nutrient, { kind: ZoneKind; min: number; max: number }> = {
  kcal: { kind: "range", min: 0.95, max: 1.05 },
  protein: { kind: "min", min: 1, max: MIN_BAND },
  carbs: { kind: "range", min: 0.8, max: 1.1 },
  fat: { kind: "range", min: 0.8, max: 1.1 },
  fiber: { kind: "min", min: 1, max: MIN_BAND },
};

/** On a deficit, eating well under the plan matters too, but less than going over it; gaining is the mirror. */
const KCAL: Record<Direction, { min: number; max: number }> = {
  loss: { min: 0.9, max: 1.05 },
  maintain: { min: 0.95, max: 1.05 },
  gain: { min: 0.95, max: 1.1 },
};

/** kcal to the nearest 10, grams to the gram. */
const tidy = (nutrient: Nutrient, value: number) => (nutrient === "kcal" ? Math.round(value / 10) * 10 : Math.round(value));

export function derivedZone(nutrient: Nutrient, target: number, direction: Direction): TargetZone {
  const d = nutrient === "kcal" ? { ...DEFAULTS.kcal, ...KCAL[direction] } : DEFAULTS[nutrient];
  return { kind: d.kind, min: tidy(nutrient, target * d.min), max: tidy(nutrient, target * d.max), custom: false };
}

/** A zone as given: the kind follows from the bounds given unless stated; a missing bound comes from the default. */
export function customZone(nutrient: Nutrient, target: number, input: ZoneInput, direction: Direction): TargetZone {
  const fallback = derivedZone(nutrient, target, direction);
  const hasMin = input.min !== undefined && input.min !== null;
  const hasMax = input.max !== undefined && input.max !== null;
  const kind = input.kind ?? (hasMin && hasMax ? "range" : hasMin ? "min" : hasMax ? "max" : fallback.kind);
  if (kind === "max") return { kind, min: null, max: hasMax ? input.max! : target, custom: true };
  const min = hasMin ? input.min! : kind === "min" ? target : fallback.min;
  const max = hasMax ? input.max! : kind === "min" ? tidy(nutrient, min! * MIN_BAND) : fallback.max;
  return { kind, min, max: Math.max(min!, max!), custom: true };
}

export function statusOf(value: number, zone: TargetZone): ZoneStatus {
  if (zone.kind !== "max" && zone.min !== null && value < zone.min) return "below";
  if (zone.kind !== "min" && zone.max !== null && value > zone.max) return "above";
  return "inZone";
}

export function zonesOf(totals: Macros, targets: Macros & { zones: Record<Nutrient, TargetZone> }): Record<Nutrient, NutrientZone> {
  return Object.fromEntries(
    MACRO_KEYS.map((k) => [k, { ...targets.zones[k], value: totals[k], target: targets[k], status: statusOf(totals[k], targets.zones[k]) }]),
  ) as Record<Nutrient, NutrientZone>;
}

/** A day counts as in zone when something was logged, kcal landed in its zone and protein reached its minimum. */
export const dayInZone = (entries: number, zones: Record<Nutrient, NutrientZone> | null) =>
  !!zones && entries > 0 && zones.kcal.status === "inZone" && zones.protein.status !== "below";

/**
 * Where the body goals point: losing when a weight or fat goal is below the latest
 * reading, gaining when only a weight goal is above it, maintaining otherwise.
 */
export function bodyDirection(): Direction {
  let direction: Direction = "maintain";
  for (const goal of listGoals()) {
    if (goal.metric === "skeletalMuscleMass") continue;
    const current = series(goal.metric).at(-1)?.value;
    if (current === undefined) continue;
    if (goal.target < current) return "loss";
    if (goal.metric === "weight" && goal.target > current) direction = "gain";
  }
  return direction;
}

// --- Custom zones ---

type ZoneRow = { nutrient: Nutrient; kind: ZoneKind; min: number | null; max: number | null };

export function customZones(): Partial<Record<Nutrient, TargetZone>> {
  const rows = db().query<ZoneRow, []>("SELECT nutrient, kind, min, max FROM nutrition_target_zones").all();
  return Object.fromEntries(rows.map((r) => [r.nutrient, { kind: r.kind, min: r.min, max: r.max, custom: true }]));
}

/** Replaces every custom zone with these (missing nutrients go back to derived). */
export function saveCustomZones(zones: Partial<Record<Nutrient, TargetZone>>): void {
  db().transaction(() => {
    db().query("DELETE FROM nutrition_target_zones").run();
    const insert = db().query("INSERT INTO nutrition_target_zones (nutrient, kind, min, max) VALUES (?, ?, ?, ?)");
    for (const [nutrient, z] of Object.entries(zones)) insert.run(nutrient, z.kind, z.min, z.max);
  })();
}

/** Every nutrient's zone: the custom one when set, else derived. */
export function resolveZones(targets: Macros, direction = bodyDirection()): Record<Nutrient, TargetZone> {
  const custom = customZones();
  return Object.fromEntries(MACRO_KEYS.map((k) => [k, custom[k] ?? derivedZone(k, targets[k], direction)])) as Record<Nutrient, TargetZone>;
}
