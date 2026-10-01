"use client";

import type { NextAdjustment, TrainingBlock } from "@pulso/contract";
import { ArrowDownRight, Check, Clock, FastForward, Flame, Loader2, MessageCircle, Play, Sparkles, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PlanDay } from "@/src/web/entreno";
import { Card } from "../../../_ui/card";
import { send } from "../../../_ui/send";
import { useLive } from "./live-store";

/**
 * The page's one hero: this week's ring ("1 de 4 días hechos") and the next
 * workout with its "Empezar", the Coach's note on it when it reviewed that
 * session. With the week complete: "Semana completa" and the next week early.
 */
export function WeekHero({ block, weeks, day, adjustment, firstDay, canEdit }: { block: TrainingBlock | null; weeks: number; day: PlanDay | null; adjustment: NextAdjustment | null; firstDay: string | null; canEdit: boolean }) {
  const router = useRouter();
  const [live] = useLive();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const week = block?.weeks[block.currentWeek - 1];
  const total = block?.days.length ?? 0;
  const done = week?.done ?? 0;

  const startNextWeek = async () => {
    if (!block || !confirm(`¿Empezar la semana ${block.currentWeek + 1} ya? Esta semana queda cerrada con lo que hiciste.`)) return;
    setBusy(true);
    try {
      await send("/api/web/entreno/weeks/next", "POST");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="relative overflow-hidden !p-6 md:!p-8">
      <div className="pointer-events-none absolute -top-28 -right-24 size-72 rounded-full opacity-[0.12] blur-3xl dark:opacity-20" style={{ background: "var(--domain-training)" }} aria-hidden />
      <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:gap-10">
        <div className="flex items-center gap-5">
          <WeekRing done={done} total={total} />
          <div>
            <p className="text-[24px] leading-tight font-semibold tracking-tight">
              Semana {block?.currentWeek ?? 1} <span className="text-muted-foreground font-normal">de {weeks}</span>
            </p>
            <p className="text-muted-foreground mt-0.5 text-[15px]">
              {done} de {total} días hechos
            </p>
            {week?.deload && (
              <span className="bg-training/15 text-training mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold">
                <ArrowDownRight className="size-3" /> Descarga
              </span>
            )}
          </div>
        </div>

        <div className="border-border min-w-0 flex-1 md:border-l md:pl-10">
          {block?.weekComplete ? (
            <div>
              <p className="text-training flex items-center gap-2 text-[20px] font-semibold">
                <Check className="size-5" strokeWidth={3} /> {block.canStartNextWeek ? "Semana completa" : "Programa completado"}
              </p>
              <p className="text-muted-foreground mt-1 text-[15px]">
                {block.canStartNextWeek
                  ? `Buen trabajo. La semana ${block.currentWeek + 1} empieza el lunes${firstDay ? ` con ${firstDay}` : ""}.`
                  : `Hiciste las ${weeks} semanas. Pídele al Coach el siguiente bloque: tu historial y tus cargas siguen contigo.`}
              </p>
              {block.canStartNextWeek && canEdit && (
                <button
                  onClick={startNextWeek}
                  disabled={busy}
                  className="bg-training/12 text-training hover:bg-training/20 focus-visible:ring-ring mt-4 inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-[15px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-60"
                >
                  <FastForward className="size-4" /> Empezar la semana {block.currentWeek + 1} ya
                </button>
              )}
              {!block.canStartNextWeek && (
                <Link href="/coach/nuevo?q=Termin%C3%A9%20mi%20programa.%20Dise%C3%B1a%20mi%20siguiente%20bloque%20a%20partir%20de%20lo%20que%20hice." className="bg-training mt-4 inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-[15px] font-semibold text-white">
                  <Sparkles className="size-4" /> Pedir el siguiente bloque
                </Link>
              )}
            </div>
          ) : (
            day && (
              <div>
                <p className="text-training text-[14px] font-semibold">{day.tagline ?? "Siguiente"}</p>
                <a href={`#dia-${day.id}`} className="hover:text-training mt-0.5 block text-[30px] leading-tight font-semibold tracking-tight md:text-[34px]">
                  {day.name}
                </a>
                {day.focus && <p className="text-muted-foreground mt-1 text-[16px]">{day.focus}</p>}
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[14px]">
                  <Stat icon={Zap} color="var(--domain-training)" value={`${day.exercises.length}`} unit={day.exercises.length === 1 ? "ejercicio" : "ejercicios"} />
                  <Stat icon={Clock} color="var(--domain-fat)" value={`~${day.minutes}`} unit="min" />
                  {day.kcal !== null && <Stat icon={Flame} color="var(--domain-energy)" value={`~${day.kcal}`} unit="kcal" />}
                </div>
                {adjustment && <AdjustmentNote adjustment={adjustment} canEdit={canEdit} onError={setError} />}
                {canEdit && !live && day.exercises.length > 0 && (
                  <Link
                    href={`/entreno/sesion?dia=${encodeURIComponent(day.id)}`}
                    className="bg-training shadow-2 focus-visible:ring-ring mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full px-6 text-[16px] font-semibold text-white outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-offset-2 md:w-auto"
                  >
                    <Play className="size-4" fill="currentColor" />
                    Empezar {day.name}
                  </Link>
                )}
                {live && (
                  <Link
                    href="/entreno/sesion"
                    className="bg-training/12 text-training hover:bg-training/20 focus-visible:ring-ring mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full px-6 text-[16px] font-semibold outline-none focus-visible:ring-2 md:w-auto"
                  >
                    <Play className="size-4" fill="currentColor" />
                    Continuar {live.name}
                  </Link>
                )}
              </div>
            )
          )}
          {error && <p className="text-destructive mt-3 text-[13px]">{error}</p>}
        </div>
      </div>
    </Card>
  );
}

function WeekRing({ done, total }: { done: number; total: number }) {
  const size = 88;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const share = total ? Math.min(1, done / total) : 0;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={`${done} de ${total} días hechos esta semana`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="color-mix(in oklab, var(--domain-training) 15%, transparent)" strokeWidth={stroke} />
        {share > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--domain-training)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - share)} className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700" />}
      </svg>
      <span className="tabular absolute text-[20px] font-semibold">{share >= 1 ? <Check className="text-training size-7" strokeWidth={3} /> : `${done}/${total}`}</span>
    </div>
  );
}

/** The Coach's word on the next session: reviewing, or its sentence with "Ver por qué" and "Entrenar normal". */
function AdjustmentNote({ adjustment, canEdit, onError }: { adjustment: NextAdjustment; canEdit: boolean; onError: (message: string) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (adjustment.status === "reviewing") {
    return (
      <p className="text-muted-foreground mt-4 flex items-center gap-2 text-[13px]">
        <Loader2 className="size-3.5 motion-safe:animate-spin" /> El Coach está revisando tu próxima sesión…
      </p>
    );
  }
  if (!adjustment.rationale || (adjustment.noChange && adjustment.signals.length === 0)) return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const why = () =>
    run(async () => {
      const { threadId } = await send<{ threadId: string }>(`/api/web/entreno/adjustment/${adjustment.id}/thread`, "POST");
      router.push(`/coach/${threadId}`);
    });
  const toggle = () =>
    run(async () => {
      await send(`/api/web/entreno/adjustment/${adjustment.id}`, "PUT", { dismissed: !adjustment.dismissed });
      router.refresh();
    });

  return (
    <div className="bg-training/8 mt-4 rounded-2xl p-4">
      <p className={`flex gap-2 text-[14px] leading-relaxed ${adjustment.dismissed ? "opacity-60" : ""}`}>
        <Sparkles className="text-training mt-0.5 size-4 shrink-0" />
        {adjustment.rationale}
      </p>
      {adjustment.dismissed && <p className="text-muted-foreground mt-1 pl-6 text-[12px]">Hoy entrenas el plan normal.</p>}
      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-2 pl-6">
          <button onClick={why} disabled={busy} className="bg-card shadow-1 hover:bg-muted focus-visible:ring-ring inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-60">
            <MessageCircle className="size-3.5" /> Ver por qué
          </button>
          {!adjustment.noChange && (
            <button onClick={toggle} disabled={busy} className="bg-card shadow-1 hover:bg-muted focus-visible:ring-ring inline-flex min-h-9 items-center rounded-full px-3.5 text-[13px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-60">
              {adjustment.dismissed ? "Usar el ajuste" : "Entrenar normal"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ icon: Icon, color, value, unit }: { icon: typeof Zap; color: string; value: string; unit: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon className="size-4" style={{ color }} strokeWidth={2.2} />
      <span className="tabular font-semibold">{value}</span>
      <span className="text-muted-foreground">{unit}</span>
    </span>
  );
}
