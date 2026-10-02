"use client";

import type { BodyAnalysis, BodyBand, SegmentKey, SegmentValue } from "@pulso/contract";
import { Check, Droplet, PersonStanding, Scale } from "lucide-react";
import { useState } from "react";
import { Card, CardTitle } from "../../../_ui/card";
import { cn } from "../../../_ui/cn";
import { Segmented } from "../../../_ui/fields";
import { BAND_LABEL, kg } from "./metrics";

/**
 * A neutral front-view figure, 200 × 410, split the way InBody measures it.
 * The person's right side is drawn on the left, as on the result sheet.
 */
const ARM = "M58 82C46 84 42 96 41 112L36 172L30 232C29 244 42 246 43 234L50 174L58 124Z";
const LEG = "M67 242L98 242L96 300L92 360L90 396C90 406 74 406 74 396L72 360L66 300Z";
const mirror = "translate(200 0) scale(-1 1)";
export const FIGURE: Record<SegmentKey, { d: string; transform?: string }> = {
  rightArm: { d: ARM },
  leftArm: { d: ARM, transform: mirror },
  trunk: { d: "M64 86C64 76 76 72 100 72C124 72 136 76 136 86L132 160C130 185 128 200 132 222L134 236L66 236L68 222C72 200 70 185 68 160Z" },
  rightLeg: { d: LEG },
  leftLeg: { d: LEG, transform: mirror },
};

/** Sequential, one hue: deeper means more against the standard. The band is also written beside each segment. */
const STRENGTH: Record<BodyBand, number> = { low: 32, normal: 62, high: 92 };
const fill = (color: string, band: BodyBand | null) => `color-mix(in oklab, ${color} ${band ? STRENGTH[band] : 50}%, var(--card))`;

const NAMES: Record<SegmentKey, string> = { rightArm: "Brazo der.", leftArm: "Brazo izq.", trunk: "Tronco", rightLeg: "Pierna der.", leftLeg: "Pierna izq." };

type Mode = "lean" | "fat";
const MODE = {
  lean: { label: "Magra", color: "var(--domain-body)", other: "fat" as Mode, otherLabel: "grasa" },
  fat: { label: "Grasa", color: "var(--domain-fat)", other: "lean" as Mode, otherLabel: "magra" },
};

/** InBody's segmental analysis as a body: each segment tinted by its lean (or fat) mass against the standard, values beside it, and how balanced the sides are. */
export function SegmentFigure({ segments, date, delay, className }: { segments: NonNullable<BodyAnalysis["segments"]>; date?: string; delay: number; className?: string }) {
  const [mode, setMode] = useState<Mode>(segments.lean ? "lean" : "fat");
  const values = segments[mode]!;
  const other = segments[MODE[mode].other];
  const color = MODE[mode].color;
  const label = (key: SegmentKey, align: "left" | "right" | "center") => (
    <SegmentLabel key={key} name={NAMES[key]} value={values[key]} other={other?.[key]} otherLabel={MODE[mode].otherLabel} color={color} align={align} />
  );

  return (
    <Card delay={delay} className={className}>
      <div className="flex flex-wrap items-start justify-between gap-x-3">
        <CardTitle icon={PersonStanding} color="var(--domain-body)" title="Por segmento" />
        {segments.lean && segments.fat && (
          <Segmented
            label="Qué masa"
            value={mode}
            onChange={setMode}
            options={[
              { value: "lean", label: "Magra" },
              { value: "fat", label: "Grasa" },
            ]}
            className="mb-4"
          />
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] grid-rows-[11fr_9fr] items-center gap-x-1.5 sm:gap-x-3">
        <div className="row-start-1">{label("rightArm", "right")}</div>
        <div className="row-start-2">{label("rightLeg", "right")}</div>
        <figure className="col-start-2 row-span-2 row-start-1 flex w-[108px] flex-col items-center gap-2 sm:w-[124px]">
          <svg viewBox="0 0 200 410" className="h-auto w-full" role="img" aria-label={Object.keys(NAMES).map((k) => `${NAMES[k as SegmentKey]}: ${BAND_LABEL[values[k as SegmentKey].band ?? "normal"]}`).join(", ")}>
            <circle cx="100" cy="38" r="24" fill="var(--muted)" />
            <rect x="91" y="58" width="18" height="18" rx="6" fill="var(--muted)" />
            {(Object.keys(FIGURE) as SegmentKey[]).map((key) => (
              <path
                key={key}
                d={FIGURE[key].d}
                transform={FIGURE[key].transform}
                fill={fill(color, values[key].band)}
                stroke="var(--card)"
                strokeWidth="2"
                strokeLinejoin="round"
                className="motion-safe:transition-[fill] motion-safe:duration-300"
              />
            ))}
          </svg>
          {label("trunk", "center")}
        </figure>
        <div className="col-start-3 row-start-1">{label("leftArm", "left")}</div>
        <div className="col-start-3 row-start-2">{label("leftLeg", "left")}</div>
      </div>

      <Legend color={color} />

      {segments.balance.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Equilibrio">
          {segments.balance.map((b) => (
            <li key={b.text} className="bg-muted/70 flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium">
              {b.even ? <Check className="text-good size-3.5" strokeWidth={2.6} aria-hidden /> : <Scale className="text-caution size-3.5" strokeWidth={2.2} aria-hidden />}
              {b.text}
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground mt-3 text-[12px] leading-relaxed">
        {segments.basis === "height" ? "% del estándar para tu altura." : "% respecto a tu propio peso: añade tu altura al perfil para compararlo con el estándar."}
        {date && ` Del escaneo del ${date}.`}
      </p>
    </Card>
  );
}

function SegmentLabel({ name, value, other, otherLabel, color, align }: { name: string; value: SegmentValue; other?: SegmentValue; otherLabel: string; color: string; align: "left" | "right" | "center" }) {
  const center = align === "center";
  return (
    <div className={cn("min-w-0", align === "right" && "text-right", center && "text-center")}>
      <p className="text-muted-foreground truncate text-[12px] font-medium">{name}</p>
      <p className="tabular text-[17px] leading-tight font-semibold whitespace-nowrap">
        {kg(value.kg)} <span className="text-muted-foreground text-[11px] font-normal">kg</span>
      </p>
      {value.percent != null && value.band && (
        <p className={cn("flex flex-wrap items-center gap-x-1 text-[11px] font-medium", align === "right" && "justify-end", center && "justify-center")}>
          <span className="flex items-center gap-1 whitespace-nowrap">
            <span className="legend-dot size-2 shrink-0 rounded-full" style={{ background: fill(color, value.band) }} />
            {BAND_LABEL[value.band]}
          </span>
          <span className="tabular text-muted-foreground whitespace-nowrap">{value.percent} %</span>
        </p>
      )}
      {other && (
        <p className={cn("text-muted-foreground tabular mt-0.5 flex items-center gap-1 text-[11px] whitespace-nowrap", align === "right" && "justify-end")}>
          {otherLabel === "grasa" && <Droplet className="size-3" aria-hidden />}
          {kg(other.kg)} kg {otherLabel}
        </p>
      )}
    </div>
  );
}

function Legend({ color }: { color: string }) {
  return (
    <div className="text-muted-foreground mt-4 flex items-center justify-center gap-3 text-[11px]" aria-hidden>
      {(["low", "normal", "high"] as const).map((band) => (
        <span key={band} className="flex items-center gap-1.5">
          <span className="legend-dot h-2.5 w-4 rounded-full" style={{ background: fill(color, band) }} />
          {BAND_LABEL[band]}
        </span>
      ))}
    </div>
  );
}
