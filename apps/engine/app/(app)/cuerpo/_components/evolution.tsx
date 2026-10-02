"use client";

import { ChartSpline, ScanLine } from "lucide-react";
import { useState } from "react";
import { Card, CardTitle } from "../../../_ui/card";
import { cn } from "../../../_ui/cn";
import { EmptyState } from "../../../_ui/empty-state";
import { kg, METRIC } from "./metrics";

/** One full scan, dated on the server. */
export type EvolutionPoint = { label: string; weight: number; skeletalMuscleMass: number; bodyFatMass: number };

const SERIES = (["weight", "skeletalMuscleMass", "bodyFatMass"] as const).map((key) => ({ key, ...METRIC[key] }));

const W = 600;
const H = 180;
const PAD = { top: 12, bottom: 12 };

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${kg(Math.abs(n))}`;

/**
 * Weight, muscle and fat mass across InBody scans on one axis: kg changed
 * since the first scan, so three masses of different size share a scale.
 */
export function EvolutionCard({ points, delay, className }: { points: EvolutionPoint[]; delay: number; className?: string }) {
  const [active, setActive] = useState<number | null>(null);
  if (points.length < 2) {
    return (
      <Card delay={delay} className={className}>
        <CardTitle icon={ChartSpline} color="var(--domain-body)" title="Evolución" />
        <EmptyState compact icon={ScanLine} color="var(--domain-body)" title="Hace falta otro escaneo" line="Con dos escaneos de InBody verás cómo cambian peso, músculo y grasa entre uno y otro." action={{ href: "#anadir", label: "Añadir medición" }} />
      </Card>
    );
  }

  const first = points[0]!;
  const deltas = points.map((p) => SERIES.map((s) => p[s.key] - first[s.key]));
  const all = deltas.flat();
  const top = Math.max(...all, 0.5);
  const bottom = Math.min(...all, -0.5);
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => PAD.top + ((top - v) / (top - bottom)) * (H - PAD.top - PAD.bottom);
  const shown = active ?? points.length - 1;

  function pick(e: React.PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    setActive(Math.round(((e.clientX - box.left) / box.width) * (points.length - 1)));
  }

  return (
    <Card delay={delay} className={cn("flex flex-col", className)}>
      <CardTitle icon={ChartSpline} color="var(--domain-body)" title="Evolución" />
      <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-2">
        {SERIES.map((s, i) => (
          <li key={s.key} className="min-w-0">
            <p className="text-muted-foreground flex items-center gap-1.5 text-[12px] font-medium">
              <span className="legend-dot h-0.5 w-3.5 rounded-full" style={{ background: s.color }} />
              {s.label}
            </p>
            <p className="tabular text-[17px] font-semibold">
              {signed(deltas[shown]![i]!)} <span className="text-muted-foreground text-[12px] font-normal">kg</span>
            </p>
          </li>
        ))}
        <li className="text-muted-foreground ml-auto self-end pb-0.5 text-right text-[12px]">
          {active === null ? `desde el ${first.label}` : `${points[shown]!.label} · desde el ${first.label}`}
        </li>
      </ul>
      <div className="relative min-h-48 flex-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full touch-pan-y overflow-visible"
          role="img"
          aria-label={`Cambio desde el ${first.label}: ${SERIES.map((s, i) => `${s.label} ${signed(deltas.at(-1)![i]!)} kg`).join(", ")}`}
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={() => setActive(null)}
        >
          <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          {active !== null && <line x1={x(active)} x2={x(active)} y1="0" y2={H} stroke="var(--muted-foreground)" strokeOpacity="0.5" vectorEffect="non-scaling-stroke" />}
          {SERIES.map((s, i) => (
            <polyline
              key={s.key}
              points={deltas.map((d, j) => `${x(j)},${y(d[i]!)}`).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {/* Dots in HTML so they stay round while the SVG stretches. */}
        {SERIES.map((s, i) => (
          <span
            key={s.key}
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${(x(shown) / W) * 100}%`, top: `${(y(deltas[shown]![i]!) / H) * 100}%`, background: s.color, boxShadow: "0 0 0 2px var(--card)" }}
          />
        ))}
        <span className="text-muted-foreground tabular pointer-events-none absolute right-0 text-[10px]" style={{ top: `calc(${(y(0) / H) * 100}% - 14px)` }}>
          0 kg
        </span>
      </div>
      <div className="text-muted-foreground mt-2 flex justify-between text-[11px]">
        <span>{first.label}</span>
        <span>{points.at(-1)!.label}</span>
      </div>
    </Card>
  );
}
