import type { Substance, SubstanceSummary } from "@pulso/contract";
import { CalendarDays, Clock, EyeOff, Leaf, ListOrdered, Moon, Target } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { SUBSTANCES } from "@/src/substances/store";
import { substanceOverview } from "@/src/substances/summary";
import { shownHere } from "@/src/substances/web";
import { fromTailnet } from "@/src/tailnet-gate";
import { Card, CardTitle } from "../../_ui/card";
import { cn } from "../../_ui/cn";
import { EmptyState } from "../../_ui/empty-state";
import { fmtDayLabel, fmtNumber, fmtShortDate } from "../../_ui/format";
import { Page, PageHeader } from "../../_ui/page-header";
import { Sparkline } from "../../_ui/sparkline";
import { LogButton } from "./_components/entry-sheet";
import { EntryList } from "./_components/entries";
import { GoalEditor } from "./_components/goal";
import { COLOR, SUBSTANCE_LABEL } from "./_components/labels";
import { VisibilityToggle } from "./_components/visibility";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sustancias" };

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];
const LEVEL_MIX = [0, 35, 65, 100];

/**
 * Sustancias: a private log of cannabis (and alcohol or nicotine) use, to see
 * how often. Not in the sidebar: reached from Ajustes or ⌘K, and only on a
 * browser where the person turned it on (the Mac by default).
 */
export default async function Sustancias({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const head = await headers();
  const local = !fromTailnet(head);
  if (!shownHere(head)) {
    return (
      <Page>
        <PageHeader title="Sustancias" />
        <Card>
          <EmptyState icon={EyeOff} color="var(--muted-foreground)" title="Oculto en este navegador" line="Esta sección sólo se ve donde la activas. Puedes mostrarla aquí; ningún otro navegador cambia." />
          <div className="mx-auto max-w-sm">
            <VisibilityToggle visible={false} local={local} />
          </div>
        </Card>
      </Page>
    );
  }

  const param = (await searchParams).s;
  const substance: Substance = SUBSTANCES.includes(param as Substance) ? (param as Substance) : "cannabis";
  const { summary, entries, settings } = substanceOverview(substance);
  const labels = Object.fromEntries(entries.map((e) => [e.date, fmtDayLabel(e.date)]));
  const never = summary.lastUse === null;

  return (
    <Page>
      <PageHeader title="Sustancias" subtitle="Sólo para ti: cuándo y cuánto, sin juicios." actions={<LogButton substance={substance} />} />
      <nav aria-label="Sustancia" className="bg-muted/70 mb-5 inline-flex rounded-full p-1">
        {SUBSTANCES.map((s) => (
          <Link
            key={s}
            href={s === "cannabis" ? "/sustancias" : `/sustancias?s=${s}`}
            aria-current={s === substance ? "page" : undefined}
            className={cn("focus-visible:ring-ring min-h-9 rounded-full px-4 py-2 text-[13px] font-medium outline-none focus-visible:ring-2", s === substance ? "bg-card shadow-1" : "text-muted-foreground hover:text-foreground")}
          >
            {SUBSTANCE_LABEL[s]}
          </Link>
        ))}
      </nav>

      {never ? (
        <Card>
          <EmptyState icon={Leaf} color={COLOR} title={`Nada de ${SUBSTANCE_LABEL[substance].toLowerCase()} registrado`} line="Registra cuando consumas y aquí verás con qué frecuencia, a qué hora y cómo duermes esas noches." />
        </Card>
      ) : (
        <>
          <Hero summary={summary} />
          <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <WeeksCard summary={summary} />
            <TimeCard summary={summary} />
            <SleepCard summary={summary} />
            <Card delay={210}>
              <CardTitle icon={Target} color={COLOR} title="Tu objetivo" />
              {summary.goal && (
                <p className="mb-4 text-[14px]">
                  Esta semana: <span className="tabular font-semibold">{summary.goal.daysThisWeek}</span> de {summary.goal.maxDaysPerWeek} {summary.goal.maxDaysPerWeek === 1 ? "día" : "días"}.
                </p>
              )}
              {!summary.goal && <p className="text-muted-foreground mb-4 text-[13px] leading-relaxed">Opcional. Si quieres, ponte un máximo de días por semana; nadie más lo ve.</p>}
              <GoalEditor max={settings.maxDaysPerWeek} />
            </Card>
            <Card delay={260} className="md:col-span-2">
              <CardTitle icon={ListOrdered} color={COLOR} title="Registros" />
              {entries.length ? <EntryList entries={entries} labels={labels} /> : <p className="text-muted-foreground text-[13px]">Nada en los últimos 60 días.</p>}
            </Card>
          </div>
        </>
      )}
    </Page>
  );
}

/** Days without use as the number, the 8-week heatmap beside it. */
function Hero({ summary }: { summary: SubstanceSummary }) {
  const columns = Array.from({ length: summary.weeks.length }, (_, w) => summary.days.slice(w * 7, w * 7 + 7));
  return (
    <Card className="flex flex-wrap items-center gap-8">
      <div className="min-w-44">
        <p className="text-muted-foreground text-[13px] font-medium">Días sin consumo</p>
        <p className="tabular mt-1 text-[56px] leading-none font-semibold tracking-tight" style={{ color: COLOR }}>
          {summary.daysWithout ?? "—"}
        </p>
        {summary.lastUse && (
          <p className="text-muted-foreground mt-2 text-[13px]">
            Último: {fmtShortDate(new Date(`${summary.lastUse.date}T12:00:00`))} a las {summary.lastUse.time}
          </p>
        )}
        <p className="text-muted-foreground mt-1 text-[13px]">Racha más larga en 8 semanas: {summary.longestWithout} días</p>
        {summary.drinkDays !== undefined && summary.drinkDays > 0 && <p className="text-muted-foreground mt-1 text-[13px]">Bebidas con alcohol registradas en Dieta: {summary.drinkDays} días</p>}
      </div>
      <figure className="ml-auto" aria-label="Últimas 8 semanas">
        <div className="flex gap-1.5">
          <div className="text-muted-foreground grid grid-rows-7 gap-1.5 pr-1 text-[10px]">
            {WEEKDAYS.map((d) => (
              <span key={d} className="grid h-4 place-items-center md:h-5">
                {d}
              </span>
            ))}
          </div>
          {columns.map((week, w) => (
            <div key={w} className="grid grid-rows-7 gap-1.5">
              {Array.from({ length: 7 }, (_, i) => {
                const day = week[i];
                if (!day) return <span key={i} className="size-4 md:size-5" />;
                return (
                  <span
                    key={i}
                    title={`${fmtDayLabel(day.date)}: ${day.uses ? `${day.uses} ${day.uses === 1 ? "vez" : "veces"}` : "sin consumo"}`}
                    className={cn("size-4 rounded-[5px] md:size-5", day.level === 0 && "bg-muted")}
                    style={day.level ? { background: `color-mix(in oklab, ${COLOR} ${LEVEL_MIX[day.level]}%, transparent)` } : undefined}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <figcaption className="text-muted-foreground mt-2 text-right text-[11px]">8 semanas · más intenso = más cantidad</figcaption>
      </figure>
    </Card>
  );
}

function WeeksCard({ summary }: { summary: SubstanceSummary }) {
  return (
    <Card delay={60}>
      <CardTitle icon={CalendarDays} color={COLOR} title="Días por semana" />
      <div className="flex items-baseline gap-4">
        <p>
          <span className="tabular text-[26px] font-semibold">{summary.daysThisWeek}</span> <span className="text-muted-foreground text-[13px]">esta semana</span>
        </p>
        {summary.avgDaysPerWeek !== null && (
          <p className="text-muted-foreground text-[13px]">
            media <span className="tabular text-foreground font-medium">{fmtNumber(summary.avgDaysPerWeek, 1)}</span>
          </p>
        )}
      </div>
      <div className="mt-3">
        <Sparkline variant="bars" points={summary.weeks.map((w) => ({ label: `Semana del ${fmtShortDate(new Date(`${w.weekStart}T12:00:00`))}`, value: w.days }))} color={COLOR} unit="días" target={summary.goal?.maxDaysPerWeek} label="Días con consumo por semana" />
      </div>
    </Card>
  );
}

function TimeCard({ summary }: { summary: SubstanceSummary }) {
  const max = Math.max(1, ...summary.timeOfDay.map((b) => b.uses));
  return (
    <Card delay={110}>
      <CardTitle icon={Clock} color={COLOR} title="Momento del día" />
      <ul className="space-y-2.5">
        {summary.timeOfDay.map((b) => (
          <li key={b.key} className="flex items-center gap-3 text-[13px]">
            <span className="text-muted-foreground w-20 shrink-0">{b.label}</span>
            <span className="bg-muted h-2.5 flex-1 overflow-hidden rounded-full">
              <span className="block h-full rounded-full" style={{ width: `${(b.uses / max) * 100}%`, background: COLOR }} />
            </span>
            <span className="tabular w-6 text-right">{b.uses}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SleepCard({ summary }: { summary: SubstanceSummary }) {
  const ready = summary.correlations.filter((c) => c.enough && c.text);
  const waiting = summary.correlations.filter((c) => !c.enough && c.nWith + c.nWithout > 0);
  return (
    <Card delay={160}>
      <CardTitle icon={Moon} color="var(--domain-sleep)" title="Tu sueño y recuperación" />
      {ready.length === 0 ? (
        <p className="text-muted-foreground text-[13px] leading-relaxed">Hacen falta al menos 3 noches con consumo y 3 sin, con datos de Salud, para comparar.</p>
      ) : (
        <ul className="space-y-3">
          {ready.map((c) => (
            <li key={c.key} className="text-[14px] leading-relaxed">
              {c.text}.
            </li>
          ))}
        </ul>
      )}
      {waiting.length > 0 && ready.length > 0 && (
        <p className="text-muted-foreground mt-4 text-[12px]">Aún sin datos suficientes: {waiting.map((c) => `${c.label.toLowerCase()} (${c.nWith} con · ${c.nWithout} sin)`).join(", ")}.</p>
      )}
      <p className="text-muted-foreground mt-4 text-[12px]">Promedios de tus propias noches; no dicen qué causa qué.</p>
    </Card>
  );
}
