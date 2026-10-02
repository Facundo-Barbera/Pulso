import type { NutrientZone } from "@pulso/contract";
import { CircleArrowDown, CircleArrowUp, CircleCheck, type LucideIcon } from "lucide-react";
import { fmtNumber } from "../../../_ui/format";

/** The top of the zone: its max, or for a minimum (where more is fine) 125 % of the target. */
export const zoneTop = (z: NutrientZone) => (z.kind === "min" || z.max === null ? Math.max(z.target * 1.25, z.max ?? 0) : z.max);

/** Where `value` sits on the zone bar, 0…1: room past the top of the zone, and past today's value when it is further. */
export const zoneFraction = (z: NutrientZone, value: number) => Math.max(0, Math.min(1, value / Math.max(zoneTop(z) * 1.15, z.value * 1.04, 1)));

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

/**
 * The status as an icon, so it never rests on colour: ↓ short of the zone, ✓ in it,
 * ↑ past it. The icon's tint is quiet below, blue in, orange past — never green against red.
 */
export const ZONE_STATUS: Record<NutrientZone["status"], { Icon: LucideIcon; className: string }> = {
  below: { Icon: CircleArrowDown, className: "text-muted-foreground" },
  inZone: { Icon: CircleCheck, className: "text-good" },
  above: { Icon: CircleArrowUp, className: "text-caution" },
};
