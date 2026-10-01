"use client";

import { ChevronRight, Clock, Flame, Play, Trophy, Zap } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import type { PlanDay, PlanExercise } from "@/src/web/entreno";
import { setsDone, setsTotal } from "@/src/web/entreno-live";
import { Card } from "../../../_ui/card";
import { cn } from "../../../_ui/cn";
import { MuscleBadge } from "./body-map";
import { ExerciseSheet } from "./exercise-sheet";
import { useLive } from "./live-store";
import { Thumb } from "./thumb";

/**
 * The page's hero: the program's days as tabs ("Día 2 · Pierna"), the selected
 * day below (the next one by default), and one action: start it, or go back to
 * the session in progress. ← → move between days when the tabs have focus.
 */
export function Plan({ days, nextDayId, canEdit }: { days: PlanDay[]; nextDayId: string | null; canEdit: boolean }) {
  const [selectedId, setSelectedId] = useState(nextDayId ?? days[0]?.id);
  const [open, setOpen] = useState<PlanExercise | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [live] = useLive();
  const index = Math.max(0, days.findIndex((d) => d.id === selectedId));
  const day = days[index]!;

  const onKey = (e: React.KeyboardEvent) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + days.length) % days.length;
    setSelectedId(days[next]!.id);
    tabs.current[next]?.focus();
  };

  return (
    <>
      {live && (
        <Link
          href="/entreno/sesion"
          className="bg-training/12 hover:bg-training/18 focus-visible:ring-ring mb-5 flex min-h-14 items-center gap-4 rounded-[18px] px-5 py-3 outline-none focus-visible:ring-2 motion-safe:animate-[pulso-rise_420ms_cubic-bezier(.2,.7,.2,1)_both]"
        >
          <span className="bg-training relative grid size-9 place-items-center rounded-full text-white">
            <span className="bg-training absolute inset-0 rounded-full opacity-50 motion-safe:animate-ping" aria-hidden />
            <Zap className="relative size-4" fill="currentColor" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Sesión en curso</span>
            <span className="text-muted-foreground block truncate text-[13px]">
              {live.name} · {setsDone(live)}/{setsTotal(live)} series · en este navegador
            </span>
          </span>
          <span className="text-training flex items-center gap-1 text-[14px] font-semibold">
            Continuar <ChevronRight className="size-4" />
          </span>
        </Link>
      )}

      <div role="tablist" aria-label="Días del programa" onKeyDown={onKey} className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {days.map((d, i) => {
          const selected = d.id === day.id;
          return (
            <button
              key={d.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setSelectedId(d.id)}
              className={cn(
                "focus-visible:ring-ring min-h-10 max-w-[240px] shrink-0 truncate rounded-full px-4 text-[14px] font-semibold outline-none focus-visible:ring-2 motion-safe:transition-colors",
                selected ? "bg-training shadow-1 text-white" : "bg-card shadow-1 hover:bg-muted",
              )}
            >
              Día {d.number} · {d.name}
            </button>
          );
        })}
      </div>

      <Card key={day.id} className="relative overflow-hidden !p-6 md:!p-8">
        <div className="pointer-events-none absolute -top-28 -right-24 size-72 rounded-full opacity-[0.12] blur-3xl dark:opacity-20" style={{ background: "var(--domain-training)" }} aria-hidden />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-start md:gap-6">
          <div className="min-w-0 flex-1">
            {day.tagline && <p className="text-training text-[14px] font-semibold">{day.tagline}</p>}
            <h2 className="mt-0.5 text-[30px] leading-tight font-semibold tracking-tight md:text-[36px]">{day.name}</h2>
            {day.focus && <p className="text-muted-foreground mt-1 text-[17px]">{day.focus}</p>}
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[14px]">
              <Stat icon={Zap} color="var(--domain-training)" value={`${day.exercises.length}`} unit={day.exercises.length === 1 ? "ejercicio" : "ejercicios"} />
              <Stat icon={Clock} color="var(--domain-fat)" value={`~${day.minutes}`} unit="min" />
              {day.kcal !== null && <Stat icon={Flame} color="var(--domain-energy)" value={`~${day.kcal}`} unit="kcal" />}
            </div>
          </div>
          {canEdit && !live && day.exercises.length > 0 && (
            <Link
              href={`/entreno/sesion?dia=${encodeURIComponent(day.id)}`}
              className="bg-training shadow-2 focus-visible:ring-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-[16px] font-semibold text-white outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              <Play className="size-4" fill="currentColor" />
              Empezar día {day.number}
            </Link>
          )}
        </div>

        <ul className="relative mt-6 divide-y divide-[var(--border)]">
          {day.exercises.map((ex) => (
            <li key={ex.id}>
              <button
                onClick={() => setOpen(ex)}
                className="hover:bg-muted/60 focus-visible:ring-ring -mx-3 flex w-[calc(100%+24px)] items-center gap-4 rounded-2xl px-3 py-3 text-left outline-none focus-visible:ring-2"
              >
                <Thumb src={ex.thumbnail} className="size-14" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="truncate text-[15px] font-semibold">{ex.exerciseName}</span>
                    {ex.record && <Trophy className="text-carbs size-3.5 shrink-0" aria-label="Récord reciente" />}
                  </span>
                  <span className="text-muted-foreground tabular block truncate text-[14px]">{ex.prescription}</span>
                </span>
                <MuscleBadge primary={ex.primaryMuscles} />
              </button>
            </li>
          ))}
        </ul>
        {day.exercises.length === 0 && <p className="text-muted-foreground mt-6 text-[14px]">Día sin ejercicios.</p>}
      </Card>

      <ExerciseSheet exerciseId={open?.exerciseId ?? null} name={open?.exerciseName} canEdit={canEdit} onClose={() => setOpen(null)} />
    </>
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
