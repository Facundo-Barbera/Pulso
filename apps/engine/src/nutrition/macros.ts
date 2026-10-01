import type { Macros } from "@pulso/contract";

export const MACRO_KEYS = ["kcal", "protein", "carbs", "fat", "fiber"] as const;

export const zero = (): Macros => ({ kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
export const round = (m: Macros): Macros => Object.fromEntries(MACRO_KEYS.map((k) => [k, Math.round(m[k] * 10) / 10])) as Macros;
export function add(into: Macros, m: Macros): Macros {
  for (const k of MACRO_KEYS) into[k] += m[k];
  return into;
}
export const sum = (items: Macros[]): Macros => round(items.reduce((total, m) => add(total, m), zero()));
export const scale = (m: Macros, factor: number): Macros => round(Object.fromEntries(MACRO_KEYS.map((k) => [k, m[k] * factor])) as Macros);
export const pick = (m: Macros): Macros => ({ kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat, fiber: m.fiber });
