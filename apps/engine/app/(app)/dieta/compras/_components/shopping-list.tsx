"use client";

import { SHOPPING_CATEGORIES, SHOPPING_CATEGORY_LABELS, type ShoppingCategory, type ShoppingItem, type ShoppingItemPatch, type ShoppingList as List } from "@pulso/contract";
import { Apple, Beef, Check, ClipboardCopy, Croissant, Egg, Home, Package, RefreshCw, ShoppingBasket, ShoppingCart, Snowflake, Sparkles, Wine, X, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Card, CardTitle } from "../../../../_ui/card";
import { cn } from "../../../../_ui/cn";
import { EmptyState } from "../../../../_ui/empty-state";
import { Ring } from "../../../../_ui/ring";
import { send } from "../../_components/client";
import { useToast } from "../../_components/toast";
import { buttonPrimary, buttonQuiet, buttonSoft, field } from "../../_components/sheet";

const BODY = "var(--domain-body)";
export const AISLES: Record<ShoppingCategory, { icon: LucideIcon; color: string }> = {
  frutas_verduras: { icon: Apple, color: "var(--domain-body)" },
  carnes_pescados: { icon: Beef, color: "var(--domain-protein)" },
  lacteos_huevos: { icon: Egg, color: "var(--domain-carbs)" },
  panaderia_cereales: { icon: Croissant, color: "var(--domain-energy)" },
  despensa: { icon: Package, color: "var(--domain-medication)" },
  bebidas: { icon: Wine, color: "var(--domain-fat)" },
  congelados: { icon: Snowflake, color: "var(--domain-sleep)" },
  otros: { icon: ShoppingBasket, color: "var(--muted-foreground)" },
};

// Dates are calendar days: format them in UTC so the browser's timezone can't shift them.
const day = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtDay = (date: string) => day.format(new Date(`${date}T00:00:00Z`));

/**
 * What is left to buy for the plan's horizon, by aisle. Clicking an item ticks it
 * (struck through, sinking to the bottom of its aisle); «Ya tengo» puts it aside,
 * with «Deshacer» in the toast; the person's own items can be added and removed. The plan keeps the list current
 * as it changes; «Actualizar» rebuilds it from today. Every write returns the whole list.
 */
export function ShoppingList({ initial, horizonDays }: { initial: List; horizonDays: number }) {
  const [list, setList] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const notify = useToast();
  const days = Math.min(horizonDays, 14);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);

  async function write(path: string, method: string, body?: unknown, optimistic?: (l: List) => List): Promise<boolean> {
    setError(null);
    const before = list;
    if (optimistic) setList(optimistic(list));
    const result = await send(`compras/${path}`, method, body);
    if (result.ok) setList(result.data as List);
    else {
      setList(before);
      setError(result.message);
    }
    return result.ok;
  }

  const patch = (item: ShoppingItem, change: ShoppingItemPatch) =>
    write(`items/${item.id}`, "PATCH", change, (l) => ({
      ...l,
      items: l.items.map((i) => (i.id === item.id ? { ...i, ...change, ...(change.checked ? { pantry: false } : {}), ...(change.pantry ? { checked: false } : {}) } : i)),
    }));

  /** Already at home this time: off what is left to buy, kept in «Ya tengo». */
  async function have(item: ShoppingItem) {
    if (!(await patch(item, { pantry: true }))) return;
    notify({ message: `${item.name}: ya lo tienes.`, undo: () => patch(item, { pantry: false }) });
  }

  async function generate() {
    setBusy(true);
    await write("generate", "POST", { days });
    setBusy(false);
  }

  async function add() {
    const name = draft.trim();
    if (!name) return;
    setDraft("");
    await write("items", "POST", { name });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(list.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("No se pudo copiar: el navegador no dio acceso al portapapeles.");
    }
  }

  const toBuy = list.items.filter((i) => !i.pantry);
  const atHome = list.items.filter((i) => i.pantry);
  const aisles = SHOPPING_CATEGORIES.map((c) => ({
    category: c,
    // Bought items sink to the bottom of their aisle.
    items: toBuy.filter((i) => i.category === c).sort((a, b) => Number(a.checked) - Number(b.checked)),
  })).filter((a) => a.items.length > 0);
  const pending = list.total - list.done;
  const generated = list.items.some((i) => i.source === "plan");

  const rangeControl = (
    <button onClick={generate} disabled={busy} className={generated ? buttonSoft : buttonPrimary} title={`Lo que pide el plan para los próximos ${days} días`}>
      <RefreshCw className={cn("size-4", busy && "motion-safe:animate-spin")} />
      {generated ? "Actualizar" : `Generar para ${days} días`}
    </button>
  );

  const addRow = (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Añadir algo: «Papel de cocina»" className={cn(field, "flex-1")} aria-label="Añadir a la lista" />
      <button type="submit" disabled={!draft.trim()} className={buttonSoft}>
        Añadir
      </button>
    </form>
  );

  if (list.items.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={ShoppingCart}
          color={BODY}
          title="Genera tu lista desde tu plan"
          line={list.hasPlan ? `Sumamos los ingredientes de los próximos ${days} días del plan y los ordenamos por pasillo.` : "Aún no tienes un plan de dieta activo. Pídeselo al Coach y la lista sale de ahí."}
          action={list.hasPlan ? undefined : { href: "/coach", label: "Pedir un plan al Coach" }}
        />
        <div className="mx-auto flex max-w-md flex-col items-center gap-4">
          {list.hasPlan && rangeControl}
          <div className="w-full">{addRow}</div>
          {error && <p className="text-destructive text-[13px]">{error}</p>}
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 -left-16 size-72 rounded-full opacity-[0.08] blur-3xl" style={{ background: BODY }} aria-hidden />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center">
          <Ring value={list.total ? (list.done / list.total) * 100 : 0} size={132} stroke={12} color={BODY} glow label={`${list.done} de ${list.total} comprados`}>
            {pending === 0 && list.total > 0 ? (
              <Check className="text-body size-10" strokeWidth={2.6} />
            ) : (
              <ShoppingBasket className="text-body size-9" strokeWidth={2} />
            )}
          </Ring>
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline gap-2">
              <span className="tabular text-[40px] leading-none font-semibold tracking-tight">{list.done}</span>
              <span className="text-muted-foreground text-[15px]">de {list.total} comprados</span>
            </p>
            <p className="text-muted-foreground mt-2 text-[13px]">
              {pending === 0 ? "Todo comprado. " : ""}
              {list.from && list.to ? `Lo que falta del ${fmtDay(list.from)} al ${fmtDay(list.to)}` : "Sólo lo que añadiste a mano"}
              {list.planName && ` · ${list.planName}`}
            </p>
            {list.stale && list.hasPlan && (
              <p className="text-training mt-2 flex items-center gap-1.5 text-[13px] font-medium">
                <Sparkles className="size-3.5" />
                Tu plan cambió: actualiza la lista; lo marcado y lo tuyo se queda.
              </p>
            )}
          </div>
          <div className="flex flex-col items-start gap-3 md:items-end">
            {list.hasPlan && rangeControl}
            <button onClick={copy} disabled={pending === 0} className={buttonQuiet}>
              <ClipboardCopy className="size-4" />
              {copied ? "Copiada" : "Copiar como texto"}
            </button>
          </div>
        </div>
        <div className="border-border relative mt-5 border-t pt-4">{addRow}</div>
        {error && <p className="text-destructive mt-3 text-[13px]">{error}</p>}
      </Card>

      {aisles.length === 0 && (
        <Card className="mt-5">
          <EmptyState compact icon={Check} color={BODY} title="Nada más que comprar" line="Ya tienes todo lo que pide el plan. Si el plan cambia, la lista se pone al día sola." />
        </Card>
      )}
      <div className="mt-5 grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
        {aisles.map(({ category, items }, n) => {
          const aisle = AISLES[category];
          return (
            <Card key={category} delay={40 + n * 40}>
              <CardTitle icon={aisle.icon} color={aisle.color} title={SHOPPING_CATEGORY_LABELS[category]} />
              <ul className="-mx-2 -my-1">
                {items.map((item) => (
                  <li key={item.id} className="group hover:bg-muted/50 relative flex min-h-11 items-center gap-1 rounded-xl px-2">
                    <button onClick={() => patch(item, { checked: !item.checked })} aria-pressed={item.checked} className="focus-visible:ring-ring flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2">
                      <span className={cn("grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors", item.checked ? "border-body bg-body text-background" : "border-border")}>
                        {item.checked && <Check className="size-3.5" strokeWidth={3} />}
                      </span>
                      <span className={cn("min-w-0 flex-1 truncate text-[14px] transition-colors", item.checked && "text-muted-foreground line-through")}>
                        {item.name}
                        {item.note && <span className="text-muted-foreground"> · {item.note}</span>}
                      </span>
                      {item.amount && <span className={cn("text-muted-foreground shrink-0 text-[13px] tabular", item.checked && "line-through")}>{item.amount}</span>}
                    </button>
                    {/* On the desktop the actions float over the amount while hovered, so the amounts line up. */}
                    <span className="flex shrink-0 rounded-lg transition-opacity md:absolute md:inset-y-1 md:right-1 md:items-center md:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))] md:pl-10 md:opacity-0 md:group-has-[:focus-visible]:opacity-100 md:group-hover:opacity-100">
                      <button onClick={() => have(item)} className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-9 place-items-center rounded-lg" aria-label={`Ya tengo ${item.name}`} title="Ya tengo">
                        <Home className="size-3.5" />
                      </button>
                      {item.source === "manual" && (
                        <button onClick={() => write(`items/${item.id}`, "DELETE", undefined, (l) => ({ ...l, items: l.items.filter((i) => i.id !== item.id) }))} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 grid size-9 place-items-center rounded-lg" aria-label={`Quitar ${item.name}`} title="Quitar">
                          <X className="size-3.5" />
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
        {atHome.length > 0 && (
          <Card delay={40 + aisles.length * 40}>
            <CardTitle icon={Home} color="var(--muted-foreground)" title="Ya tengo" />
            <ul className="-mx-2 -my-1">
              {atHome.map((item) => (
                <li key={item.id} className="flex min-h-11 items-center gap-3 px-2">
                  <span className="text-muted-foreground min-w-0 flex-1 truncate text-[14px]">{item.name}</span>
                  <button onClick={() => patch(item, { pantry: false })} className="text-primary hover:bg-primary/10 min-h-9 rounded-lg px-2.5 text-[13px] font-medium">
                    Lo necesito
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
