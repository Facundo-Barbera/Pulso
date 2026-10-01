"use client";

import { HOUSEHOLD_SIZES, type DishRef, type FoodProduct, type FrequentFood, type Macros, type MealEntry, type MealSlot, type MeasureUnit, type PortionEstimate, type SavedDish } from "@pulso/contract";
import { BookmarkPlus, CookingPot, Plus, ScanBarcode, Search, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { DietaEntry } from "@/src/web/dieta";
import type { SlotView } from "@/src/web/dieta-plan";
import { cn } from "../../../_ui/cn";
import { send, useAction, useDieta } from "./client";
import { usePlanActions } from "./plan-actions";
import { buttonPrimary, buttonQuiet, buttonSoft, field, Sheet } from "./sheet";
import { fmt, fmtAmount, isHousehold, perHundred, SLOT_OPTIONS, slotForHour, unitLabel, UNITS } from "./units";

type Per = Record<keyof Macros | "caffeine" | "abv", string>;
const EMPTY_PER: Per = { kcal: "", protein: "", carbs: "", fat: "", fiber: "", caffeine: "", abv: "" };

/** Something already logged, as the form would have been filled to log it. */
type Logged = Pick<FrequentFood, "name" | "quantity" | "unit" | "measure" | "slot" | "barcode" | "caffeineMg" | "alcoholG"> & Macros;

const num = (text: string) => {
  const n = Number(text.replace(",", ".").trim());
  return text.trim() && Number.isFinite(n) && n >= 0 ? n : null;
};
const round1 = (n: number) => Math.round(n * 10) / 10;
const str = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "" : String(round1(n)));
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const nowTime = () => new Date().toTimeString().slice(0, 5);
const PORTIONS = [0.5, 1, 1.5, 2];
const portionLabel = (x: number) => (x === 0.5 ? "½" : x === 1.5 ? "1½" : String(x));

/** A food in the dish being put together: the body the engine takes, and what the list shows. */
type Part = { body: Record<string, unknown>; name: string; kcal: number; protein: number; amount: string };

/** Millilitres in the amount, when it is a drink measure. */
function millilitres(unit: MeasureUnit, amount: number, size: number | null): number | null {
  if (unit === "ml") return amount;
  if (isHousehold(unit) && HOUSEHOLD_SIZES[unit].base === "ml") return amount * (size ?? HOUSEHOLD_SIZES[unit].size ?? 0);
  return null;
}

/** The form's fields from something logged before: per-unit values are its totals divided back. */
function fromLogged(f: Logged) {
  const unit: MeasureUnit = f.measure?.unit ?? f.unit;
  const amount = f.measure?.amount ?? f.quantity;
  const size = f.measure?.size ?? null;
  const factor = (perHundred(unit) ? amount / 100 : amount) || 1;
  const ml = millilitres(unit, amount, size);
  const per: Per = {
    kcal: str(f.kcal / factor),
    protein: str(f.protein / factor),
    carbs: str(f.carbs / factor),
    fat: str(f.fat / factor),
    fiber: f.fiber ? str(f.fiber / factor) : "",
    caffeine: f.caffeineMg ? str(f.caffeineMg / factor) : "",
    abv: f.alcoholG && ml ? str((f.alcoholG / (ml * 0.789)) * 100) : "",
  };
  return { name: f.name, unit, amount: str(amount), size: size === null ? "" : str(size), per };
}

/**
 * «Registrar»: one sheet for meals, snacks and drinks. The name field searches
 * the frequent foods (pick one to fill everything, or + to log it as it was);
 * the amount takes any measure a person says — g, ml, taza, lata, puño…; macros
 * are entered per 100 g/ml or per one unit and scaled. A barcode can be typed;
 * with a product, «Cuánto comiste» in words («una cucharada») fills the amount.
 * With `entry`, the same form corrects a logged entry. With `replacing`, it logs
 * what was eaten instead of a planned meal and ties it to that slot (a plan
 * change with «Deshacer»). With `addingTo`, the food joins a dish eaten.
 *
 * Mis platillos come first in the search: + logs one as saved; picking one
 * opens it as a platillo to take a portion (½…2), drop or add something this
 * time. «Platillo» puts one together from several foods (the form adds each),
 * optionally keeping it in Mis platillos.
 */
export function RegisterSheet({ entry, replacing, addingTo, onClose }: { entry?: DietaEntry; replacing?: SlotView; addingTo?: DishRef; onClose: () => void }) {
  const { date: shownDate, frequent, dishes } = useDieta();
  const router = useRouter();
  const date = replacing?.date ?? shownDate;
  const { run, pending: running, error, setError } = useAction();
  const plan = usePlanActions();
  const [replacingBusy, setReplacingBusy] = useState(false);
  const pending = running || replacingBusy;
  const initial = entry ? fromLogged(entry) : null;

  const [open, setOpen] = useState(true);
  const [name, setName] = useState(initial?.name ?? "");
  const [unit, setUnit] = useState<MeasureUnit>(initial?.unit ?? "g");
  const [amount, setAmount] = useState(initial?.amount ?? "100");
  const [size, setSize] = useState(initial?.size ?? "");
  const [per, setPer] = useState<Per>(initial?.per ?? EMPTY_PER);
  const [slot, setSlot] = useState<MealSlot>(entry?.slot ?? replacing?.slot ?? slotForHour(new Date().getHours()));
  const [time, setTime] = useState(entry?.time ?? nowTime());
  const [barcode, setBarcode] = useState<string | null>(entry?.barcode ?? null);
  const [searching, setSearching] = useState(!entry);
  const [scan, setScan] = useState<{ code: string; status: "idle" | "looking" | "missing" } | null>(null);
  const [said, setSaid] = useState("");
  const [portion, setPortion] = useState<{ busy: boolean; assumption: string | null; error: string | null }>({ busy: false, assumption: null, error: null });
  // A platillo being put together: from a saved dish (its components, a portion, some left out) and/or foods added here.
  const [dish, setDish] = useState<{ name: string; from: SavedDish | null; scale: number; removed: number[]; parts: Part[]; keep: boolean } | null>(null);
  const [dishBusy, setDishBusy] = useState(false);

  const close = () => {
    setOpen(false);
    onClose();
  };

  const amountN = num(amount) ?? 0;
  const sizeN = isHousehold(unit) ? num(size) : null;
  const factor = perHundred(unit) ? amountN / 100 : amountN;
  const ml = millilitres(unit, amountN, sizeN);
  const perN = (k: keyof Per) => num(per[k]) ?? 0;
  const alcoholG = ml && perN("abv") > 0 ? round1(ml * (perN("abv") / 100) * 0.789) : null;
  const totals: Macros = {
    kcal: Math.round(per.kcal.trim() ? perN("kcal") * factor : (perN("protein") * 4 + perN("carbs") * 4 + perN("fat") * 9) * factor + (alcoholG ?? 0) * 7),
    protein: round1(perN("protein") * factor),
    carbs: round1(perN("carbs") * factor),
    fat: round1(perN("fat") * factor),
    fiber: round1(perN("fiber") * factor),
  };
  const caffeineMg = perN("caffeine") > 0 ? Math.round(perN("caffeine") * factor) : null;

  const matches = useMemo(() => {
    const q = fold(name);
    return (q ? frequent.filter((f) => fold(f.name).includes(q)) : frequent).slice(0, q ? 6 : 5);
  }, [frequent, name]);
  const dishMatches = useMemo(() => {
    if (entry || addingTo || dish) return [];
    const q = fold(name);
    return (q ? dishes.filter((d) => fold(d.name).includes(q)) : dishes).slice(0, 3);
  }, [dishes, name, entry, addingTo, dish]);

  function pick(f: FrequentFood) {
    const filled = fromLogged(f);
    setName(filled.name);
    setUnit(filled.unit);
    setAmount(filled.amount);
    setSize(filled.size);
    setPer(filled.per);
    setBarcode(f.barcode);
    resetPortion();
    if (f.slot === "snack") setSlot("snack");
    setSearching(false);
  }

  const amountBody = (u: MeasureUnit, a: number, s: number | null) => (isHousehold(u) ? { measure: { amount: a, unit: u, size: s } } : { quantity: a, unit: u });

  /** Logs a new entry; when replacing a planned meal, also ties it to the slot. */
  async function log(body: Record<string, unknown>): Promise<boolean> {
    if (!replacing) return run("meals", "POST", body);
    setError(null);
    setReplacingBusy(true);
    const result = await send("meals", "POST", body);
    if (!result.ok) {
      setReplacingBusy(false);
      setError(result.message);
      return false;
    }
    const meal = (result.data as { meal: MealEntry }).meal;
    const ok = await plan.replace(replacing, meal);
    // The plan refused the change: don't leave an untied entry behind.
    if (!ok) await send(`meals/${meal.id}`, "DELETE");
    setReplacingBusy(false);
    return ok;
  }

  /** Logs a dish (saved, or put together here); `keep` then saves it to Mis platillos. Plan meals it replaces are tied to it. */
  async function logDishBody(path: string, body: Record<string, unknown>, keep = false) {
    setError(null);
    setDishBusy(true);
    const result = await send(path, "POST", { ...body, date, time, ...(replacing ? { slotId: replacing.id } : {}) });
    const meals = result.ok ? (result.data as { meals: MealEntry[] }).meals : [];
    if (result.ok && keep && meals[0]?.dish) await send("dishes", "POST", { loggedDishId: meals[0].dish.id });
    setDishBusy(false);
    if (!result.ok) return setError(result.message);
    router.refresh();
    close();
  }

  const quickDish = (d: SavedDish) => logDishBody(`dishes/${d.id}/log`, { slot: replacing?.slot ?? d.slot ?? slot });

  function openDish(d: SavedDish | null) {
    setDish({ name: d?.name ?? "", from: d, scale: 1, removed: [], parts: [], keep: false });
    if (d?.slot && !replacing) setSlot(d.slot);
    clearFood();
    // Calm until the person looks for something to add.
    setSearching(false);
  }

  function clearFood() {
    setName("");
    setUnit("g");
    setAmount("100");
    setSize("");
    setPer(EMPTY_PER);
    setBarcode(null);
    resetPortion();
    setSearching(true);
  }

  /** The food in the form as a dish component; a message when it isn't complete. */
  function foodPart(): Part | string {
    if (!name.trim()) return "Falta el nombre.";
    if (amountN <= 0) return "La cantidad tiene que ser mayor que cero.";
    const body = { name: name.trim(), ...totals, caffeineMg, alcoholG, barcode, ...amountBody(unit, amountN, sizeN) };
    const label = isHousehold(unit) ? fmtAmount({ amount: amountN, unit, size: sizeN }, amountN, "g") : fmtAmount(null, amountN, unit as "g" | "ml" | "serving");
    return { body, name: body.name, kcal: totals.kcal, protein: totals.protein, amount: label };
  }

  function addPart() {
    const part = foodPart();
    if (typeof part === "string") return setError(part);
    setError(null);
    setDish((d) => d && { ...d, parts: [...d.parts, part] });
    clearFood();
  }

  async function logDish() {
    if (!dish) return;
    // What is still in the form counts too, so nobody loses the last food.
    const pending = name.trim() ? foodPart() : null;
    if (typeof pending === "string") return setError(pending);
    const parts = pending ? [...dish.parts, pending] : dish.parts;
    const add = parts.map((p) => p.body);
    if (dish.from) {
      const overrides = dish.removed.map((i) => ({ component: i, remove: true }));
      return logDishBody(`dishes/${dish.from.id}/log`, { slot, scale: dish.scale, overrides, ...(add.length ? { add } : {}) });
    }
    if (!add.length) return setError("Añade al menos un ingrediente.");
    return logDishBody("meals/dish", { name: dish.name.trim() || undefined, slot, components: add }, dish.keep);
  }

  async function quickAdd(f: FrequentFood) {
    const ok = await log({
      name: f.name,
      slot: f.slot === "snack" ? "snack" : slot,
      date,
      time,
      kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, fiber: f.fiber,
      caffeineMg: f.caffeineMg, alcoholG: f.alcoholG, barcode: f.barcode,
      ...(f.measure ? { measure: f.measure } : { quantity: f.quantity, unit: f.unit }),
    });
    if (ok) close();
  }

  async function lookup() {
    if (!scan) return;
    setError(null);
    setScan({ ...scan, status: "looking" });
    const result = await send(`barcode/${encodeURIComponent(scan.code.trim())}`, "GET");
    if (!result.ok) {
      setScan({ ...scan, status: "idle" });
      setError(result.message);
      return;
    }
    const product = (result.data as { product: FoodProduct | null }).product;
    if (!product) {
      setBarcode(scan.code.trim());
      setScan({ ...scan, status: "missing" });
      return;
    }
    setName(product.brand && !product.name.toLowerCase().includes(product.brand.toLowerCase()) ? `${product.name} (${product.brand})` : product.name);
    setUnit("g");
    setAmount(str(product.servingGrams ?? 100));
    setSize("");
    setPer({ ...EMPTY_PER, ...Object.fromEntries(Object.entries(product.per100g).map(([k, v]) => [k, str(v)])) });
    setBarcode(product.barcode);
    resetPortion();
    setScan(null);
    setSearching(false);
  }

  /** The Mac turns «la mitad del paquete» into an amount of this product; the form takes it as if logged that way. */
  async function estimatePortion() {
    if (!barcode || !said.trim() || portion.busy) return;
    setPortion({ busy: true, assumption: null, error: null });
    const result = await send("portion", "POST", { barcode, amount: said.trim() });
    if (!result.ok) return setPortion({ busy: false, assumption: null, error: result.message });
    const { estimate } = result.data as { estimate: PortionEstimate };
    const filled = fromLogged({ ...estimate.macros, name, quantity: estimate.quantity, unit: estimate.unit, measure: estimate.measure, slot, barcode, caffeineMg: null, alcoholG: null });
    setUnit(filled.unit);
    setAmount(filled.amount);
    setSize(filled.size);
    setPer(filled.per);
    setPortion({ busy: false, assumption: estimate.assumption, error: null });
  }
  const resetPortion = () => {
    setSaid("");
    setPortion({ busy: false, assumption: null, error: null });
  };
  /** A hand-made change makes the assumption line stale. */
  const clearAssumption = () => portion.assumption && setPortion({ ...portion, assumption: null });

  async function save() {
    if (dish) return logDish();
    if (addingTo) {
      const part = foodPart();
      if (typeof part === "string") return setError(part);
      if (await run(`meals/dish/${addingTo.id}`, "PATCH", { add: [part.body] })) close();
      return;
    }
    if (!name.trim()) return setError("Falta el nombre.");
    if (amountN <= 0) return setError("La cantidad tiene que ser mayor que cero.");
    const body = {
      name: name.trim(),
      slot,
      date: entry?.date ?? date,
      time,
      ...totals,
      caffeineMg,
      alcoholG,
      barcode,
      ...amountBody(unit, amountN, sizeN),
    };
    const ok = entry
      ? await run(`meals/${entry.id}`, "PUT", body)
      : await log({ ...body, source: barcode ? "barcode" : "manual" });
    if (ok) close();
  }

  const kept = dish?.from ? dish.from.components.filter((_, i) => !dish.removed.includes(i)) : [];
  const dishTotals = dish && {
    kcal: kept.reduce((s, c) => s + c.kcal * dish.scale, 0) + dish.parts.reduce((s, p) => s + p.kcal, 0),
    protein: kept.reduce((s, c) => s + c.protein * dish.scale, 0) + dish.parts.reduce((s, p) => s + p.protein, 0),
  };
  const shown = dishTotals ?? totals;
  const busy = pending || dishBusy;
  const title = entry ? "Corregir" : addingTo ? `Añadir a ${addingTo.name}` : dish ? (dish.from?.name ?? "Crear platillo") : replacing ? `Tu ${replacing.title.toLowerCase()}` : "Registrar";
  const action = entry ? "Guardar" : addingTo ? "Añadir" : dish ? "Registrar platillo" : replacing ? "Cambiar" : "Registrar";
  const perLabel = perHundred(unit) ? `Por 100 ${unit}` : `Por 1 ${unitLabel(unit)}`;
  const defaultSize = isHousehold(unit) ? HOUSEHOLD_SIZES[unit].size : null;
  const sizeBase = isHousehold(unit) ? (unit === "unidad" ? "g" : HOUSEHOLD_SIZES[unit].base) : null;

  return (
    <Sheet
      open={open}
      onClose={close}
      title={title}
      footer={
        <>
          <p className="text-muted-foreground mr-auto truncate text-[13px] tabular" aria-live="polite">
            {fmt(Math.round(shown.kcal))} kcal · {fmt(round1(shown.protein))} g prot.
          </p>
          <button onClick={close} className={buttonQuiet}>
            Cancelar
          </button>
          <button onClick={save} disabled={busy} className={buttonPrimary}>
            {action}
          </button>
        </>
      }
    >
      {/* Enter in any text field saves; the barcode field handles its own Enter first. */}
      <form
        className="space-y-5"
        onSubmit={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          const target = e.target as HTMLElement;
          if (e.key === "Enter" && !e.defaultPrevented && target.tagName === "INPUT" && (target as HTMLInputElement).type !== "checkbox") {
            e.preventDefault();
            // Putting a platillo together, Enter adds the food in the form; the button logs the dish.
            if (!dish) save();
            else if (name.trim()) addPart();
          }
        }}
      >
        {!entry && !addingTo && (
          <div className="bg-muted -mt-1 grid grid-cols-2 rounded-xl p-1" role="radiogroup" aria-label="Qué registras">
            {[
              { label: "Un alimento", on: !dish, pick: () => setDish(null) },
              { label: "Un platillo", on: !!dish, pick: () => !dish && openDish(null) },
            ].map((o) => (
              <button key={o.label} type="button" role="radio" aria-checked={o.on} onClick={o.pick} className={cn("min-h-9 rounded-lg text-[13px] font-medium transition-colors", o.on ? "bg-background shadow-1" : "text-muted-foreground hover:text-foreground")}>
                {o.label}
              </button>
            ))}
          </div>
        )}
        {dish && (
          <div className="space-y-3">
            {dish.from ? (
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium">Porción</span>
                <div className="ml-auto flex gap-1">
                  {PORTIONS.map((x) => (
                    <button key={x} type="button" onClick={() => setDish({ ...dish, scale: x })} aria-pressed={dish.scale === x} className={cn("min-h-9 min-w-11 rounded-lg px-2 text-[13px] font-medium tabular", dish.scale === x ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent")}>
                      {portionLabel(x)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium">Nombre del platillo</span>
                <input value={dish.name} onChange={(e) => setDish({ ...dish, name: e.target.value })} placeholder="«Batido de proteína con fresas» · vacío: se nombra solo" className={cn(field, "w-full")} />
              </label>
            )}
            {(dish.from || dish.parts.length > 0) && (
              <ul className="border-border divide-y overflow-hidden rounded-xl border" aria-label="Ingredientes">
                {dish.from?.components.map((c, i) => {
                  const out = dish.removed.includes(i);
                  return (
                    <li key={`saved-${i}`} className={cn("flex min-h-11 items-center gap-3 px-3", out && "opacity-45")}>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-[14px]", out && "line-through")}>{c.name}</span>
                        <span className="text-muted-foreground block truncate text-[12px] tabular">{fmtAmount(c.measure && { ...c.measure, amount: c.measure.amount * dish.scale }, c.quantity * dish.scale, c.unit)}</span>
                      </span>
                      <span className="text-muted-foreground text-[13px] tabular">{fmt(Math.round(c.kcal * dish.scale))}</span>
                      <button type="button" onClick={() => setDish({ ...dish, removed: out ? dish.removed.filter((r) => r !== i) : [...dish.removed, i] })} className="text-muted-foreground hover:text-foreground grid size-9 place-items-center rounded-lg" aria-label={out ? `Volver a poner ${c.name}` : `Sin ${c.name} esta vez`} title={out ? "Volver a ponerlo" : "Sin esto esta vez"}>
                        {out ? <Plus className="size-4" /> : <X className="size-4" />}
                      </button>
                    </li>
                  );
                })}
                {dish.parts.map((p, i) => (
                  <li key={`part-${i}`} className="flex min-h-11 items-center gap-3 px-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">{p.name}</span>
                      <span className="text-muted-foreground block truncate text-[12px] tabular">{p.amount}</span>
                    </span>
                    <span className="text-muted-foreground text-[13px] tabular">{fmt(Math.round(p.kcal))}</span>
                    <button type="button" onClick={() => setDish({ ...dish, parts: dish.parts.filter((_, j) => j !== i) })} className="text-muted-foreground hover:text-foreground grid size-9 place-items-center rounded-lg" aria-label={`Quitar ${p.name}`}>
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!dish.from && (
              <label className="flex min-h-9 items-center gap-2 text-[13px]">
                <input type="checkbox" checked={dish.keep} onChange={(e) => setDish({ ...dish, keep: e.target.checked })} className="accent-primary size-4" />
                <BookmarkPlus className="text-muted-foreground size-4" />
                Guardar en Mis platillos
              </label>
            )}
            <p className="text-muted-foreground border-border border-t pt-3 text-[12px] font-semibold tracking-wide uppercase">{dish.from ? "Añadir algo esta vez" : "Añadir ingrediente"}</p>
          </div>
        )}
        {replacing && (
          <p className="bg-muted/60 text-muted-foreground -mt-1 rounded-xl px-3 py-2.5 text-[13px] leading-snug">
            En vez de <span className="text-foreground font-medium">{replacing.label}</span> ({replacing.title.toLowerCase()}, {fmt(replacing.kcal)} kcal). Lo que registres pasa a ser tu {replacing.title.toLowerCase()} de verdad.
          </p>
        )}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="dieta-name" className="text-[13px] font-medium">
              Qué
            </label>
            {!entry && (
              <button type="button" onClick={() => setScan(scan ? null : { code: "", status: "idle" })} className="text-muted-foreground hover:text-foreground flex min-h-8 items-center gap-1 rounded-md px-1.5 text-[12px]">
                <ScanBarcode className="size-3.5" />
                Código de barras
              </button>
            )}
          </div>
          {scan && (
            <div className="mb-2 flex gap-2">
              <input
                autoFocus
                inputMode="numeric"
                value={scan.code}
                onChange={(e) => setScan({ code: e.target.value, status: "idle" })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    lookup();
                  }
                }}
                placeholder="8 a 14 dígitos"
                className={cn(field, "flex-1")}
                aria-label="Código de barras"
              />
              <button type="button" onClick={lookup} disabled={scan.status === "looking" || scan.code.trim().length < 8} className={buttonSoft}>
                Buscar
              </button>
            </div>
          )}
          {scan?.status === "missing" && <p className="text-muted-foreground mb-2 text-[12px]">No está en Open Food Facts: escribe los datos de la etiqueta.</p>}
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <input
              id="dieta-name"
              data-autofocus={!entry || undefined}
              autoComplete="off"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSearching(true);
              }}
              onFocus={() => !entry && setSearching(true)}
              placeholder="Busca en tus frecuentes o escribe: «Yogur griego»"
              className={cn(field, "w-full pl-9")}
            />
          </div>
          {searching && dishMatches.length > 0 && (
            <ul className="border-border mt-2 divide-y overflow-hidden rounded-xl border" aria-label="Mis platillos">
              {dishMatches.map((d) => (
                <li key={d.id} className="hover:bg-muted/60 flex items-center">
                  <button type="button" onClick={() => openDish(d)} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-3 text-left">
                    <CookingPot className="text-energy size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{d.name}</span>
                    <span className="text-muted-foreground shrink-0 text-[12px] tabular">
                      {d.components.length} ingr. · {fmt(Math.round(d.macros.kcal))} kcal
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => quickDish(d)}
                    disabled={busy}
                    className="text-primary hover:bg-primary/10 mr-1 grid size-9 shrink-0 place-items-center rounded-lg"
                    aria-label={`Registrar ${d.name}`}
                    title="Registrar el platillo"
                  >
                    <Plus className="size-4" strokeWidth={2.4} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searching && matches.length > 0 && (
            <ul className="border-border mt-2 divide-y overflow-hidden rounded-xl border" aria-label="Frecuentes">
              {matches.map((f) => (
                <li key={f.name} className="hover:bg-muted/60 flex items-center">
                  <button type="button" onClick={() => pick(f)} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-3 text-left">
                    <span className="min-w-0 flex-1 truncate text-[14px]">{f.name}</span>
                    <span className="text-muted-foreground shrink-0 text-[12px] tabular">
                      {fmtAmount(f.measure, f.quantity, f.unit)} · {fmt(Math.round(f.kcal))} kcal
                    </span>
                  </button>
                  {!dish && !addingTo && (
                    <button
                      type="button"
                      onClick={() => quickAdd(f)}
                      disabled={pending}
                      className="text-primary hover:bg-primary/10 mr-1 grid size-9 shrink-0 place-items-center rounded-lg"
                      aria-label={`Registrar ${f.name} como la última vez`}
                      title="Registrar como la última vez"
                    >
                      <Plus className="size-4" strokeWidth={2.4} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <span className="mb-1.5 block text-[13px] font-medium">Cuánto</span>
          {barcode && scan?.status !== "missing" && (
            <div className="mb-2">
              <div className="flex gap-2">
                <input
                  value={said}
                  onChange={(e) => {
                    setSaid(e.target.value);
                    if (portion.error) setPortion({ ...portion, error: null });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      estimatePortion();
                    }
                  }}
                  autoComplete="off"
                  enterKeyHint="done"
                  placeholder="Cuánto comiste: «una cucharada», «la mitad»…"
                  className={cn(field, "flex-1")}
                  aria-label="Cuánto comiste, en palabras"
                  aria-invalid={portion.error ? true : undefined}
                />
                <button type="button" onClick={estimatePortion} disabled={portion.busy || !said.trim()} className={buttonSoft}>
                  {portion.busy ? "Calculando…" : "Calcular"}
                </button>
              </div>
              <div aria-live="polite">
                {portion.assumption && (
                  <p className="text-muted-foreground mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-snug tabular">
                    <Sparkles className="text-primary mt-px size-3.5 shrink-0" />
                    {portion.assumption}
                  </p>
                )}
                {portion.error && <p className="text-destructive mt-1.5 text-[12.5px]">{portion.error}</p>}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                clearAssumption();
              }}
              inputMode="decimal"
              className={cn(field, "w-24 flex-none tabular")}
              aria-label="Cantidad"
            />
            <select
              value={unit}
              onChange={(e) => {
                setUnit(e.target.value as MeasureUnit);
                setSize("");
                clearAssumption();
                if (perHundred(e.target.value as MeasureUnit) !== perHundred(unit)) setAmount(perHundred(e.target.value as MeasureUnit) ? "100" : "1");
              }}
              className={cn(field, "flex-1")}
              aria-label="Unidad"
            >
              {UNITS.map((u) => (
                <option key={u.unit} value={u.unit}>
                  {amountN === 1 ? u.one : u.many}
                </option>
              ))}
            </select>
            {sizeBase && (
              <label className="flex items-center gap-2 text-[13px]">
                <span className="text-muted-foreground shrink-0">de</span>
                <input value={size} onChange={(e) => setSize(e.target.value)} inputMode="decimal" placeholder={defaultSize ? String(defaultSize) : "—"} className={cn(field, "w-20 tabular")} aria-label={`Tamaño de una ${unitLabel(unit)}`} />
                <span className="text-muted-foreground shrink-0">{sizeBase}</span>
              </label>
            )}
          </div>
        </div>

        {!addingTo && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">Momento</span>
              <select value={slot} onChange={(e) => setSlot(e.target.value as MealSlot)} className={cn(field, "w-full")}>
                {SLOT_OPTIONS.map((o) => (
                  <option key={o.slot} value={o.slot}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">Hora</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={cn(field, "w-full tabular")} />
            </label>
          </div>
        )}

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium">
            {perLabel} <span className="text-muted-foreground font-normal">· sin kcal, se calculan de los macros</span>
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ["kcal", "kcal", "var(--domain-energy)"],
                ["protein", "Proteína g", "var(--domain-protein)"],
                ["carbs", "Carbos g", "var(--domain-carbs)"],
                ["fat", "Grasa g", "var(--domain-fat)"],
              ] as const
            ).map(([key, label, color]) => (
              <label key={key} className="block">
                <span className="text-muted-foreground mb-1 flex items-center gap-1.5 text-[12px]">
                  <span className="size-1.5 rounded-full" style={{ background: color }} />
                  {label}
                </span>
                <input value={per[key]} onChange={(e) => setPer({ ...per, [key]: e.target.value })} inputMode="decimal" placeholder="0" className={cn(field, "w-full tabular")} />
              </label>
            ))}
          </div>
          <details className="group mt-3">
            <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-[12px] select-none">Fibra, cafeína y alcohol</summary>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-[12px]">Fibra g</span>
                <input value={per.fiber} onChange={(e) => setPer({ ...per, fiber: e.target.value })} inputMode="decimal" placeholder="0" className={cn(field, "w-full tabular")} />
              </label>
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-[12px]">Cafeína mg</span>
                <input value={per.caffeine} onChange={(e) => setPer({ ...per, caffeine: e.target.value })} inputMode="decimal" placeholder="0" className={cn(field, "w-full tabular")} />
              </label>
              {ml !== null && (
                <label className="block">
                  <span className="text-muted-foreground mb-1 block text-[12px]">Alcohol % vol.</span>
                  <input value={per.abv} onChange={(e) => setPer({ ...per, abv: e.target.value })} inputMode="decimal" placeholder="0" className={cn(field, "w-full tabular")} />
                </label>
              )}
            </div>
          </details>
        </fieldset>
        {dish && (
          <button type="button" onClick={addPart} className={cn(buttonSoft, "w-full")}>
            <Plus className="size-4" />
            Añadir al platillo
          </button>
        )}

        {error && <p className="text-destructive text-[13px]">{error}</p>}
      </form>
    </Sheet>
  );
}
