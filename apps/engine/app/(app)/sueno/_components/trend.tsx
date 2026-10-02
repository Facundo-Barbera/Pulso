"use client";

import { useState } from "react";
import { Segmented } from "../../../_ui/fields";
import { fmtMinutes } from "../../../_ui/format";
import { Sparkline } from "../../../_ui/sparkline";

export type TrendPoint = { label: string; minutes: number | null; score: number | null };

type Range = "14" | "30";
type Metric = "minutes" | "score";

const avg = (values: (number | null)[]) => {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Hours slept or the nightly score over the last 14 or 30 nights, with the window's average. */
export function SleepTrend({ points, targetMin }: { points: TrendPoint[]; targetMin: number }) {
  const [range, setRange] = useState<Range>("14");
  const [metric, setMetric] = useState<Metric>("minutes");
  const shown = points.slice(-Number(range));
  const values = shown.map((p) => p[metric]);
  const mean = avg(values);
  const nights = values.filter((v) => v !== null).length;
  const formatted = mean === null ? "—" : metric === "minutes" ? fmtMinutes(mean) : String(Math.round(mean));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<Metric> label="Qué mostrar" value={metric} onChange={setMetric} options={[{ value: "minutes", label: "Duración" }, { value: "score", label: "Puntuación" }]} />
        <Segmented<Range> label="Cuántas noches" value={range} onChange={setRange} options={[{ value: "14", label: "14 noches" }, { value: "30", label: "30 noches" }]} />
      </div>
      <p className="mt-5 flex items-baseline gap-2">
        <span className="tabular text-[26px] leading-none font-semibold tracking-tight">{formatted}</span>
        <span className="text-muted-foreground text-[13px]">
          de media · {nights} {nights === 1 ? "noche" : "noches"} con datos
        </span>
      </p>
      <Sparkline
        key={`${metric}-${range}`}
        className="mt-3"
        variant="bars"
        height={120}
        points={shown.map((p) => ({ label: p.label, value: p[metric] }))}
        color="var(--domain-sleep)"
        duration={metric === "minutes"}
        target={metric === "minutes" ? targetMin : undefined}
        targetLabel={`objetivo ${fmtMinutes(targetMin)}`}
        range={`Últimas ${range} noches`}
        label={metric === "minutes" ? `Horas dormidas, últimas ${range} noches` : `Puntuación, últimas ${range} noches`}
      />
    </div>
  );
}
