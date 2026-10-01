import type { SleepNight, SleepSummary } from "@pulso/contract";
import { BedDouble, ChartColumn, ChevronLeft, ChevronRight, Gauge, Hourglass, Moon, Sparkles, Waves } from "lucide-react";
import Link from "next/link";
import { localDate } from "@/src/daily/dates";
import { sleepPage } from "@/src/web/sleep";
import { Card, CardTitle } from "../../_ui/card";
import { cn } from "../../_ui/cn";
import { EmptyState } from "../../_ui/empty-state";
import { fmtDayLabel, fmtLongDate, fmtMinutes } from "../../_ui/format";
import { Page, PageHeader } from "../../_ui/page-header";
import { Ring } from "../../_ui/ring";
import { clockOf, Hypnogram, NightHero } from "./_components/night";
import { TargetControl } from "./_components/target";
import { SleepTrend } from "./_components/trend";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sueño" };

const SLEEP = "var(--domain-sleep)";

/** Sueño: one night in full as the hero (‹ › to walk back), then its stages, score, the trend, schedule and target. */
export default async function Sueno({ searchParams }: { searchParams: Promise<{ noche?: string }> }) {
  const { noche } = await searchParams;
  const page = sleepPage(noche);
  const { night, summary, targetMin } = page;
  const today = localDate();

  return (
    <Page>
      <PageHeader
        eyebrow={night ? (night.night === today ? `Anoche · ${fmtLongDate(new Date(`${night.night}T12:00:00`))}` : `Noche al ${fmtLongDate(new Date(`${night.night}T12:00:00`))}`) : undefined}
        title="Sueño"
        subtitle={summary.nights ? `Media de ${fmtMinutes(summary.avgAsleepMin ?? 0)} en las últimas ${summary.nights} noches.` : undefined}
        actions={night && <NightNav older={page.older} newer={page.newer} />}
      />
      {!night ? (
        <div className="grid gap-5 md:grid-cols-2">
          <Card className="md:col-span-2">
            <EmptyState icon={Moon} color={SLEEP} title="Aún no hay noches" line="Duerme con tu Apple Watch y sincroniza Salud desde el iPhone: tus noches aparecerán aquí." />
          </Card>
          <Card delay={60}>
            <CardTitle icon={Hourglass} color={SLEEP} title="Tu objetivo" />
            <TargetControl targetMin={targetMin} />
          </Card>
        </div>
      ) : (
        <>
          <NightHero night={night} targetMin={targetMin} />
          <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <Card delay={60} className="md:col-span-2">
              <CardTitle icon={Waves} color={SLEEP} title="Fases" />
              <Hypnogram night={night} />
            </Card>
            <ScoreCard night={night} delay={110} />
            <Card delay={160} className="md:col-span-2">
              <CardTitle icon={ChartColumn} color={SLEEP} title="Tendencia" />
              <SleepTrend targetHours={targetMin / 60} points={page.trend.map((p) => ({ label: fmtDayLabel(p.night), hours: p.asleepMin === null ? null : Math.round((p.asleepMin / 60) * 10) / 10, score: p.score }))} />
            </Card>
            <InsightsCard night={night} summary={summary} delay={210} />
            <ScheduleCard summary={summary} delay={260} />
            <DebtCard summary={summary} targetMin={targetMin} delay={310} />
          </div>
        </>
      )}
    </Page>
  );
}

function NightNav({ older, newer }: { older: string | null; newer: string | null }) {
  const button = "bg-card shadow-1 text-foreground hover:bg-accent focus-visible:ring-ring app-no-drag grid size-10 place-items-center rounded-full outline-none focus-visible:ring-2";
  const off = "pointer-events-none opacity-35";
  return (
    <nav className="flex gap-2" aria-label="Otras noches">
      <Link href={older ? `/sueno?noche=${older}` : "#"} className={cn(button, !older && off)} aria-label="Noche anterior" aria-disabled={!older}>
        <ChevronLeft className="size-4" />
      </Link>
      <Link href={newer ? `/sueno?noche=${newer}` : "#"} className={cn(button, !newer && off)} aria-label="Noche siguiente" aria-disabled={!newer}>
        <ChevronRight className="size-4" />
      </Link>
    </nav>
  );
}

function ScoreCard({ night, delay }: { night: SleepNight; delay: number }) {
  return (
    <Card delay={delay}>
      <CardTitle icon={Gauge} color={SLEEP} title="Puntuación" />
      <ul className="space-y-4">
        {night.score.factors.map((f) => (
          <li key={f.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[14px] font-medium">{f.label}</span>
              <span className="tabular text-muted-foreground text-[13px]">
                <span className="text-foreground font-semibold">{f.points}</span>/{f.maxPoints}
              </span>
            </div>
            <div className="bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full">
              <div className="h-full rounded-full" style={{ width: `${(f.points / f.maxPoints) * 100}%`, background: SLEEP }} />
            </div>
            <p className="text-muted-foreground mt-1 text-[12px]">{f.detail}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function InsightsCard({ night, summary, delay }: { night: SleepNight; summary: SleepSummary; delay: number }) {
  const lines = [...night.insights, ...summary.insights];
  return (
    <Card delay={delay}>
      <CardTitle icon={Sparkles} color={SLEEP} title="Lo que vemos" />
      {lines.length === 0 ? (
        <EmptyState compact icon={Sparkles} color={SLEEP} title="Nada que destacar" line="Con unas noches más podremos comparar esta con tu costumbre." />
      ) : (
        <ul className="space-y-2.5">
          {lines.map((line) => (
            <li key={line} className="flex gap-2.5 text-[14px] leading-relaxed">
              <span className="mt-2 size-1.5 shrink-0 rounded-full" style={{ background: SLEEP }} />
              {line}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ScheduleCard({ summary, delay }: { summary: SleepSummary; delay: number }) {
  const row = (label: string, min: number | null, sd: number | null) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground text-[13px]">{label}</span>
      <span className="text-[15px]">
        <span className="tabular font-semibold">{min === null ? "—" : clockOf(min)}</span>
        {sd !== null && <span className="text-muted-foreground tabular ml-1.5 text-[12px]">±{sd} min</span>}
      </span>
    </div>
  );
  return (
    <Card delay={delay}>
      <CardTitle icon={BedDouble} color={SLEEP} title="Horarios" />
      <div className="flex items-center gap-5">
        <Ring value={summary.regularity} color={SLEEP} size={88} stroke={9} label={summary.regularity === null ? "Regularidad sin datos" : `Regularidad ${summary.regularity} de 100`}>
          <span className="tabular text-[22px] font-semibold">{summary.regularity ?? "—"}</span>
        </Ring>
        <div className="min-w-0 flex-1 space-y-2.5">
          {row("Te acuestas", summary.avgBedtimeMin, summary.bedtimeSdMin)}
          {row("Te despiertas", summary.avgWakeMin, summary.wakeSdMin)}
        </div>
      </div>
      <p className="text-muted-foreground mt-4 text-[12px] leading-relaxed">
        Regularidad: cuánto se parecen tus horas de dormir y despertar de un día a otro{summary.nights ? `, en las últimas ${summary.nights} noches` : ""}.
      </p>
    </Card>
  );
}

function DebtCard({ summary, targetMin, delay }: { summary: SleepSummary; targetMin: number; delay: number }) {
  return (
    <Card delay={delay}>
      <CardTitle icon={Hourglass} color={SLEEP} title="Deuda de sueño" />
      <p className="flex items-baseline gap-2">
        <span className="tabular text-[26px] leading-none font-semibold tracking-tight">{summary.debtMin >= 5 ? fmtMinutes(summary.debtMin) : "Sin deuda"}</span>
        <span className="text-muted-foreground text-[13px]">en {summary.nights} noches</span>
      </p>
      <p className="text-muted-foreground mt-1.5 text-[12px]">Lo que te faltó para llegar a {fmtMinutes(targetMin)} cada noche, sumado.</p>
      <div className="border-border mt-5 border-t pt-4">
        <TargetControl targetMin={targetMin} />
      </div>
    </Card>
  );
}
