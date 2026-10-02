"use client";

import type { SlotStatus } from "@pulso/contract";
import { ArrowRightLeft, Check, ChefHat, Ellipsis, PenLine, RotateCcw, SkipForward, Store, Trash2, Utensils, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SlotView } from "@/src/web/dieta-plan";
import { cn } from "../../../_ui/cn";
import { useDieta } from "./client";
import { usePlanActions } from "./plan-actions";

export const STATUS_LABELS: Record<SlotStatus, string> = { planned: "Pendiente", eaten: "Según el plan", replaced: "Otra cosa", skipped: "Saltada" };

/** The status as the row says it: a pending meal well past its time reads «Sin registrar». */
export const statusLabel = (slot: SlotView) => (slot.missed ? "Sin registrar" : STATUS_LABELS[slot.status]);

const fmtKcal = new Intl.NumberFormat("es", { maximumFractionDigits: 0 });

/** The one mark a meal shows, same as the phone: filled as planned, half for something else, hollow pending, dashed when skipped or unanswered. */
export type MealMark = "asPlanned" | "changed" | "pending" | "unanswered" | "skipped";

export function markOf(slot: SlotView): MealMark {
  if (slot.status === "planned") return slot.missed ? "unanswered" : "pending";
  if (slot.status === "skipped") return "skipped";
  if (slot.status === "eaten") return slot.real?.asPlanned === false ? "changed" : "asPlanned";
  return slot.real?.asPlanned ? "asPlanned" : "changed";
}

const MARK_LABELS: Record<MealMark, string> = { asPlanned: "Como estaba planeado", changed: "Otra cosa", pending: "Pendiente", unanswered: "Sin registrar", skipped: "Saltada" };

/** The mark at the start of a row, shape first (colour only backs it up); on a pending meal of today, a tap eats it. */
function StatusMark({ slot, onEat, busy }: { slot: SlotView; onEat: () => void; busy: boolean }) {
  const mark = markOf(slot);
  const dot = "block size-3.5 rounded-full";
  const shape = {
    asPlanned: <span className={cn(dot, "bg-good")} />,
    changed: <span className={cn(dot, "border-good border-2")} style={{ background: "linear-gradient(90deg, var(--color-good) 50%, transparent 50%)" }} />,
    pending: <span className={cn(dot, "border-muted-foreground/60 border-2")} />,
    unanswered: <span className={cn(dot, "border-caution border-2 border-dashed")} />,
    skipped: <span className={cn(dot, "border-muted-foreground/40 border-2 border-dashed")} />,
  }[mark];
  const base = "focus-visible:ring-ring grid size-8 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2";
  if (mark === "pending" && !slot.later)
    return (
      <button onClick={onEat} disabled={busy} className={cn(base, "group hover:bg-good/10")} aria-label={`Me lo comí: ${slot.label}`} title="Me lo comí">
        <span className="group-hover:hidden">{shape}</span>
        <Check className="text-good hidden size-4 group-hover:block" strokeWidth={3} />
      </button>
    );
  return (
    <span className={base} role="img" aria-label={MARK_LABELS[mark]}>
      {shape}
    </span>
  );
}

export type MenuItem = { label: string; icon: LucideIcon; run: () => void; danger?: boolean };

/** A small popover menu: closes on a pick, a click outside or Escape. */
export function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  if (!items.length) return <span className="size-9 shrink-0" aria-hidden />;
  return (
    <div ref={root} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Opciones de ${label}`}
        className={cn(
          "text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring grid size-9 place-items-center rounded-lg outline-none focus-visible:ring-2",
          open && "bg-muted text-foreground",
        )}
      >
        <Ellipsis className="size-4" />
      </button>
      {open && (
        <ul role="menu" className="bg-popover text-popover-foreground shadow-3 border-border absolute top-full right-0 z-20 mt-1 w-56 rounded-2xl border p-1.5 motion-safe:animate-[pulso-rise_180ms_cubic-bezier(.2,.7,.2,1)_both]">
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.run();
                }}
                className={cn("hover:bg-muted focus-visible:bg-muted flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 text-left text-[14px] outline-none", item.danger && "text-destructive")}
              >
                <item.icon className={cn("size-4", item.danger ? "text-destructive" : "text-muted-foreground")} />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One meal of the day, folded to a line like on the phone: the meal and its time,
 * what was eaten (or what's planned, quieter), a small «en lugar de …» when it
 * changed, and the kcal. Once well past its time («sin registrar») two quick
 * answers. The menu has what can happen to it — pending: eaten, something else,
 * eaten out, skipped, no time to cook; eaten: move it to another meal or delete it.
 */
export function SlotRow({ slot, onOpen, showTitle = true, time, moveTargets = [] }: { slot: SlotView; onOpen?: () => void; showTitle?: boolean; time?: string; moveTargets?: SlotView[] }) {
  const { register } = useDieta();
  const actions = usePlanActions();
  const [busy, setBusy] = useState(false);
  const busyWhile = (work: () => Promise<unknown>) => async () => {
    setBusy(true);
    await work();
    setBusy(false);
  };

  const items: MenuItem[] =
    slot.status === "planned"
      ? [
          ...(slot.later
            ? []
            : [
                { label: "Me lo comí", icon: Utensils, run: busyWhile(() => actions.eat(slot)) },
                { label: "Registrar lo que comí", icon: PenLine, run: () => register(undefined, slot) },
                { label: "Comí fuera", icon: Store, run: busyWhile(() => actions.ateOut(slot)) },
              ]),
          { label: slot.later ? "Me lo voy a saltar" : "Me lo salté", icon: SkipForward, run: busyWhile(() => actions.skip(slot)) },
          ...(slot.cooks ? [{ label: slot.later ? "Ese día no cocino" : "Hoy no cocino", icon: ChefHat, run: busyWhile(() => actions.noTimeToCook(slot)) }] : []),
        ]
      : slot.entryIds.length > 0
        ? [
            ...moveTargets.map((target) => ({ label: `Mover a ${target.title.toLowerCase()}`, icon: ArrowRightLeft, run: busyWhile(() => actions.move(slot.entryIds, target)) })),
            { label: slot.status === "eaten" ? "No me lo comí" : "Borrar lo que comí", icon: slot.status === "eaten" ? RotateCcw : Trash2, run: busyWhile(() => actions.uneat(slot)), danger: slot.status !== "eaten" },
          ]
        : [];

  const real = slot.real;
  const mark = markOf(slot);
  const eaten = mark === "asPlanned" || mark === "changed";
  const kcal = real ? real.macros.kcal : slot.kcal;
  const quick = "bg-muted hover:bg-accent focus-visible:ring-ring inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium outline-none focus-visible:ring-2 disabled:opacity-50";
  // The first line: the meal and its time, or what's planned's source on the plan's own rows.
  const head = showTitle ? slot.title : (slot.source ?? null);
  const state = mark === "unanswered" || mark === "skipped" ? MARK_LABELS[mark] : null;

  return (
    <li className={cn("hover:bg-muted/50 flex min-h-14 items-center gap-3 rounded-xl px-2 py-2", busy && "opacity-60")}>
      <StatusMark slot={slot} busy={busy} onEat={busyWhile(() => actions.eat(slot))} />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onOpen} disabled={!onOpen} className="focus-visible:ring-ring block w-full min-w-0 rounded-lg text-left outline-none focus-visible:ring-2 disabled:cursor-default">
          {(head || time || state) && (
            <span className="flex items-baseline gap-1.5">
              {head && <span className={cn("truncate", showTitle ? "text-[14px] font-semibold" : "text-muted-foreground text-[12px]")}>{head}</span>}
              {time && <span className="text-muted-foreground tabular shrink-0 text-[12px]">{time}</span>}
              {state && <span className={cn("shrink-0 text-[12px] font-medium", mark === "unanswered" ? "text-caution" : "text-muted-foreground")}>{state}</span>}
            </span>
          )}
          <span className={cn("block truncate text-[14px]", eaten ? "text-foreground" : "text-muted-foreground")}>{real?.label ?? slot.label}</span>
          {mark === "changed" && real && <span className="text-muted-foreground block truncate text-[12px]">en lugar de {slot.label}</span>}
          <span className="sr-only">{MARK_LABELS[mark]}</span>
        </button>
        {slot.missed && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button onClick={busyWhile(() => actions.skip(slot))} disabled={busy} className={quick}>
              <SkipForward className="size-3.5" />
              Me la salté
            </button>
            <button onClick={() => register(undefined, slot)} className={quick}>
              <PenLine className="size-3.5" />
              Registrar lo que comí
            </button>
          </div>
        )}
      </div>
      <span className={cn("tabular shrink-0 text-[13px] font-medium", eaten ? "text-foreground" : "text-muted-foreground", mark === "skipped" && "opacity-60")}>{fmtKcal.format(kcal)} kcal</span>
      <RowMenu label={slot.label} items={items} />
    </li>
  );
}

/** «Me lo comí» as a button, for the next meal under the hero. */
export function EatButton({ slot }: { slot: SlotView }) {
  const actions = usePlanActions();
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        setBusy(true);
        await actions.eat(slot);
        setBusy(false);
      }}
      disabled={busy}
      className="bg-muted hover:bg-accent focus-visible:ring-ring inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] font-medium outline-none focus-visible:ring-2 disabled:opacity-50 md:min-h-10"
    >
      <Check className="size-4" strokeWidth={2.4} />
      Me lo comí
    </button>
  );
}
