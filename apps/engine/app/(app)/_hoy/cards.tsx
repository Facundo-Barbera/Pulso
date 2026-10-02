import type { CoachBrief, DailyMetrics, DoseSlot, MedicationDay, Readiness, SleepNight, SleepSummary } from "@pulso/contract";
import { Activity, AlarmClock, Check, Clock, Dumbbell, Flame, HeartPulse, Moon, Pill, Sparkles, Watch, X, type LucideIcon } from "lucide-react";
import { localNow } from "@/src/medication/schedule";
import { groupSlots, unitFor } from "@/src/web/medication";
import type { RecentActivity, TodayOverview } from "@/src/web/today";
import { Card, CardTitle } from "../../_ui/card";
import { MOMENT_ICON } from "../medicacion/_components/moment-icons";
import { STAGES as SLEEP_STAGES } from "../sueno/_components/night";
import { cn } from "../../_ui/cn";
import { EmptyState } from "../../_ui/empty-state";
import { fmtAgo, fmtDayLabel, fmtMinutes, fmtNumber, fmtShortDate, fmtTime } from "../../_ui/format";
import { Markdown } from "../../_ui/markdown";
import { Skeleton } from "../../_ui/skeleton";
import { Sparkline } from "../../_ui/sparkline";
import { StatTile } from "../../_ui/stat-tile";

type Trend = TodayOverview["trend"];

const series = (trend: Trend, pick: (m: DailyMetrics) => number | null) => trend.map((d) => ({ label: fmtDayLabel(d.date), value: d.metrics ? pick(d.metrics) : null }));
const hasAny = (trend: Trend, pick: (m: DailyMetrics) => number | null) => trend.some((d) => d.metrics && pick(d.metrics) !== null);

const SYNC_HINT = "Abre Pulso en el iPhone y sincroniza desde Salud.";

export function ActivityCard({ today, trend, delay }: { today: DailyMetrics | null; trend: Trend; delay: number }) {
  const any = hasAny(trend, (m) => m.steps ?? m.activeEnergy ?? m.exerciseMinutes);
  return (
    <Card delay={delay}>
      <CardTitle icon={Flame} color="var(--domain-energy)" title="Actividad" />
      {!any ? (
        <EmptyState compact icon={Watch} color="var(--domain-energy)" title="Sin actividad todavía" line={SYNC_HINT} />
      ) : (
        <>
          <StatTile label="Pasos" value={today?.steps != null ? fmtNumber(today.steps) : "—"} color="var(--domain-energy)">
            <Sparkline variant="bars" points={series(trend, (m) => m.steps)} color="var(--domain-energy)" label="Pasos, últimos 14 días" />
          </StatTile>
          <div className="border-border mt-5 grid grid-cols-2 gap-4 border-t pt-4">
            <StatTile label="Energía activa" value={today?.activeEnergy != null ? fmtNumber(today.activeEnergy) : "—"} unit="kcal" />
            <StatTile label="Ejercicio" value={today?.exerciseMinutes != null ? fmtNumber(today.exerciseMinutes) : "—"} unit="min" />
          </div>
        </>
      )}
    </Card>
  );
}

/** Sueño's stages, deepest first: the same lightness ramp and labels as the hypnogram. */
const STAGES = [...SLEEP_STAGES].reverse();

export function SleepCard({ night, summary, trend, delay }: { night: SleepNight | null; summary: SleepSummary; trend: Trend; delay: number }) {
  const sleepSeries = series(trend, (m) => (m.sleepMinutes === null ? null : Math.round((m.sleepMinutes / 60) * 10) / 10));
  const staged = night ? STAGES.reduce((sum, s) => sum + night.minutes[s.key], 0) : 0;
  return (
    <Card delay={delay}>
      <CardTitle icon={Moon} color="var(--domain-sleep)" title="Sueño" />
      {!night ? (
        <EmptyState compact icon={Moon} color="var(--domain-sleep)" title="Sin datos de anoche" line={summary.nights ? "La última noche registrada es de antes de ayer." : SYNC_HINT} />
      ) : (
        <>
          <div className="flex items-end justify-between gap-4">
            <StatTile label="Anoche" value={fmtMinutes(night.minutes.asleep)} caption={`${fmtTime(night.asleepStart)} – ${fmtTime(night.asleepEnd)} · eficiencia ${Math.round(night.efficiency * 100)} %`} />
            <div className="text-right">
              <p className="tabular text-[26px] leading-none font-semibold">{night.score.value}</p>
              <p className="text-muted-foreground mt-1 text-[12px]">puntuación</p>
            </div>
          </div>
          {staged > 0 && (
            <div className="mt-4">
              <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={STAGES.map((s) => `${s.label} ${fmtMinutes(night.minutes[s.key])}`).join(", ")}>
                {STAGES.map((s) => (night.minutes[s.key] > 0 ? <div key={s.key} style={{ flexGrow: night.minutes[s.key], background: s.color }} title={`${s.label}: ${fmtMinutes(night.minutes[s.key])}`} /> : null))}
              </div>
              <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                {STAGES.map((s) => (
                  <span key={s.key} className="flex items-center gap-1">
                    <span className="legend-dot size-2 rounded-full" style={{ background: s.color }} />
                    {s.label} <span className="tabular text-foreground">{fmtMinutes(night.minutes[s.key])}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {hasAny(trend, (m) => m.sleepMinutes) && (
            <div className="border-border mt-4 border-t pt-3">
              <Sparkline variant="bars" points={sleepSeries} color="var(--domain-sleep)" unit="h" decimals={1} target={summary.targetMin / 60} height={44} label="Horas dormidas, últimos 14 días" />
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export function HeartCard({ readiness, trend, delay }: { readiness: Readiness; trend: Trend; delay: number }) {
  const hrv = readiness.factors.find((f) => f.key === "hrv");
  const rhr = readiness.factors.find((f) => f.key === "resting_hr");
  const any = hasAny(trend, (m) => m.hrv ?? m.restingHeartRate);
  return (
    <Card delay={delay}>
      <CardTitle icon={HeartPulse} color="var(--domain-heart)" title="Corazón" />
      {!any ? (
        <EmptyState compact icon={HeartPulse} color="var(--domain-heart)" title="Sin lecturas del reloj" line="La VFC y el pulso en reposo llegan del Apple Watch a través de Salud." />
      ) : (
        <div className="grid gap-5">
          <StatTile label="VFC" value={hrv?.value != null ? fmtNumber(hrv.value) : "—"} unit="ms" caption={hrv?.baseline != null ? `media 28 días: ${fmtNumber(hrv.baseline)} ms` : undefined} color="var(--domain-heart)">
            <Sparkline points={series(trend, (m) => m.hrv)} color="var(--domain-heart)" unit="ms" height={44} label="VFC, últimos 14 días" />
          </StatTile>
          <StatTile label="Pulso en reposo" value={rhr?.value != null ? fmtNumber(rhr.value) : "—"} unit="lpm" caption={rhr?.baseline != null ? `media 28 días: ${fmtNumber(rhr.baseline)} lpm` : undefined} color="var(--domain-heart)">
            <Sparkline points={series(trend, (m) => m.restingHeartRate)} color="var(--domain-heart)" unit="lpm" height={44} label="Pulso en reposo, últimos 14 días" />
          </StatTile>
        </div>
      )}
    </Card>
  );
}

export function BriefCard({ brief, delay }: { brief: CoachBrief | null; delay: number }) {
  const writing = brief?.status === "running" && !brief.text;
  return (
    <Card delay={delay} className="md:col-span-2">
      {/* With a brief to answer, the link opens a chat that replies to it. */}
      <CardTitle icon={Sparkles} color="var(--pulso-violet)" title="Resumen del Coach" href={brief?.text ? `/coach/nuevo?responder=${brief.id}` : "/coach/nuevo"} action={brief?.text ? "Responder" : "Hablar con el Coach"} />
      {writing ? (
        <div className="space-y-2.5" aria-label="El Coach está escribiendo">
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : brief?.text ? (
        <>
          <Markdown text={brief.text} className="space-y-2.5 text-[15px] leading-relaxed" />
          <p className="text-muted-foreground mt-4 text-[12px]">
            {brief.status === "running" ? "Actualizando…" : `Escrito ${fmtAgo(brief.updatedAt)}`}
          </p>
        </>
      ) : (
        <EmptyState compact icon={Sparkles} color="var(--pulso-violet)" title="El Coach escribe cada mañana" line={brief?.status === "error" ? "El último resumen falló. Volverá a intentarlo solo." : "Tu primer resumen aparecerá aquí cuando tenga datos que comentar."} />
      )}
    </Card>
  );
}

/** Each dose state as word and icon; the tint only helps. */
const DOSE: Record<DoseSlot["status"], { label: string; icon: LucideIcon; className: string }> = {
  tomada: { label: "Tomada", icon: Check, className: "text-good bg-good/12" },
  omitida: { label: "Omitida", icon: X, className: "text-muted-foreground bg-muted" },
  pospuesta: { label: "Pospuesta", icon: AlarmClock, className: "text-caution bg-caution/12" },
  pendiente: { label: "Pendiente", icon: Clock, className: "text-foreground bg-muted" },
};

function DoseChip({ status }: { status: DoseSlot["status"] }) {
  const { label, icon: Icon, className } = DOSE[status];
  return (
    <span className={cn("flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", className)}>
      <Icon className="size-3" strokeWidth={status === "tomada" ? 3 : 2.2} aria-hidden />
      {label}
    </span>
  );
}

export function MedicationCard({ day, delay }: { day: MedicationDay; delay: number }) {
  const taken = day.slots.filter((s) => s.status === "tomada").length;
  const groups = groupSlots(day.slots, localNow().time);
  return (
    <Card delay={delay}>
      <CardTitle icon={Pill} color="var(--domain-medication)" title="Tomas de hoy" href="/medicacion" />
      {day.slots.length === 0 && day.asNeeded.length === 0 ? (
        <EmptyState compact icon={Pill} color="var(--domain-medication)" title="Nada programado hoy" line="Tus medicamentos y suplementos aparecerán aquí: a su hora, con una comida o después de entrenar." />
      ) : (
        <>
          {day.slots.length > 0 && (
            <p className="text-muted-foreground mb-3 text-[13px]">
              <span className="tabular text-foreground font-semibold">{taken}</span> de <span className="tabular">{day.slots.length}</span> tomas hechas
            </p>
          )}
          <div className="space-y-3">
            {groups.map((group) => {
              const Icon = MOMENT_ICON[group.moment];
              return (
                <section key={group.key}>
                  <h3 className="text-muted-foreground mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase">
                    <Icon className="size-3.5" style={{ color: "var(--domain-medication)" }} />
                    <span className={cn(group.moment === "hora" && "tabular")}>{group.title}</span>
                    {group.time && <span className="tabular font-medium normal-case">· {group.time}</span>}
                  </h3>
                  <ul className="-mx-2 space-y-0.5">
                    {group.slots.map((slot) => {
                      const isNext = day.next?.medicationId === slot.medicationId && day.next.slot === slot.slot;
                      return (
                        <li key={`${slot.medicationId}-${slot.slot}`} className={cn("flex min-h-11 items-center gap-3 rounded-xl px-2 py-1", isNext && "bg-muted/70")}>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium">{slot.name}</span>
                            <span className="text-muted-foreground block truncate text-[12px]">
                              {fmtNumber(slot.dose, 2)} {unitFor(slot.dose, slot.unit)}
                              {isNext && " · siguiente"}
                            </span>
                            {slot.line && <span className="text-foreground/80 block text-[12px] leading-snug">{slot.line}</span>}
                          </span>
                          <DoseChip status={slot.status} />
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
          {day.asNeeded.length > 0 && <p className="text-muted-foreground mt-3 text-[12px]">Además, {day.asNeeded.length} {day.asNeeded.length === 1 ? "toma" : "tomas"} a demanda.</p>}
        </>
      )}
    </Card>
  );
}

export function RecentCard({ recent, delay }: { recent: RecentActivity[]; delay: number }) {
  return (
    <Card delay={delay} className="md:col-span-2 xl:col-span-3">
      <CardTitle icon={Dumbbell} color="var(--domain-training)" title="Entrenamientos recientes" href="/entreno" />
      {recent.length === 0 ? (
        <EmptyState compact icon={Dumbbell} color="var(--domain-training)" title="Aún no hay entrenamientos" line="Registra una sesión en el iPhone o sincroniza tus entrenos de Salud." />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {recent.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="bg-muted/50 flex items-center gap-3 rounded-2xl p-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ background: "color-mix(in oklab, var(--domain-training) 16%, transparent)", color: "var(--domain-training)" }}>
                {item.kind === "session" ? <Dumbbell className="size-[18px]" /> : <Activity className="size-[18px]" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[14px] font-medium">
                  <span className="truncate">{item.title}</span>
                  {item.merged && <Watch className="text-heart size-3.5 shrink-0" aria-label="Con datos de Apple Watch" />}
                </span>
                <span className="text-muted-foreground block truncate text-[12px]">
                  {fmtShortDate(item.startedAt)} · {fmtMinutes((item.endedAt - item.startedAt) / 60_000)}
                  {item.detail && ` · ${item.detail}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
