import type { BodyScan, BodyScanValues } from "@pulso/contract";
import { Activity, Beef, BicepsFlexed, Droplets, Flame, Gauge, Gem, PieChart, Ruler, ScanSearch, Shell, Waves, type LucideIcon } from "lucide-react";
import { Card, CardTitle } from "../../../_ui/card";
import { kg } from "./metrics";

/** The other numbers on an InBody sheet, in the order the person reads them. Only the ones the scan carries are shown. */
const DETAILS: { key: keyof BodyScanValues; label: string; icon: LucideIcon; unit?: string; decimals?: number }[] = [
  { key: "bmi", label: "IMC", icon: Gauge, unit: "kg/m²" },
  { key: "visceralFatLevel", label: "Grasa visceral", icon: Shell, unit: "nivel", decimals: 0 },
  { key: "bmr", label: "Metabolismo basal", icon: Flame, unit: "kcal", decimals: 0 },
  { key: "totalBodyWater", label: "Agua corporal", icon: Droplets, unit: "L" },
  { key: "protein", label: "Proteína", icon: Beef, unit: "kg" },
  { key: "mineral", label: "Minerales", icon: Gem, unit: "kg", decimals: 2 },
  { key: "ecwRatio", label: "Ratio AEC/ACT", icon: Waves, decimals: 3 },
  { key: "smi", label: "Índice músculo-esquelético", icon: BicepsFlexed, unit: "kg/m²" },
  { key: "waistHipRatio", label: "Cintura-cadera", icon: Ruler, decimals: 2 },
  { key: "visceralFatArea", label: "Área de grasa visceral", icon: ScanSearch, unit: "cm²", decimals: 0 },
  { key: "phaseAngle", label: "Ángulo de fase", icon: Activity, unit: "°" },
];

export const hasBreakdown = (scan: BodyScan) => scan.weight != null && scan.bodyFatMass != null && scan.skeletalMuscleMass != null;
export const hasDetails = (scan: BodyScan) => DETAILS.some((d) => scan[d.key] != null);

type Dated = { scan: BodyScan; date?: string } | undefined;

/**
 * What the weight is made of — muscle, fat and the rest — and the sheet's
 * other values, each from the newest scan that has them, so a weight-only
 * entry does not blank the card. `date` is set when that scan is not the latest.
 */
export function CompositionCard({ breakdown, sheet, delay }: { breakdown: Dated; sheet: Dated; delay: number }) {
  const { weight, bodyFatMass: fat, skeletalMuscleMass: muscle } = breakdown?.scan ?? ({} as Partial<BodyScan>);
  const slices =
    weight != null && fat != null && muscle != null
      ? [
          { label: "Músculo", value: muscle, color: "var(--domain-protein)" },
          { label: "Grasa", value: fat, color: "var(--domain-fat)" },
          { label: "Resto magro", value: Math.max(weight - fat - muscle, 0), color: "color-mix(in oklab, var(--domain-carbs) 85%, transparent)" },
        ]
      : [];
  const shownBreakdown = slices.length > 0 ? breakdown?.date : undefined;
  const details = sheet ? DETAILS.filter((d) => sheet.scan[d.key] != null) : [];
  const shownSheet = details.length > 0 ? sheet?.date : undefined;
  const provenance =
    shownBreakdown && shownSheet
      ? shownBreakdown === shownSheet
        ? `Del escaneo del ${shownBreakdown}.`
        : `Reparto del ${shownBreakdown}; el resto, del ${shownSheet}.`
      : shownBreakdown
        ? `Reparto del escaneo del ${shownBreakdown}.`
        : shownSheet
          ? `Los demás valores son del escaneo del ${shownSheet}.`
          : null;
  return (
    <Card delay={delay}>
      <CardTitle icon={PieChart} color="var(--domain-protein)" title="Composición" />
      {slices.length > 0 && (
        <>
          <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={slices.map((s) => `${s.label} ${kg(s.value)} kg`).join(", ")}>
            {slices.map((s) => (s.value > 0 ? <div key={s.label} style={{ flexGrow: s.value, background: s.color }} /> : null))}
          </div>
          <ul className="mt-3 grid grid-cols-3 gap-2">
            {slices.map((s) => (
              <li key={s.label}>
                <p className="text-muted-foreground flex items-center gap-1.5 text-[12px] whitespace-nowrap">
                  <span className="legend-dot size-2 shrink-0 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </p>
                <p className="tabular mt-0.5 text-[15px] font-semibold">
                  {kg(s.value)} <span className="text-muted-foreground text-[12px] font-normal">kg</span>
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      {details.length > 0 ? (
        <dl className={slices.length ? "border-border mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4" : "grid grid-cols-2 gap-x-4 gap-y-3"}>
          {details.map((d) => (
            <div key={d.key} className="flex min-w-0 items-center gap-2.5">
              <span className="bg-muted text-muted-foreground grid size-7 shrink-0 place-items-center rounded-lg">
                <d.icon className="size-3.5" strokeWidth={2.2} aria-hidden />
              </span>
              <div className="min-w-0">
                <dt className="text-muted-foreground truncate text-[12px]">{d.label}</dt>
                <dd className="tabular text-[15px] leading-tight font-semibold">
                  {kg(sheet!.scan[d.key]!, d.decimals ?? 1)} {d.unit && <span className="text-muted-foreground text-[12px] font-normal">{d.unit}</span>}
                </dd>
              </div>
            </div>
          ))}
        </dl>
      ) : (
        slices.length === 0 && <p className="text-muted-foreground text-[13px] leading-relaxed">Esta medición sólo trae el peso. Un escaneo de InBody añade músculo, grasa, agua y el resto.</p>
      )}
      {provenance && <p className="text-muted-foreground mt-4 text-[12px]">{provenance}</p>}
    </Card>
  );
}
