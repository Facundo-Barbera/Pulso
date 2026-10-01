"use client";

import type { SlotStatus } from "@pulso/contract";
import { ArrowLeftRight, Check, ChefHat, Ellipsis, Minus, RotateCcw, SkipForward, Utensils, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SlotView } from "@/src/web/dieta-plan";
import { cn } from "../../../_ui/cn";
import { useDieta } from "./client";
import { usePlanActions } from "./plan-actions";

export const STATUS_LABELS: Record<SlotStatus, string> = { planned: "Pendiente", eaten: "Comida", replaced: "Reemplazada", skipped: "Saltada" };

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
    <span className={cn(base, slot.status === "replaced" ? "bg-carbs/15 text-carbs" : "bg-muted text-muted-foreground")} aria-hidden>
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
 * One planned meal: status, what it is, where it comes from, kcal, and a menu
 * with what can happen to it — eaten, swapped for something else (opens
 * «Registrar» tied to it), skipped, or no time to cook today.
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
                { label: "Lo cambié por…", icon: ArrowLeftRight, run: () => register(undefined, slot) },
              ]),
          { label: slot.later ? "Me lo voy a saltar" : "Me lo salté", icon: SkipForward, run: busyWhile(() => actions.skip(slot)) },
          ...(slot.cooks ? [{ label: slot.later ? "Ese día no cocino" : "Hoy no cocino", icon: ChefHat, run: busyWhile(() => actions.noTimeToCook(slot)) }] : []),
        ]
      : slot.status === "eaten"
        ? [{ label: "No me lo comí", icon: RotateCcw, run: busyWhile(() => actions.uneat(slot)) }]
        : [];

  const done = slot.status !== "planned";
  const crossed = slot.status === "skipped" || slot.status === "replaced";
  const detail = [showTitle && slot.title, slot.source].filter(Boolean).join(" · ");

  return (
    <li className={cn("hover:bg-muted/50 flex min-h-14 items-center gap-3 rounded-xl px-2 py-1.5", busy && "opacity-60")}>
      <StatusMark slot={slot} busy={busy} onEat={busyWhile(() => actions.eat(slot))} onUneat={busyWhile(() => actions.uneat(slot))} />
      <button type="button" onClick={onOpen} disabled={!onOpen} className="focus-visible:ring-ring min-w-0 flex-1 rounded-lg text-left outline-none focus-visible:ring-2 disabled:cursor-default">
        <span className={cn("block truncate text-[14px] font-medium", done && "text-muted-foreground", crossed && "line-through decoration-1")}>{slot.label}</span>
        <span className="text-muted-foreground block truncate text-[12px]">
          {slot.status === "replaced" && slot.replacedBy ? (
            <>
              <span className="text-carbs">Comiste {slot.replacedBy}</span>
              {showTitle && ` · ${slot.title}`}
            </>
          ) : (
            detail || STATUS_LABELS[slot.status]
          )}
        </span>
      </button>
      <span className="hidden shrink-0 text-right sm:block">
        <span className={cn("block text-[12px] font-medium", slot.status === "planned" ? "text-muted-foreground" : slot.status === "eaten" ? "text-body" : slot.status === "replaced" ? "text-carbs" : "text-muted-foreground")}>
          {STATUS_LABELS[slot.status]}
        </span>
        <span className="text-muted-foreground tabular block text-[12px]">{fmtKcal.format(slot.kcal)} kcal</span>
      </span>
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
