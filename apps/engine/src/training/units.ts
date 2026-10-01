import type { WeightUnit } from "@pulso/contract";

/**
 * Kilos and pounds. Weights are stored in kg; a unit only changes how a weight
 * is shown, typed and stepped. Pure, so the web's client components use it too.
 */

export const KG_PER_LB = 0.45359237;

export const toUnit = (kg: number, unit: WeightUnit) => (unit === "lb" ? kg / KG_PER_LB : kg);
/** The exact kg of a weight typed in `unit`: 45 lb → 20.41165665 kg, which reads 45 lb again. */
export const fromUnit = (value: number, unit: WeightUnit) => (unit === "lb" ? value * KG_PER_LB : value);

/**
 * The step real equipment moves in at `value` (in `unit`): plates and pin
 * stacks go by 5 lb or 2.5 kg; small dumbbells (≤ 25 lb, ≤ 10 kg) by 2.5 lb or 1 kg.
 */
function stepAt(value: number, unit: WeightUnit): number {
  if (unit === "lb") return value <= 25 ? 2.5 : 5;
  return value <= 10 ? 1 : 2.5;
}
const smallUpTo = (unit: WeightUnit) => (unit === "lb" ? 25 : 10);

/** Off by less than this from a quarter, a value is one the person typed or lifted (and float noise). */
const EPSILON = 1e-6;
const quarter = (v: number) => Math.round(v * 4) / 4;

/**
 * A weight as it reads on the equipment, in `unit`. A value that already is
 * one (a multiple of 0.25 there: 14 kg, 45 lb, 47.5 lb) stays as it is; one
 * that came from the other unit (20 kg = 44.09 lb) goes to the nearest step.
 */
export function snap(kg: number, unit: WeightUnit): number {
  const v = toUnit(kg, unit);
  if (Math.abs(v - quarter(v)) < EPSILON) return Math.max(0, quarter(v));
  const step = stepAt(v, unit);
  return Math.max(0, Math.round(v / step) * step);
}

/** `snap` back in kg, exact: what to store for a weight that sits on the unit's steps. */
export const snapKg = (kg: number, unit: WeightUnit) => fromUnit(snap(kg, unit), unit);

/** One step up from `value` (in `unit`), landing on the step grid. */
export function stepUp(value: number, unit: WeightUnit): number {
  const step = value < smallUpTo(unit) ? stepAt(value, unit) : stepAt(smallUpTo(unit) + 1, unit);
  return Math.floor(value / step + EPSILON) * step + step;
}

/** One step down from `value` (in `unit`), landing on the step grid, never below 0. */
export function stepDown(value: number, unit: WeightUnit): number {
  const step = stepAt(value, unit);
  return Math.max(0, Math.ceil(value / step - EPSILON) * step - step);
}

/** A weight in `unit` for reading: a real one as it is (61.25 kg), a converted one to 0.1 (44.1 lb for 20 kg). */
export function shown(kg: number, unit: WeightUnit): number {
  const v = toUnit(kg, unit);
  return Math.abs(v - quarter(v)) < EPSILON ? quarter(v) : Math.round(v * 10) / 10;
}

const number = new Intl.NumberFormat("es", { maximumFractionDigits: 2 });

/** "45 lb", "20,4 kg". */
export const formatWeight = (kg: number, unit: WeightUnit) => `${number.format(shown(kg, unit))} ${unit}`;

/** "100 lb · 45,4 kg": the weight in its unit, then the other one. */
export const formatBoth = (kg: number, unit: WeightUnit) => `${formatWeight(kg, unit)} · ${formatWeight(kg, unit === "kg" ? "lb" : "kg")}`;

export const otherUnit = (unit: WeightUnit): WeightUnit => (unit === "kg" ? "lb" : "kg");
