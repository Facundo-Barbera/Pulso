import type { SleepNight, SleepStage } from "@pulso/contract";
import { CircleCheck, PenLine, StickyNote } from "lucide-react";
import { Card } from "../../../_ui/card";
import { cn } from "../../../_ui/cn";
import { EmptyState } from "../../../_ui/empty-state";
import { fmtMinutes, fmtTime } from "../../../_ui/format";
import { Ring } from "../../../_ui/ring";
import { ManualNightActions } from "./manual";

/**
 * The four stages as drawn, deepest last; Hoy's sleep card uses these too.
 * Asleep stages are one blue ramp apart by lightness, awake is orange: every
 * mark carries its label, so none depends on hue.
 */
export const STAGES = [
  { key: "awake", label: "Despierto", color: "var(--sleep-awake)" },
  { key: "rem", label: "REM", color: "var(--sleep-rem)" },
  { key: "core", label: "Ligero", color: "var(--sleep-core)" },
  { key: "deep", label: "Profundo", color: "var(--sleep-deep)" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

/** Which row a HealthKit sample draws in; unspecified "asleep" sits with light sleep. */
const ROW: Partial<Record<SleepStage, StageKey>> = { awake: "awake", rem: "rem", core: "core", deep: "deep", asleep: "core" };

/** Minutes from the night's midnight (negative = the evening before) → "23:40". */
export function clockOf(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function vsTarget(asleep: number, target: number): string {
  const diff = asleep - target;
  if (Math.abs(diff) < 5) return "Justo tu objetivo";
  return diff > 0 ? `${fmtMinutes(diff)} por encima de tu objetivo de ${fmtMinutes(target)}` : `${fmtMinutes(-diff)} por debajo de tu objetivo de ${fmtMinutes(target)}`;
}

/** The page's hero: the night's score, how long, against the target, and its stages in one bar. */
export function NightHero({ night, targetMin }: { night: SleepNight; targetMin: number }) {
  const m = night.minutes;
  const staged = m.deep + m.core + m.rem + m.awake;
  const met = m.asleep >= targetMin - 5;
  return (
    <Card className="relative overflow-hidden !p-6 md:!p-8">
      <div className="pointer-events-none absolute -top-32 -right-24 size-80 rounded-full opacity-[0.12] blur-3xl dark:opacity-20" style={{ background: "var(--domain-sleep)" }} aria-hidden />
      <div className="relative flex flex-col items-center gap-7 md:flex-row md:gap-10">
        <Ring value={night.score.value} color="var(--domain-sleep)" glow size={184} stroke={15} label={`Puntuación ${night.score.value} de 100`}>
          <div>
            <p className="tabular text-[52px] leading-none font-semibold tracking-tight">{night.score.value}</p>
            <p className="text-muted-foreground mt-1.5 text-[12px] font-medium tracking-wide uppercase">Puntuación</p>
          </div>
        </Ring>
        <div className="w-full min-w-0 flex-1">
          <p className="text-muted-foreground text-center text-[13px] font-medium md:text-left">Dormiste</p>
          <p className="tabular text-center text-[40px] leading-tight font-semibold tracking-tight md:text-left">{fmtMinutes(m.asleep)}</p>
          <p className={cn("mt-1 flex items-center justify-center gap-1.5 text-[15px] md:justify-start", met && "text-good font-medium")}>
            {met && <CircleCheck className="size-4 shrink-0" strokeWidth={2.4} aria-hidden />}
            {vsTarget(m.asleep, targetMin)}
          </p>
          {night.manual ? (
            <ManualDetails night={night} manual={night.manual} />
          ) : (
            <p className="text-muted-foreground mt-1 text-center text-[13px] md:text-left">
              {fmtTime(night.asleepStart)} – {fmtTime(night.asleepEnd)} · {Math.round(night.efficiency * 100)} % de eficiencia · {night.source}
            </p>
          )}
          {staged > 0 && night.stagePct && (
            <div className="mt-5">
              <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={[...STAGES].reverse().map((s) => `${s.label} ${fmtMinutes(m[s.key])}`).join(", ")}>
                {[...STAGES].reverse().map((s) => (m[s.key] > 0 ? <div key={s.key} style={{ flexGrow: m[s.key], background: s.color }} title={`${s.label}: ${fmtMinutes(m[s.key])}`} /> : null))}
              </div>
              <div className="text-muted-foreground mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                {[...STAGES].reverse().map((s) => (
                  <span key={s.key} className="flex items-center gap-1.5">
                    <span className="legend-dot size-2 rounded-full" style={{ background: s.color }} />
                    {s.label} <span className="tabular text-foreground font-medium">{fmtMinutes(m[s.key])}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          <p className="text-muted-foreground mt-4 text-center text-[14px] leading-relaxed md:text-left">{night.score.explanation}</p>
        </div>
      </div>
    </Card>
  );
}

/** A night logged by hand: its times, a label that says so (icon and words), the note, and Editar / Borrar. Efficiency isn't shown: it wasn't measured. */
function ManualDetails({ night, manual }: { night: SleepNight; manual: NonNullable<SleepNight["manual"]> }) {
  return (
    <>
      <p className="text-muted-foreground mt-1 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 text-[13px] md:justify-start">
        <span className="tabular">
          {fmtTime(night.asleepStart)} – {fmtTime(night.asleepEnd)}
        </span>
        <span className="bg-muted text-foreground/80 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium">
          <PenLine className="size-3.5" aria-hidden />
          Registrada a mano
        </span>
      </p>
      {manual.note && (
        <p className="bg-muted/60 mx-auto mt-3 flex w-fit max-w-full items-start md:mx-0 gap-2 rounded-xl px-3.5 py-2.5 text-[14px] leading-relaxed">
          <StickyNote className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-label="Nota" />
          <span className="min-w-0 break-words">{manual.note}</span>
        </p>
      )}
      <div className="mt-4">
        <ManualNightActions night={{ id: manual.id, start: night.asleepStart, end: night.asleepEnd, note: manual.note }} />
      </div>
    </>
  );
}

/** What the Fases card shows for a night logged by hand: there are no stages to draw. */
export function NoStages() {
  return <EmptyState compact icon={PenLine} color="var(--domain-sleep)" title="Sin fases" line="Una noche registrada a mano solo tiene la hora de dormir y la de despertar." />;
}

/** The night as a hypnogram: one row per stage, time across. Server-drawn SVG; labels are HTML so they stay crisp. */
export function Hypnogram({ night }: { night: SleepNight }) {
  const start = night.inBedStart;
  const span = Math.max(1, night.inBedEnd - start);
  const x = (t: number) => ((t - start) / span) * 1000;
  const rows = STAGES.map((s) => s.key);
  const ROW_H = 26;
  // Whole hours inside the night, for the axis.
  const hours: number[] = [];
  for (let t = Math.ceil(start / 3_600_000) * 3_600_000; t < night.inBedEnd; t += 3_600_000) hours.push(t);
  const step = hours.length > 8 ? 2 : 1;

  return (
    <div>
      <div className="grid grid-cols-[72px_1fr] items-stretch gap-x-3">
        <div className="grid" style={{ gridTemplateRows: `repeat(${rows.length}, ${ROW_H}px)` }}>
          {STAGES.map((s) => (
            <span key={s.key} className="text-muted-foreground flex items-center gap-1.5 text-[12px]">
              <span className="legend-dot size-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        <svg viewBox={`0 0 1000 ${rows.length * ROW_H}`} preserveAspectRatio="none" className="block w-full" style={{ height: rows.length * ROW_H }} role="img" aria-label="Hipnograma de la noche">
          {rows.map((_, i) => (
            <line key={i} x1="0" x2="1000" y1={i * ROW_H + ROW_H / 2} y2={i * ROW_H + ROW_H / 2} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          {night.segments.map((seg, i) => {
            const row = ROW[seg.stage];
            if (!row) return null;
            const r = rows.indexOf(row);
            const stage = STAGES[r]!;
            return (
              <rect key={i} x={x(seg.start)} y={r * ROW_H + 4} width={Math.max(1.5, x(seg.end) - x(seg.start))} height={ROW_H - 8} rx="3" fill={stage.color} opacity={seg.stage === "asleep" ? 0.55 : 1}>
                <title>{`${stage.label}: ${fmtTime(seg.start)} – ${fmtTime(seg.end)}`}</title>
              </rect>
            );
          })}
        </svg>
      </div>
      <div className="relative mt-2 ml-[84px] h-4">
        {hours
          .filter((_, i) => i % step === 0)
          .map((t) => (
            <span key={t} className="text-muted-foreground tabular absolute -translate-x-1/2 text-[11px]" style={{ left: `${x(t) / 10}%` }}>
              {fmtTime(t).slice(0, 2)}
            </span>
          ))}
      </div>
      <div className="border-border mt-5 grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4">
        {[...STAGES].reverse().map((s) => (
          <div key={s.key}>
            <p className="text-muted-foreground flex items-center gap-1.5 text-[12px] font-medium">
              <span className="legend-dot size-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </p>
            <p className="tabular mt-1 text-[18px] font-semibold tracking-tight">{fmtMinutes(night.minutes[s.key])}</p>
            {night.stagePct && s.key !== "awake" && <p className="text-muted-foreground text-[12px]">{Math.round(night.stagePct[s.key] * 100)} % del sueño</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
