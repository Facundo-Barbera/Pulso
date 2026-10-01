"use client";

import type { Macros, PlanItem, Recipe } from "@pulso/contract";
import { Clock, Users } from "lucide-react";
import { useState } from "react";
import type { SlotView } from "@/src/web/dieta-plan";
import { useDieta } from "./client";
import { usePlanActions } from "./plan-actions";
import { buttonPrimary, buttonQuiet, Sheet } from "./sheet";
import { SlotRow, STATUS_LABELS } from "./slot-row";
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
export function SlotSheet({ slot, recipe, onClose }: { slot: SlotView; recipe: Recipe | null; onClose: () => void }) {
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
      title={slot.label}
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
                <button
                  onClick={() => {
                    close();
                    register(undefined, slot);
                  }}
                  className={buttonQuiet}
                >
                  Lo cambié por…
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
          {slot.status !== "planned" && <span className="text-foreground font-medium"> · {STATUS_LABELS[slot.status]}</span>}
        </p>
        {slot.status === "replaced" && slot.replacedBy && <p className="text-carbs text-[14px]">Comiste {slot.replacedBy} en su lugar.</p>}
        {slot.note && <p className="text-muted-foreground text-[13px] italic">«{slot.note}»</p>}
        {slot.adjusted && <p className="text-training text-[13px] font-medium">Porciones ajustadas por el Coach para hoy.</p>}
        {recipe ? (
          <>
            {slot.portions !== null && slot.portions !== 1 && <p className="text-[14px]">Te toca {fmt(slot.portions)} porciones.</p>}
            <RecipeDetail recipe={recipe} portions={slot.portions ?? 1} />
          </>
        ) : (
          <>
            <MacroLine macros={slot.macros} />
            <ItemList items={items.map((i) => ({ name: i.name, kcal: i.kcal, amount: fmtAmount(null, i.quantity, i.unit) }))} />
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Rows of planned meals that open their detail sheet. */
export function SlotList({ slots, recipes, showTitle = true }: { slots: SlotView[]; recipes: Record<string, Recipe>; showTitle?: boolean }) {
  const [shown, setShown] = useState<{ slot: SlotView; key: number } | null>(null);
  const recipeOf = (slot: SlotView) => (slot.recipeId ? (recipes[slot.recipeId] ?? null) : null);
  return (
    <>
      <ul className="-mx-2">
        {slots.map((slot) => (
          <SlotRow key={slot.id} slot={slot} showTitle={showTitle} onOpen={() => setShown({ slot, key: Date.now() })} />
        ))}
      </ul>
      {shown && <SlotSheet key={shown.key} slot={shown.slot} recipe={recipeOf(shown.slot)} onClose={() => setShown(null)} />}
    </>
  );
}
