"use client";

import type { BodyMetric } from "@pulso/contract";
import { LineChart, Target, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardTitle } from "../../../_ui/card";
import { cn } from "../../../_ui/cn";
import { EmptyState } from "../../../_ui/empty-state";
import { Sparkline, type Point } from "../../../_ui/sparkline";
import { inputClass, kg, METRIC, METRIC_ORDER, primaryButton, problem, quietButton } from "./metrics";

/** One metric's trend, preformatted on the server so the browser's timezone changes nothing. */
export type TrendView = {
  metric: BodyMetric;
  points: Point[];
  current: number | null;
  note: string;
  horizons: { weeks: number; value: number; low: number; high: number; date: string }[];
  goal: { target: number; message: string } | null;
};

/** Trends over every reading (scans and Apple Health), the engine's projection at 4, 8 and 12 weeks, and the goal for each metric. */
export function TrendsCard({ trends, delay, className }: { trends: TrendView[]; delay: number; className?: string }) {
  const [metric, setMetric] = useState<BodyMetric>("weight");
  const trend = trends.find((t) => t.metric === metric)!;
  const meta = METRIC[metric];
  return (
    <Card delay={delay} className={className}>
      <div className="flex flex-wrap items-start justify-between gap-x-3">
        <CardTitle icon={LineChart} color="var(--domain-body)" title="Tendencia y proyección" />
        <div role="tablist" aria-label="Métrica" className="bg-muted mb-4 flex max-w-full overflow-x-auto rounded-xl p-1">
          {METRIC_ORDER.map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={m === metric}
              onClick={() => setMetric(m)}
              className={cn("focus-visible:ring-ring min-h-8 shrink-0 rounded-lg px-3 text-[13px] whitespace-nowrap font-medium outline-none focus-visible:ring-2", m === metric ? "bg-card shadow-1" : "text-muted-foreground hover:text-foreground")}
            >
              {METRIC[m].label}
            </button>
          ))}
        </div>
      </div>

      {trend.points.length === 0 ? (
        <EmptyState compact icon={TrendingUp} color={meta.color} title={`Sin lecturas de ${meta.label.toLowerCase()}`} line="Aparecen con tus mediciones de InBody o con el peso que sincroniza el iPhone desde Salud." />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <p className="flex items-baseline gap-1.5">
              <span className="tabular text-[34px] leading-none font-semibold tracking-tight">{trend.current != null ? kg(trend.current) : kg(trend.points.at(-1)!.value!)}</span>
              <span className="text-muted-foreground text-[14px]">{meta.unit}</span>
            </p>
            <p className="text-muted-foreground pb-0.5 text-[13px]">{trend.current != null ? `tendencia · ${trend.note}` : trend.note}</p>
          </div>
          <Sparkline points={trend.points} color={meta.color} height={128} unit={meta.unit} decimals={1} target={trend.goal?.target} label={`${meta.label}, lecturas de los últimos 120 días`} className="mt-4" />
          {trend.horizons.length > 0 && (
            <ul className="mt-5 grid grid-cols-3 gap-2.5">
              {trend.horizons.map((h) => (
                <li key={h.weeks} className="bg-muted/60 rounded-2xl p-3">
                  <p className="text-muted-foreground text-[12px] font-medium">
                    {h.weeks} semanas · {h.date}
                  </p>
                  <p className="tabular mt-1 text-[18px] font-semibold tracking-tight">
                    {kg(h.value)} <span className="text-muted-foreground text-[12px] font-normal">{meta.unit}</span>
                  </p>
                  <p className="tabular text-muted-foreground text-[11px]">
                    {kg(h.low)}–{kg(h.high)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <GoalRow key={metric} metric={metric} goal={trend.goal} />
    </Card>
  );
}

function GoalRow({ metric, goal }: { metric: BodyMetric; goal: TrendView["goal"] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(goal ? String(goal.target).replace(".", ",") : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const meta = METRIC[metric];

  async function save(target: number | null) {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/web/cuerpo/goals", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ metric, target }) });
    setBusy(false);
    if (!response.ok) return setError(await problem(response));
    setEditing(false);
    router.refresh();
  }

  const parsed = Number(value.replace(",", "."));
  const valid = value.trim() !== "" && Number.isFinite(parsed) && parsed > 0;

  return (
    <div className="border-border mt-5 border-t pt-4">
      {editing ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save(parsed);
          }}
        >
          <label className="text-muted-foreground text-[13px]" htmlFor={`goal-${metric}`}>
            Meta de {meta.label.toLowerCase()}
          </label>
          <input id={`goal-${metric}`} inputMode="decimal" autoFocus value={value} onChange={(e) => setValue(e.target.value)} className={cn(inputClass, "w-24")} placeholder={meta.unit} />
          <span className="text-muted-foreground text-[13px]">{meta.unit}</span>
          <button type="submit" disabled={!valid || busy} className={primaryButton}>
            Guardar
          </button>
          {goal && (
            <button type="button" disabled={busy} onClick={() => save(null)} className={quietButton}>
              Quitar
            </button>
          )}
          <button type="button" onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground min-h-10 px-2 text-[13px]">
            Cancelar
          </button>
        </form>
      ) : (
        <div className="flex items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: `color-mix(in oklab, ${meta.color} 16%, transparent)`, color: meta.color }}>
            <Target className="size-4" />
          </span>
          <p className="min-w-0 flex-1 text-[13px] leading-snug">{goal ? goal.message : <span className="text-muted-foreground">Sin meta de {meta.label.toLowerCase()}. Ponle una y te digo cuándo llegas a este ritmo.</span>}</p>
          <button onClick={() => setEditing(true)} className={quietButton}>
            {goal ? `Meta ${kg(goal.target)} ${meta.unit}` : "Poner meta"}
          </button>
        </div>
      )}
      {error && <p className="text-destructive mt-2 text-[13px]">{error}</p>}
    </div>
  );
}
