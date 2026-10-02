import type { BodyMetric, BodyScan } from "@pulso/contract";
import { ArrowDown, ArrowUp, CalendarDays, CircleAlert, CircleCheck, Equal } from "lucide-react";
import type { BodyOverview, BodyReading } from "@/src/web/cuerpo";
import { Card } from "../../../_ui/card";
import { cn } from "../../../_ui/cn";
import { fmtShortDate } from "../../../_ui/format";
import { isProgress, kg, METRIC } from "./metrics";

const sourceLabel = (scan: BodyScan) => (scan.source === "inbody" ? (scan.device ? `InBody ${scan.device}` : "InBody") : "A mano");

/**
 * The page's one hero: the latest scan, weight front and centre, fat and
 * muscle around it, each with how it moved. A metric the latest scan lacks
 * shows its newest earlier reading, dated.
 */
export function BodyHero({ scan, readings, goals, date }: { scan: BodyScan; readings: BodyOverview["readings"]; goals: Map<BodyMetric, number>; date: string }) {
  const tiles: BodyMetric[] = ["percentBodyFat", "skeletalMuscleMass", "bodyFatMass"];
  return (
    <Card className="relative overflow-hidden !p-6 md:!p-8">
      <div className="pointer-events-none absolute -top-40 -left-24 size-96 rounded-full opacity-[0.16] blur-3xl dark:opacity-25" style={{ background: "var(--domain-body)" }} aria-hidden />
      <div className="relative">
        <div className="text-muted-foreground flex items-center gap-2 text-[13px] font-medium">
          <CalendarDays className="size-4" />
          <span className="first-letter:uppercase">{date}</span>
          <span className="bg-muted text-foreground ml-auto rounded-full px-2.5 py-1 text-[12px]">{sourceLabel(scan)}</span>
        </div>
        <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-end lg:gap-8">
          <div className="min-w-0 lg:w-[38%]">
            <p className="text-muted-foreground flex items-center gap-2 text-[14px] font-medium">
              <Tint metric="weight" />
              Peso
            </p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="tabular text-[64px] leading-none font-semibold tracking-tight md:text-[72px]">{readings.weight ? kg(readings.weight.value) : "—"}</span>
              <span className="text-muted-foreground text-[20px] font-medium">kg</span>
            </p>
            <Change metric="weight" reading={readings.weight} latestAt={scan.measuredAt} goal={goals.get("weight")} className="mt-3" />
          </div>
          <ul className="grid flex-1 grid-cols-3 gap-2 sm:gap-3">
            {tiles.map((metric) => (
              <li key={metric} className="bg-muted/60 min-w-0 rounded-2xl p-3 sm:p-4">
                <p className="text-muted-foreground flex min-w-0 flex-col items-start gap-1 text-[12px] font-medium sm:flex-row sm:items-center sm:gap-1.5">
                  <Tint metric={metric} />
                  <span className="max-w-full truncate">{METRIC[metric].label}</span>
                </p>
                <p className="mt-1.5 flex items-baseline gap-1">
                  <span className="tabular text-[22px] leading-none font-semibold tracking-tight sm:text-[28px]">{readings[metric] ? kg(readings[metric].value) : "—"}</span>
                  <span className="text-muted-foreground text-[13px]">{METRIC[metric].unit}</span>
                </p>
                <Change metric={metric} reading={readings[metric]} latestAt={scan.measuredAt} goal={goals.get(metric)} compact className="mt-2" />
              </li>
            ))}
          </ul>
        </div>
        {scan.inbodyScore != null && (
          <p className="text-muted-foreground mt-5 text-[13px]">
            Puntuación InBody <span className="tabular text-foreground font-semibold">{kg(scan.inbodyScore, 0)}</span> de 100
          </p>
        )}
      </div>
    </Card>
  );
}

/** The metric's icon on a soft disc of its colour: identity by shape and label, not hue alone. */
function Tint({ metric }: { metric: BodyMetric }) {
  const { icon: Icon, color } = METRIC[metric];
  return (
    <span className="grid size-5 shrink-0 place-items-center rounded-md" style={{ background: `color-mix(in oklab, ${color} 18%, transparent)`, color }}>
      <Icon className="size-3" strokeWidth={2.4} aria-hidden />
    </span>
  );
}

/**
 * "↓ 1,2 kg desde el 3 mar". The arrow is the direction; whether that is good
 * is a check (blue) or an alert (orange), never the colour alone; grey when
 * flat. Dated when older than the latest scan.
 */
function Change({ metric, reading, latestAt, goal, compact, className }: { metric: BodyMetric; reading: BodyReading | null; latestAt: number; goal?: number; compact?: boolean; className?: string }) {
  const stale = reading && reading.at !== latestAt ? <span className="text-muted-foreground font-normal">medido el {fmtShortDate(reading.at)}</span> : null;
  if (!reading || reading.delta === null || reading.since === null) {
    return <p className={cn("text-muted-foreground flex flex-wrap gap-x-1.5 text-[12px]", className)}>{stale ?? (!reading ? "Sin datos" : compact ? "Sin comparación" : "Tu primera medición")}</p>;
  }
  const good = isProgress(metric, reading.delta, reading.value, goal);
  const Icon = good === null ? Equal : reading.delta < 0 ? ArrowDown : ArrowUp;
  const Verdict = good === null ? null : good ? CircleCheck : CircleAlert;
  const verdict = good === null ? "sin cambio" : good ? "a tu favor" : "en contra de tu objetivo";
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1.5 text-[12px] font-medium", good === null ? "text-muted-foreground" : good ? "text-good" : "text-caution", className)}>
      <span className="flex items-center gap-0.5" title={verdict}>
        <Icon className="size-3.5" strokeWidth={2.4} aria-hidden />
        <span className="tabular">
          {kg(Math.abs(reading.delta))} {METRIC[metric].unit === "%" ? "pts" : METRIC[metric].unit}
        </span>
        {Verdict && <Verdict className="ml-0.5 size-3.5" strokeWidth={2.4} aria-hidden />}
        <span className="sr-only">, {verdict}</span>
      </span>
      {stale ?? <span className="text-muted-foreground font-normal">desde el {fmtShortDate(reading.since)}</span>}
    </p>
  );
}
