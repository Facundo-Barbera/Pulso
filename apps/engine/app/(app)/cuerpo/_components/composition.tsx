import type { BodyScan, BodyScanValues, Segmental } from "@pulso/contract";
import { PersonStanding, PieChart } from "lucide-react";
import { Card, CardTitle } from "../../../_ui/card";
import { cn } from "../../../_ui/cn";
import { kg } from "./metrics";

/** The other numbers on an InBody sheet, in the order the person reads them. Only the ones the scan carries are shown. */
const DETAILS: { key: keyof BodyScanValues; label: string; unit?: string; decimals?: number }[] = [
  { key: "bmi", label: "IMC", unit: "kg/m²" },
  { key: "visceralFatLevel", label: "Grasa visceral", unit: "nivel", decimals: 0 },
  { key: "bmr", label: "Metabolismo basal", unit: "kcal", decimals: 0 },
  { key: "totalBodyWater", label: "Agua corporal", unit: "L" },
  { key: "protein", label: "Proteína", unit: "kg" },
  { key: "mineral", label: "Minerales", unit: "kg", decimals: 2 },
  { key: "ecwRatio", label: "Ratio AEC/ACT", decimals: 3 },
  { key: "smi", label: "Índice músculo-esquelético", unit: "kg/m²" },
  { key: "waistHipRatio", label: "Cintura-cadera", decimals: 2 },
  { key: "visceralFatArea", label: "Área de grasa visceral", unit: "cm²", decimals: 0 },
  { key: "phaseAngle", label: "Ángulo de fase", unit: "°" },
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
            <div key={d.key} className="min-w-0">
              <dt className="text-muted-foreground truncate text-[12px]">{d.label}</dt>
              <dd className="tabular text-[15px] font-semibold">
                {kg(sheet!.scan[d.key]!, d.decimals ?? 1)} {d.unit && <span className="text-muted-foreground text-[12px] font-normal">{d.unit}</span>}
              </dd>
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

const SEGMENTS: { key: keyof Segmental; label: string; area: string }[] = [
  { key: "rightArm", label: "Brazo der.", area: "ra" },
  { key: "trunk", label: "Tronco", area: "tr" },
  { key: "leftArm", label: "Brazo izq.", area: "la" },
  { key: "rightLeg", label: "Pierna der.", area: "rl" },
  { key: "leftLeg", label: "Pierna izq.", area: "ll" },
];

/** Lean and fat mass per segment, laid out like the body (right side on the left, as the InBody sheet draws it). */
export function SegmentalCard({ lean, fat, date, delay }: { lean: Segmental | null; fat: Segmental | null; date?: string; delay: number }) {
  const balance = lean ? Math.abs(lean.rightArm - lean.leftArm) / Math.max(lean.rightArm, lean.leftArm) : 0;
  return (
    <Card delay={delay}>
      <CardTitle icon={PersonStanding} color="var(--domain-body)" title="Por segmento" />
      <div className="text-muted-foreground mb-3 flex gap-4 text-[12px]">
        {lean && (
          <span className="flex items-center gap-1.5">
            <span className="legend-dot bg-foreground size-2 rounded-full" /> Masa magra
          </span>
        )}
        {fat && (
          <span className="flex items-center gap-1.5">
            <span className="legend-dot size-2 rounded-full" style={{ background: "var(--domain-fat)" }} /> Grasa
          </span>
        )}
      </div>
      <div className="grid gap-2" style={{ gridTemplateAreas: '"ra tr la" "rl tr ll"', gridTemplateColumns: "1fr 1fr 1fr" }}>
        {SEGMENTS.map((s) => (
          <div key={s.key} className={cn("bg-muted/60 min-w-0 rounded-2xl p-3", s.key === "trunk" && "flex flex-col justify-center")} style={{ gridArea: s.area }}>
            <p className="text-muted-foreground truncate text-[12px] font-medium">{s.label}</p>
            {lean && (
              <p className="tabular mt-1 text-[16px] font-semibold whitespace-nowrap">
                {kg(lean[s.key])} <span className="text-muted-foreground text-[11px] font-normal">kg</span>
              </p>
            )}
            {fat && (
              <p className="tabular text-[13px] whitespace-nowrap" style={{ color: "var(--domain-fat)" }}>
                {kg(fat[s.key])} <span className="text-muted-foreground text-[11px]">kg grasa</span>
              </p>
            )}
          </div>
        ))}
      </div>
      {date && <p className="text-muted-foreground mt-3 text-[12px]">Del escaneo del {date}.</p>}
      {lean && <p className="text-muted-foreground mt-2 text-[12px]">{balance < 0.05 ? "Brazos equilibrados: menos de un 5 % de diferencia." : `Un brazo tiene un ${Math.round(balance * 100)} % más de masa magra que el otro.`}</p>}
    </Card>
  );
}
