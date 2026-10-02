import type { NutrientZone } from "@pulso/contract";
import { fmtNumber } from "../../../_ui/format";

/** The whole ring: room past the zone's max (or 125 % of the target) so the zone and any overflow both show. */
export const ringFull = (z: NutrientZone) => Math.max(z.target * 1.25, (z.max ?? z.target) * 1.1, 1);

/** One line in plain Spanish: «Faltan 42 g», «En tu zona» («Mínimo cumplido» for a minimum), «Te pasaste 120 kcal». */
export function zoneLine(z: NutrientZone, unit: "kcal" | "g"): string {
  if (z.status === "below") return `Faltan ${fmtNumber(Math.max(1, (z.min ?? 0) - z.value))} ${unit}`;
  if (z.status === "above") return `Te pasaste ${fmtNumber(Math.max(1, z.value - (z.max ?? 0)))} ${unit}`;
  return z.kind === "min" ? "Mínimo cumplido" : "En tu zona";
}

/** The zone itself: «mín. 150 g», «1.800–2.100 kcal», «máx. 70 g». */
export function zoneRange(z: NutrientZone, unit: "kcal" | "g"): string {
  if (z.kind === "min" || z.max === null) return `mín. ${fmtNumber(z.min ?? 0)} ${unit}`;
  if (z.kind === "max" || z.min === null) return `máx. ${fmtNumber(z.max)} ${unit}`;
  return `${fmtNumber(z.min)}–${fmtNumber(z.max)} ${unit}`;
}

/** The status colour: the nutrient's own below the zone, success in it, destructive past it. */
export const zoneTone = (z: NutrientZone, color: string) => (z.status === "inZone" ? "var(--success)" : z.status === "above" ? "var(--destructive)" : color);
