import type { BodyBand, BodyMetric } from "@pulso/contract";
import { BicepsFlexed, Droplet, Percent, Scale, type LucideIcon } from "lucide-react";

/** How each tracked metric reads: Spanish label, unit, domain colour, icon, and which way is progress when there is no goal. */
export const METRIC: Record<BodyMetric, { label: string; unit: string; color: string; icon: LucideIcon; lowerIsBetter: boolean }> = {
  weight: { label: "Peso", unit: "kg", color: "var(--domain-body)", icon: Scale, lowerIsBetter: true },
  percentBodyFat: { label: "Grasa", unit: "%", color: "var(--domain-fat)", icon: Percent, lowerIsBetter: true },
  skeletalMuscleMass: { label: "Músculo", unit: "kg", color: "var(--domain-protein)", icon: BicepsFlexed, lowerIsBetter: false },
  bodyFatMass: { label: "Masa grasa", unit: "kg", color: "var(--domain-fat)", icon: Droplet, lowerIsBetter: true },
};

export const METRIC_ORDER: BodyMetric[] = ["weight", "percentBodyFat", "skeletalMuscleMass", "bodyFatMass"];

/** Did `delta` move the right way? Toward the goal when there is one, else the metric's usual direction. Null when flat. */
export function isProgress(metric: BodyMetric, delta: number, now: number, goal?: number): boolean | null {
  if (Math.abs(delta) < 0.05) return null;
  if (goal !== undefined) return Math.sign(goal - (now - delta)) === Math.sign(delta);
  return delta < 0 === METRIC[metric].lowerIsBetter;
}

export const BAND_LABEL: Record<BodyBand, string> = { low: "Bajo", normal: "Normal", high: "Alto" };

/** "72,4" — one decimal at most, Spanish. */
export const kg = (value: number, decimals = 1) => value.toLocaleString("es", { maximumFractionDigits: decimals });

/** Form controls, shared by this section's client components. */
export const inputClass = "bg-background border-border focus-visible:ring-ring tabular min-h-11 w-full min-w-0 rounded-xl border px-3 text-[14px] outline-none focus-visible:ring-2";
export const primaryButton = "bg-primary text-primary-foreground focus-visible:ring-ring inline-flex shrink-0 whitespace-nowrap min-h-10 items-center justify-center gap-1.5 rounded-xl px-4 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50";
export const quietButton = "border-border hover:bg-muted/60 focus-visible:ring-ring inline-flex shrink-0 whitespace-nowrap min-h-10 items-center justify-center gap-1.5 rounded-xl border px-4 text-[13px] font-medium outline-none focus-visible:ring-2 disabled:opacity-50";

/** The engine's error message, or the status when it sent none. */
export async function problem(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? `Algo falló (${response.status}).`;
}
