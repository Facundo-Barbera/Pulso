"use client";

import type { SlotStatus } from "@pulso/contract";
import { ArrowLeftRight, Check, ChefHat, Ellipsis, Minus, PenLine, RotateCcw, SkipForward, Store, Utensils, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SlotView } from "@/src/web/dieta-plan";
import { cn } from "../../../_ui/cn";
import { useDieta } from "./client";
import { usePlanActions } from "./plan-actions";

export const STATUS_LABELS: Record<SlotStatus, string> = { planned: "Pendiente", eaten: "Según el plan", replaced: "Otra cosa", skipped: "Saltada" };

/** The status as the row says it: a pending meal well past its time reads «Sin registrar». */
export const statusLabel = (slot: SlotView) => (slot.missed ? "Sin registrar" : STATUS_LABELS[slot.status]);

const fmtKcal = new Intl.NumberFormat("es", { maximumFractionDigits: 0 });

/** The circle at the start of a row: what happened to the meal; on a pending one, a tap eats it. */
function StatusMark({ slot, onEat, onUneat, busy }: { slot: SlotView; onEat: () => void; onUneat: () => void; busy: boolean }) {
  const base = "focus-visible:ring-ring grid size-8 shrink-0 place-items-center rounded-full outline-none transition-colors focus-visible:ring-2";
  if (slot.status === "planned" && slot.later) return <span className={cn(base, "border-border border-2 border-dashed")} aria-hidden />;
  if (slot.status === "planned")
    return (
      <button onClick={onEat} disabled={busy} className={cn(base, "group border-border hover:border-body hover:bg-body/10 border-2")} aria-label={`Me lo comí: ${slot.label}`} title="Me lo comí">
        <Check className="text-body size-4 opacity-0 transition-opacity group-hover:opacity-60" strokeWidth={3} />
      </button>
    );
  if (slot.status === "eaten")
    return (
      <button onClick={onUneat} disabled={busy} className={cn(base, "bg-body text-background")} aria-label={`Desmarcar ${slot.label}`} title="Comida · tocar para desmarcar">
        <Check className="size-4" strokeWidth={3} />
      </button>
    );
  const Icon = slot.status === "replaced" ? ArrowLeftRight : Minus;
  return (
    <span className={cn(base, slot.status === "replaced" ? "bg-body/15 text-body" : "bg-muted text-muted-foreground")} aria-hidden>
      <Icon className="size-4" strokeWidth={2.4} />
    </span>
  );
}

type MenuItem = { label: string; icon: LucideIcon; run: () => void };

/** A small popover menu: closes on a pick, a click outside or Escape. */
function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
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
                className="hover:bg-muted focus-visible:bg-muted flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 text-left text-[14px] outline-none"
              >
                <item.icon className="text-muted-foreground size-4" />
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
 * One meal of the day as Planeado → Real: what was eaten, prominent, over what
 * was planned, small and struck; a pending meal shows the plan, and once well
 * past its time («sin registrar») two quick answers. The menu has what can
 * happen to it — eaten, something else (opens «Registrar» tied to it), eaten
 * out, skipped, or no time to cook today.
 */
export function SlotRow({ slot, onOpen, showTitle = true }: { slot: SlotView; onOpen?: () => void; showTitle?: boolean }) {
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
      : slot.status === "eaten"
        ? [{ label: "No me lo comí", icon: RotateCcw, run: busyWhile(() => actions.uneat(slot)) }]
        : [];

  const real = slot.real;
  const kcal = real ? real.macros.kcal : slot.kcal;
  const detail = [showTitle && slot.title, slot.source].filter(Boolean).join(" · ");
  const tone = slot.missed ? "text-energy" : slot.status === "planned" || slot.status === "skipped" ? "text-muted-foreground" : "text-body";
  const quick = "bg-muted hover:bg-accent focus-visible:ring-ring inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium outline-none focus-visible:ring-2 disabled:opacity-50";

  return (
    <li className={cn("hover:bg-muted/50 flex min-h-14 items-center gap-3 rounded-xl px-2 py-1.5", busy && "opacity-60")}>
      <StatusMark slot={slot} busy={busy} onEat={busyWhile(() => actions.eat(slot))} onUneat={busyWhile(() => actions.uneat(slot))} />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onOpen} disabled={!onOpen} className="focus-visible:ring-ring block w-full min-w-0 rounded-lg text-left outline-none focus-visible:ring-2 disabled:cursor-default">
          {real ? (
            <>
              <span className="block truncate text-[14px] font-medium">{real.label}</span>
              <span className="text-muted-foreground block truncate text-[12px]">
                {real.asPlanned ? (
                  "Como estaba planeado"
                ) : (
                  <>
                    Planeado: <span className="line-through decoration-1">{slot.label}</span>
                  </>
                )}
                {showTitle && ` · ${slot.title}`}
              </span>
            </>
          ) : (
            <>
              <span className={cn("block truncate text-[14px] font-medium", slot.status === "skipped" && "text-muted-foreground line-through decoration-1")}>{slot.label}</span>
              <span className="text-muted-foreground block truncate text-[12px]">{detail || statusLabel(slot)}</span>
            </>
          )}
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
      <span className="hidden shrink-0 text-right sm:block">
        <span className={cn("block text-[12px] font-medium", tone)}>{statusLabel(slot)}</span>
        <span className="text-muted-foreground tabular block text-[12px]">{fmtKcal.format(kcal)} kcal</span>
      </span>
      <span className="text-muted-foreground tabular shrink-0 text-[12px] sm:hidden">{fmtKcal.format(kcal)}</span>
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
