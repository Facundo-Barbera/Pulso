"use client";

import type { WaterDay } from "@pulso/contract";
import { ChevronDown, Droplet, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Card, CardTitle } from "../../../_ui/card";
import { cn } from "../../../_ui/cn";
import { useAction, useDieta } from "./client";
import { buttonSoft, field } from "./sheet";

const WATER = "var(--domain-fat)";
const litres = (ml: number) => `${(ml / 1000).toLocaleString("es", { maximumFractionDigits: 2 })} L`;

/** Water: how far along the goal, one tap for the usual glass, the rest (bottle, other amount, undo) in a menu. */
export function WaterCard({ water, delay }: { water: WaterDay; delay?: number }) {
  const { date } = useDieta();
  const { run, pending, error } = useAction();
  const [menu, setMenu] = useState(false);
  const [custom, setCustom] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const { glassMl, bottleMl } = water.settings;
  const last = water.entries.at(-1);
  const progress = water.goalMl ? Math.min(1, water.totalMl / water.goalMl) : 0;

  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setMenu(false);
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);

  const add = (amountMl: number) => {
    setMenu(false);
    setCustom(null);
    run("water", "POST", { amountMl, date });
  };

  const options = [
    { label: `Botella · ${litres(bottleMl)}`, ml: bottleMl },
    ...(bottleMl !== 1000 ? [{ label: "1 L", ml: 1000 }] : []),
    ...(glassMl !== 330 && bottleMl !== 330 ? [{ label: "Lata · 330 ml", ml: 330 }] : []),
  ];

  return (
    <Card delay={delay}>
      <CardTitle icon={Droplet} color={WATER} title="Agua" />
      <div className="flex items-baseline gap-1.5">
        <span className="tabular text-[28px] leading-none font-semibold tracking-tight">{litres(water.totalMl)}</span>
        <span className="text-muted-foreground text-[13px]">de {litres(water.goalMl)}</span>
        {progress >= 1 && <span className="text-body ml-auto text-[12px] font-medium">Objetivo cumplido</span>}
      </div>
      <div className="bg-muted mt-3 h-2 overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={water.goalMl} aria-valuenow={water.totalMl} aria-label="Agua del día">
        <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${progress * 100}%`, background: WATER }} />
      </div>
      <p className="text-muted-foreground mt-2 text-[12px]">
        {water.goalSource === "weight" ? "35 ml por kg de tu peso" : water.goalSource === "custom" ? "Tu objetivo" : "Objetivo por defecto"}
        {water.entries.length > 0 && ` · ${water.entries.length} ${water.entries.length === 1 ? "registro" : "registros"}`}
      </p>

      <div ref={box} className="relative mt-4 flex gap-2">
        <button onClick={() => add(glassMl)} disabled={pending} className={cn(buttonSoft, "flex-1")}>
          <Plus className="size-4" strokeWidth={2.4} style={{ color: WATER }} />
          Vaso · {glassMl} ml
        </button>
        <button onClick={() => setMenu(!menu)} className={cn(buttonSoft, "px-3")} aria-expanded={menu} aria-haspopup="menu" aria-label="Otras cantidades">
          <ChevronDown className={cn("size-4 transition-transform", menu && "rotate-180")} />
        </button>
        {menu && (
          <div role="menu" className="bg-popover shadow-3 border-border absolute top-full right-0 z-20 mt-2 w-60 rounded-2xl border p-1.5 motion-safe:animate-[pulso-rise_160ms_ease-out_both]">
            {options.map((o) => (
              <button key={o.label} role="menuitem" onClick={() => add(o.ml)} className="hover:bg-accent flex min-h-10 w-full items-center rounded-xl px-3 text-left text-[14px]">
                {o.label}
              </button>
            ))}
            <button role="menuitem" onClick={() => (setCustom(""), setMenu(false))} className="hover:bg-accent flex min-h-10 w-full items-center rounded-xl px-3 text-left text-[14px]">
              Otra cantidad…
            </button>
            {last && (
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  run(`water/${last.id}`, "DELETE");
                }}
                className="text-muted-foreground hover:bg-accent border-border mt-1 flex min-h-10 w-full items-center rounded-xl border-t px-3 text-left text-[14px]"
              >
                Deshacer {last.amountMl} ml
              </button>
            )}
          </div>
        )}
      </div>
      {custom !== null && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const ml = Number(custom.replace(",", "."));
            if (ml > 0) add(ml);
          }}
        >
          <input autoFocus value={custom} onChange={(e) => setCustom(e.target.value)} inputMode="numeric" placeholder="ml" className={cn(field, "flex-1 tabular")} aria-label="Mililitros" />
          <button type="submit" disabled={pending} className={buttonSoft}>
            Añadir
          </button>
        </form>
      )}
      {error && <p className="text-destructive mt-2 text-[12px]">{error}</p>}
    </Card>
  );
}
