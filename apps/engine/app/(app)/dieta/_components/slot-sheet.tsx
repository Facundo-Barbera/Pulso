"use client";

import type { Macros, PlanItem, Recipe } from "@pulso/contract";
import { ChevronRight, Clock, Users } from "lucide-react";
import { useState } from "react";
import type { DietaEntry } from "@/src/web/dieta";
import type { SlotView } from "@/src/web/dieta-plan";
import { EntryActions, SaveRecipeAsDish } from "./actions";
import { useDieta } from "./client";
import { byDish, DishRow } from "./dish";
import { usePlanActions } from "./plan-actions";
import { buttonPrimary, buttonQuiet, Sheet } from "./sheet";
import { SlotRow, statusLabel } from "./slot-row";
import { fmt, fmtAmount } from "./units";

// Plan dates are calendar days: format in UTC so the browser's timezone can't shift them.
const dayFormat = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const fmtPlanDay = (date: string) => dayFormat.format(new Date(`${date}T00:00:00Z`));

const MACROS = [
  { key: "protein", label: "Proteína", color: "var(--domain-protein)" },
  { key: "carbs", label: "Carbos", color: "var(--domain-carbs)" },
  { key: "fat", label: "Grasa", color: "var(--domain-fat)" },
] as const;

function MacroLine({ macros, caption }: { macros: Macros; caption?: string }) {
  return (
    <div className="bg-muted/60 flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-xl px-4 py-3">
      <p className="flex items-baseline gap-1">
        <span className="tabular text-[22px] leading-none font-semibold">{fmt(Math.round(macros.kcal))}</span>
        <span className="text-muted-foreground text-[12px]">kcal{caption && ` ${caption}`}</span>
      </p>
      {MACROS.map((m) => (
        <p key={m.key} className="flex items-center gap-1.5 text-[13px]">
          <span className="size-1.5 rounded-full" style={{ background: m.color }} />
          <span className="tabular font-medium">{fmt(Math.round(macros[m.key]))} g</span>
          <span className="text-muted-foreground">{m.label.toLowerCase()}</span>
        </p>
      ))}
    </div>
  );
}

function ItemList({ items }: { items: (Pick<PlanItem, "name" | "kcal"> & { amount: string })[] }) {
  return (
    <ul className="divide-border divide-y">
      {items.map((item, i) => (
        <li key={i} className="flex min-h-11 items-center gap-3 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[14px]">{item.name}</span>
          <span className="text-muted-foreground shrink-0 text-[13px] tabular">{item.amount}</span>
          <span className="text-muted-foreground w-16 shrink-0 text-right text-[13px] tabular">{fmt(Math.round(item.kcal))} kcal</span>
        </li>
      ))}
    </ul>
  );
}

/** A recipe: time, portions, one portion's macros, the whole pot's ingredients and the steps. */
export function RecipeDetail({ recipe, portions }: { recipe: Recipe; portions?: number }) {
  return (
    <div className="space-y-5">
      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        <span className="flex items-center gap-1.5">
          <Clock className="size-3.5" />
          {recipe.prepMinutes} min
        </span>
        <span className="flex items-center gap-1.5">
          <Users className="size-3.5" />
          Rinde {fmt(recipe.servings)} {recipe.servings === 1 ? "porción" : "porciones"}
          {recipe.batch && " · aguanta varios días"}
        </span>
      </div>
      <MacroLine macros={recipe.perServing} caption="por porción" />
      <section>
        <h3 className="mb-1 text-[13px] font-semibold">Ingredientes{portions && portions !== recipe.servings ? ` · para ${fmt(recipe.servings)} porciones` : ""}</h3>
        <ItemList items={recipe.ingredients.map((i) => ({ name: i.name, kcal: i.kcal, amount: fmtAmount({ amount: i.quantity, unit: i.unit, size: null }, i.quantity, "g") }))} />
      </section>
      {recipe.steps && (
        <section>
          <h3 className="mb-1.5 text-[13px] font-semibold">Cómo se hace</h3>
          <p className="text-muted-foreground text-[14px] leading-relaxed whitespace-pre-line">{recipe.steps}</p>
        </section>
      )}
    </div>
  );
}

/** A planned meal in full: what it is, where it comes from, its macros, and what can happen to it. */
export function SlotSheet({ slot, recipe, entries = [], onClose }: { slot: SlotView; recipe: Recipe | null; entries?: DietaEntry[]; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const { register } = useDieta();
  const actions = usePlanActions();
  const [busy, setBusy] = useState(false);
  const close = () => {
    setOpen(false);
    onClose();
  };
  const act = (work: () => Promise<unknown>) => async () => {
    setBusy(true);
    await work();
    setBusy(false);
    close();
  };
  const items = slot.adjusted ?? slot.items;

  return (
    <Sheet
      open={open}
      onClose={close}
      title={slot.real?.label ?? slot.label}
      footer={
        slot.status === "planned" ? (
          <>
            {slot.cooks && (
              <button onClick={act(() => actions.noTimeToCook(slot))} disabled={busy} className={`${buttonQuiet} mr-auto`}>
                {slot.later ? "Ese día no cocino" : "Hoy no cocino"}
              </button>
            )}
            <button onClick={act(() => actions.skip(slot))} disabled={busy} className={buttonQuiet}>
              {slot.later ? "Me lo voy a saltar" : "Me lo salté"}
            </button>
            {!slot.later && (
              <>
                <button onClick={act(() => actions.ateOut(slot))} disabled={busy} className={buttonQuiet}>
                  Comí fuera
                </button>
                <button
                  onClick={() => {
                    close();
                    register(undefined, slot);
                  }}
                  className={buttonQuiet}
                >
                  Registrar lo que comí
                </button>
                <button onClick={act(() => actions.eat(slot))} disabled={busy} className={buttonPrimary}>
                  Me lo comí
                </button>
              </>
            )}
          </>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <p className="text-muted-foreground text-[13px] first-letter:uppercase">
          {slot.title} · {fmtPlanDay(slot.date)}
          {slot.source && ` · ${slot.source}`}
          {(slot.status !== "planned" || slot.missed) && <span className="text-foreground font-medium"> · {statusLabel(slot)}</span>}
        </p>
        {slot.real && <MacroLine macros={slot.real.macros} />}
        {entries.length > 0 && (
          <ul className="-mx-2 -mt-2">
            {byDish(entries).map(({ dish, entries: parts }) => {
              const row = (e: DietaEntry) => (
                <li key={e.id} className="group hover:bg-muted/50 flex min-h-11 items-center gap-3 rounded-xl px-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">{e.name}</span>
                    <span className="text-muted-foreground block truncate text-[12px] tabular">
                      {fmtAmount(e.measure, e.quantity, e.unit)}
                      {!dish && ` · ${e.time}`}
                    </span>
                  </span>
                  <EntryActions entry={e} />
                  <span className="text-muted-foreground w-12 shrink-0 text-right text-[13px] tabular">{fmt(Math.round(e.kcal))}</span>
                </li>
              );
              return dish ? <DishRow key={dish.id} dish={dish} entries={parts} detail={parts[0]!.time} renderEntry={row} /> : row(parts[0]!);
            })}
          </ul>
        )}
        {slot.note && <p className="text-muted-foreground text-[13px] italic">«{slot.note}»</p>}
        {slot.real ? (
          // Eaten: what it was is above, once; the plan behind it stays folded.
          !slot.real.asPlanned && (
            <details className="group/plan">
              <summary className="text-muted-foreground hover:text-foreground flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium [&::-webkit-details-marker]:hidden">
                Planeado: {slot.label} · <span className="tabular">{fmt(Math.round(slot.macros.kcal))} kcal</span>
                <ChevronRight className="size-3.5 transition-transform group-open/plan:rotate-90" aria-hidden />
              </summary>
              <div className="mt-2 opacity-80">
                <ItemList items={items.map((i) => ({ name: i.name, kcal: i.kcal, amount: fmtAmount(null, i.quantity, i.unit) }))} />
              </div>
            </details>
          )
        ) : (
          <>
            {slot.adjusted && <p className="text-training text-[13px] font-medium">Porciones ajustadas por el Coach para hoy.</p>}
            {recipe ? (
              <>
                {slot.portions !== null && slot.portions !== 1 && <p className="text-[14px]">Te toca {fmt(slot.portions)} porciones.</p>}
                <RecipeDetail recipe={recipe} portions={slot.portions ?? 1} />
                <SaveRecipeAsDish recipe={recipe} />
              </>
            ) : (
              <>
                <MacroLine macros={slot.macros} />
                <ItemList items={items.map((i) => ({ name: i.name, kcal: i.kcal, amount: fmtAmount(null, i.quantity, i.unit) }))} />
              </>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Rows of planned meals that open their detail sheet. */
export function SlotList({ slots, recipes, entries = [], showTitle = true }: { slots: SlotView[]; recipes: Record<string, Recipe>; entries?: DietaEntry[]; showTitle?: boolean }) {
  const [shown, setShown] = useState<{ slot: SlotView; key: number } | null>(null);
  const recipeOf = (slot: SlotView) => (slot.recipeId ? (recipes[slot.recipeId] ?? null) : null);
  return (
    <>
      <ul className="-mx-2">
        {slots.map((slot) => (
          <SlotRow
            key={slot.id}
            slot={slot}
            showTitle={showTitle}
            time={entries.find((e) => slot.real?.entryIds.includes(e.id))?.time}
            moveTargets={entries.length ? slots.filter((s) => s.id !== slot.id) : []}
            onOpen={() => setShown({ slot, key: Date.now() })}
          />
        ))}
      </ul>
      {shown && (
        <SlotSheet
          key={shown.key}
          slot={shown.slot}
          recipe={recipeOf(shown.slot)}
          entries={entries.filter((e) => shown.slot.entryIds.includes(e.id))}
          onClose={() => setShown(null)}
        />
      )}
    </>
  );
}
