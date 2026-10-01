"use client";

import { MEAL_SLOTS, type Recipe } from "@pulso/contract";
import { ArrowLeftRight, Check, ChefHat, Clock, Minus, Store } from "lucide-react";
import { useState } from "react";
import type { DayView, SlotView } from "@/src/web/dieta-plan";
import { Card } from "../../../_ui/card";
import { cn } from "../../../_ui/cn";
import { PrepChip } from "./prep-chip";
import { SlotList, SlotSheet } from "./slot-sheet";

// Plan dates are calendar days: format in UTC so the browser's timezone can't shift them.
const weekday = new Intl.DateTimeFormat("es", { weekday: "short", timeZone: "UTC" });
const longDay = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
const utc = (date: string) => new Date(`${date}T00:00:00Z`);
const kcal = new Intl.NumberFormat("es", { maximumFractionDigits: 0 });

function SourceIcon({ slot }: { slot: SlotView }) {
  const Icon = slot.kind === "prep" ? ChefHat : slot.kind === "recipe" ? Clock : slot.kind === "eat_out" ? Store : null;
  return Icon ? <Icon className="size-3 shrink-0" aria-hidden /> : null;
}

/** One meal in the grid: the dish in two lines, kcal, a mark for how it went. Opens the meal's sheet. */
function Cell({ slot, onOpen }: { slot: SlotView; onOpen: () => void }) {
  const crossed = slot.status === "skipped" || slot.status === "replaced";
  return (
    <button
      type="button"
      onClick={onOpen}
      title={[slot.label, slot.source].filter(Boolean).join(" · ")}
      className={cn(
        "focus-visible:ring-ring flex w-full flex-col gap-1 rounded-xl p-2 text-left outline-none transition-colors focus-visible:ring-2",
        slot.status === "planned" ? "bg-muted/50 hover:bg-muted" : "hover:bg-muted/50",
        slot.status === "eaten" && "bg-body/10",
      )}
    >
      <span className={cn("line-clamp-2 text-[12.5px] leading-snug font-medium", slot.status !== "planned" && "text-muted-foreground", crossed && "line-through decoration-1")}>{slot.label}</span>
      <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
        {slot.status === "eaten" ? (
          <Check className="text-body size-3 shrink-0" strokeWidth={3} />
        ) : slot.status === "replaced" ? (
          <ArrowLeftRight className="text-carbs size-3 shrink-0" />
        ) : slot.status === "skipped" ? (
          <Minus className="size-3 shrink-0" />
        ) : (
          <SourceIcon slot={slot} />
        )}
        <span className="tabular truncate">{kcal.format(slot.kcal)} kcal</span>
      </span>
    </button>
  );
}

/**
 * A week of the plan. On wide screens a dated grid — days across, meals down,
 * cooking sessions in the first row; on narrow ones the days one under another
 * with each meal's row menu.
 */
export function PlanWeek({ title, days, recipes, today, delay }: { title: string; days: DayView[]; recipes: Record<string, Recipe>; today: string; delay?: number }) {
  const [shown, setShown] = useState<{ slot: SlotView; key: number } | null>(null);
  const open = (slot: SlotView) => setShown({ slot, key: Date.now() });
  const rows = MEAL_SLOTS.filter((s) => days.some((d) => d.slots.some((x) => x.slot === s)));
  const cooking = days.some((d) => d.preps.length > 0);
  const recipeOf = (slot: SlotView) => (slot.recipeId ? (recipes[slot.recipeId] ?? null) : null);
  const labelOf = (slot: string) => days.flatMap((d) => d.slots).find((s) => s.slot === slot)!.title;
  const cols = { gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` };

  return (
    <Card className="relative has-[[aria-expanded=true]]:z-10" delay={delay}>
      <h2 className="mb-4 text-[15px] font-semibold tracking-tight">{title}</h2>

      {/* Wide: the grid. */}
      <div className="hidden lg:block">
        <div className="grid gap-1.5" style={cols}>
          {days.map((d) => (
            <div key={d.date} className={cn("rounded-xl px-2 pt-1 pb-2", d.date === today && "bg-primary/10")}>
              <p className={cn("text-[12px] font-medium uppercase", d.date === today ? "text-primary" : "text-muted-foreground")}>{d.date === today ? "Hoy" : weekday.format(utc(d.date))}</p>
              <p className="tabular text-[20px] leading-tight font-semibold">{Number(d.date.slice(8))}</p>
              <p className="text-muted-foreground tabular text-[11px]">
                {kcal.format(d.kcal)} / {kcal.format(d.goalKcal)}
              </p>
            </div>
          ))}
        </div>
        {cooking && (
          <div className="mt-1.5 grid gap-1.5" style={cols}>
            {days.map((d) => (
              <div key={d.date} className="space-y-1.5">
                {d.preps.map((p) => (
                  <PrepChip key={p.id} prep={p} recipe={recipes[p.recipeId] ?? null} today={today} compact />
                ))}
              </div>
            ))}
          </div>
        )}
        {rows.map((slot) => (
          <div key={slot}>
            <p className="text-muted-foreground mt-3 mb-1 px-1 text-[11px] font-medium tracking-wide uppercase">{labelOf(slot)}</p>
            <div className="grid gap-1.5" style={cols}>
              {days.map((d) => (
                <div key={d.date} className="space-y-1.5">
                  {d.slots
                    .filter((s) => s.slot === slot)
                    .map((s) => (
                      <Cell key={s.id} slot={s} onOpen={() => open(s)} />
                    ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Narrow: a list of days. */}
      <ol className="space-y-6 lg:hidden">
        {days.map((d) => (
          <li key={d.date}>
            <div className="mb-1 flex items-baseline gap-2">
              <p className={cn("text-[14px] font-semibold first-letter:uppercase", d.date === today && "text-primary")}>{d.date === today ? "Hoy" : longDay.format(utc(d.date))}</p>
              <p className="text-muted-foreground tabular ml-auto text-[12px]">
                {kcal.format(d.kcal)} / {kcal.format(d.goalKcal)} kcal
              </p>
            </div>
            {d.preps.length > 0 && (
              <div className="my-2 space-y-2">
                {d.preps.map((p) => (
                  <PrepChip key={p.id} prep={p} recipe={recipes[p.recipeId] ?? null} today={today} />
                ))}
              </div>
            )}
            {d.slots.length ? <SlotList slots={d.slots} recipes={recipes} /> : <p className="text-muted-foreground py-2 text-[13px]">Sin comidas planeadas.</p>}
          </li>
        ))}
      </ol>

      {shown && <SlotSheet key={shown.key} slot={shown.slot} recipe={recipeOf(shown.slot)} onClose={() => setShown(null)} />}
    </Card>
  );
}
