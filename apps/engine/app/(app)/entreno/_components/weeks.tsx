"use client";

import type { ProgramWeek, TrainingBlock, WeekDay } from "@pulso/contract";
import { ArrowDownRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleDashed, Info, Layers, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { HistoryEntry } from "@/src/web/entreno";
import { Card } from "../../../_ui/card";
import { cn } from "../../../_ui/cn";
import { send } from "../../../_ui/send";
import { SessionDetail } from "./cards";

const day = new Intl.DateTimeFormat("es", { day: "numeric", month: "short" });
const weekday = new Intl.DateTimeFormat("es", { weekday: "short", day: "numeric", month: "short" });

/**
 * ‹ Semana 2 de 6 › across every block, earlier blocks first: each week's days
 * with what happened. A done day opens its session in place; any other day
 * jumps to it in the plan below (a preview for other weeks).
 */
export function Weeks({ blocks, sessions, nextDayId, canEdit }: { blocks: TrainingBlock[]; sessions: Record<string, HistoryEntry>; nextDayId: string | null; canEdit: boolean }) {
  const router = useRouter();
  const all = blocks.flatMap((b) => b.weeks.map((w) => ({ block: b, week: w })));
  const active = blocks.find((b) => b.active) ?? blocks.at(-1);
  const initial = Math.max(0, all.findIndex((x) => x.block === active && x.week.number === active?.currentWeek));
  const [index, setIndex] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = all[index];
  if (!current) return null;
  const { block, week } = current;

  const resume = async () => {
    if (!confirm(`¿Retomar ${block.name}? Empieza un bloque nuevo con sus días, desde la semana 1. Lo que hiciste se queda en tu historial.`)) return;
    try {
      await send(`/api/web/entreno/blocks/${block.programId}/resume`, "POST");
      setIndex(all.length);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-3">
        <StepButton label="Semana anterior" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          <ChevronLeft className="size-4" />
        </StepButton>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-[17px] font-semibold tracking-tight">
            Semana {week.number} de {block.weeks.length}
          </p>
          <p className="text-muted-foreground text-[13px]">
            {day.format(week.startsAt)} – {day.format(week.endsAt - 1)}
          </p>
        </div>
        <StepButton label="Semana siguiente" disabled={index >= all.length - 1} onClick={() => setIndex(index + 1)}>
          <ChevronRight className="size-4" />
        </StepButton>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[12px] font-semibold">
        {(blocks.length > 1 || !block.active) && (
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1", block.active ? "bg-training/15 text-training" : "bg-muted text-muted-foreground")}>
            <Layers className="size-3" /> Bloque {block.number} · {block.name}
          </span>
        )}
        {block.active && week.state === "current" && <span className="bg-training/15 text-training rounded-full px-2.5 py-1">Esta semana</span>}
        {week.deload && (
          <span className="bg-training/15 text-training inline-flex items-center gap-1 rounded-full px-2.5 py-1">
            <ArrowDownRight className="size-3" /> Descarga
          </span>
        )}
        {week.startedEarly && <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-1">Empezada antes</span>}
        {!block.active && canEdit && (
          <button onClick={resume} className="bg-training text-white focus-visible:ring-ring min-h-7 rounded-full px-3 outline-none focus-visible:ring-2">
            Retomar
          </button>
        )}
      </div>

      <div className="mt-4 flex gap-1.5" role="tablist" aria-label="Semanas del bloque">
        {block.weeks.map((w) => {
          const share = w.days.length ? w.done / w.days.length : 0;
          const at = all.findIndex((x) => x.block === block && x.week.number === w.number);
          return (
            <button
              key={w.number}
              role="tab"
              aria-selected={w.number === week.number}
              aria-label={`Semana ${w.number}: ${w.done} de ${w.days.length} días`}
              onClick={() => setIndex(at)}
              className={cn("focus-visible:ring-ring relative h-2 flex-1 overflow-hidden rounded-full outline-none focus-visible:ring-2", w.state === "future" ? "bg-training/10" : "bg-training/18", w.number === week.number && "ring-training ring-2 ring-offset-2 ring-offset-[var(--card)]")}
            >
              <span className="bg-training absolute inset-y-0 left-0 rounded-full" style={{ width: `${share * 100}%` }} />
            </button>
          );
        })}
      </div>

      <ul className="mt-4 divide-y divide-[var(--border)]">
        {week.days.map((d, i) => (
          <DayRow
            key={d.dayId}
            number={i + 1}
            day={d}
            week={week}
            isNext={block.active && week.state === "current" && d.dayId === nextDayId}
            linkable={block.active}
            open={open === d.dayId ? (d.sessions.at(-1) && sessions[d.sessions.at(-1)!.id]) || null : null}
            toggle={() => setOpen(open === d.dayId ? null : d.dayId)}
          />
        ))}
      </ul>

      {week.other.length > 0 && (
        <div className="mt-3">
          <p className="text-muted-foreground text-[12px] font-semibold">También esta semana</p>
          <ul className="mt-1 space-y-1 text-[14px]">
            {week.other.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <Check className="text-training size-3.5" /> {s.name} <span className="text-muted-foreground ml-auto text-[13px]">{weekday.format(s.startedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {note(block, week) && (
        <p className="text-muted-foreground mt-4 flex items-start gap-2 text-[13px]">
          {week.deload ? <ArrowDownRight className="mt-0.5 size-3.5 shrink-0" /> : <Info className="mt-0.5 size-3.5 shrink-0" />}
          {note(block, week)}
        </p>
      )}
      {error && <p className="text-destructive mt-3 text-[13px]">{error}</p>}
    </Card>
  );
}

function note(block: TrainingBlock, week: ProgramWeek): string | null {
  if (week.note) return week.note;
  if (block.active && week.state === "future") return "Mismo plan: las cargas se ajustan con lo que hagas antes.";
  if (!block.active && block.endReason && week.number === block.weeks.length) return `Bloque terminado: ${block.endReason}`;
  return null;
}

function StepButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} disabled={disabled} onClick={onClick} className="bg-muted/70 hover:bg-muted focus-visible:ring-ring grid size-10 place-items-center rounded-full outline-none focus-visible:ring-2 disabled:opacity-40">
      {children}
    </button>
  );
}

/** "Hecho · jue 1 oct · 41 min · 10 series", "Siguiente", "No se hizo". */
function DayRow({ number, day, week, isNext, linkable, open, toggle }: { number: number; day: WeekDay; week: ProgramWeek; isNext: boolean; linkable: boolean; open: HistoryEntry | null; toggle: () => void }) {
  const last = day.sessions.at(-1);
  const isDone = day.status === "done" || day.status === "partial";
  const subtitle = isDone && last
    ? [day.status === "partial" ? "A medias" : "Hecho", weekday.format(last.startedAt), `${Math.round((last.endedAt - last.startedAt) / 60_000)} min`, last.sets ? `${last.sets} ${last.sets === 1 ? "serie" : "series"}` : null, day.sessions.length > 1 ? `×${day.sessions.length}` : null]
        .filter(Boolean)
        .join(" · ")
    : isNext
      ? "Siguiente"
      : day.status === "missed"
        ? "No se hizo"
        : week.state === "future"
          ? "Previsto"
          : "Pendiente";
  const icon =
    day.status === "done" ? <Check className="text-training size-4" strokeWidth={3} /> : day.status === "partial" ? <CircleDashed className="text-energy size-4" /> : day.status === "missed" ? <X className="text-muted-foreground size-4" /> : null;
  const content = (
    <>
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", isNext ? "bg-training text-white" : isDone ? "bg-training/15" : "bg-muted")}>{icon ?? <span className="text-[12px] font-semibold">{number}</span>}</span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[15px]", isNext ? "font-semibold" : "font-medium", day.status === "missed" && "text-muted-foreground")}>
          Día {number} · {day.name}
        </span>
        <span className={cn("block text-[13px]", isNext ? "text-training font-semibold" : "text-muted-foreground")}>{subtitle}</span>
      </span>
    </>
  );
  return (
    <li>
      {isDone ? (
        <>
          <button onClick={toggle} aria-expanded={!!open} className="hover:bg-muted/60 focus-visible:ring-ring -mx-3 flex w-[calc(100%+24px)] items-center gap-3 rounded-2xl px-3 py-3 text-left outline-none focus-visible:ring-2">
            {content}
            <ChevronDown className={cn("text-muted-foreground size-4 shrink-0 motion-safe:transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <div className="pb-4 pl-11">
              <SessionDetail entry={open} />
            </div>
          )}
        </>
      ) : !linkable ? (
        <div className="flex items-center gap-3 py-3">{content}</div>
      ) : (
        <a href={`#dia-${day.dayId}`} className="hover:bg-muted/60 focus-visible:ring-ring -mx-3 flex items-center gap-3 rounded-2xl px-3 py-3 outline-none focus-visible:ring-2">
          {content}
          <ChevronRight className="text-muted-foreground size-4 shrink-0" />
        </a>
      )}
    </li>
  );
}
