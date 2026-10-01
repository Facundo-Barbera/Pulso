"use client";

import { SHOPPING_CATEGORIES, SHOPPING_CATEGORY_LABELS, type PantryItem, type ShoppingList } from "@pulso/contract";
import { Home, X } from "lucide-react";
import { useState } from "react";
import { Card, CardTitle } from "../../../../_ui/card";
import { cn } from "../../../../_ui/cn";
import { EmptyState } from "../../../../_ui/empty-state";
import { send } from "../../_components/client";
import { buttonSoft, field } from "../../_components/sheet";
import { useToast } from "../../_components/toast";
import { AISLES } from "./shopping-list";

const UNIT_LABELS: Record<string, string> = { g: "g", ml: "ml", ud: "ud." };
const number = new Intl.NumberFormat("es", { maximumFractionDigits: 1 });
/** "1.000" or "1000" → 1000, "0,5" → 0.5 (Spanish: dot groups thousands, comma is the decimal). */
const parse = (text: string) => {
  const n = Number(text.trim().replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return text.trim() && Number.isFinite(n) && n >= 0 ? n : null;
};
// Calendar days: UTC so the browser's timezone can't shift them.
const dayMonth = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "UTC" });

/** An amount the person can correct in place: Enter or leaving the field saves, Escape puts it back. */
function AmountField({ item, onSave }: { item: PantryItem; onSave: (quantity: number) => Promise<boolean> }) {
  const shown = item.quantity === null ? "" : number.format(item.quantity);
  const [text, setText] = useState(shown);
  const save = async () => {
    const n = parse(text);
    if (n === null || n === item.quantity) return setText(shown);
    if (!(await onSave(n))) setText(shown);
  };
  return (
    <label className="flex shrink-0 items-center gap-1.5">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText(shown);
            e.currentTarget.blur();
          }
        }}
        inputMode="decimal"
        placeholder="algo"
        className={cn(field, "h-9 w-20 text-right tabular md:h-9")}
        aria-label={`Cantidad de ${item.name}`}
      />
      <span className="text-muted-foreground w-7 text-[12px]">{item.unit ? (UNIT_LABELS[item.unit] ?? item.unit) : ""}</span>
    </label>
  );
}

/**
 * The Despensa: what is at home, by aisle. Ticks on the list land here; amounts
 * can be corrected (0 = se acabó), rows removed or added by hand. Every change
 * brings the list up to date, since it is what the plan needs minus this.
 */
export function Pantry({ initial, list }: { initial: PantryItem[]; list: ShoppingList }) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", quantity: "", unit: "g" });
  const notify = useToast();

  async function write(path: string, method: string, body?: unknown): Promise<boolean> {
    setError(null);
    const result = await send(path, method, body);
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    setItems((result.data as { items: PantryItem[] }).items);
    // Keep the list's "what's left to buy" in step with the pantry.
    if (list.from && list.days) await send("compras/generate", "POST", { from: list.from, days: list.days });
    return true;
  }

  async function remove(item: PantryItem) {
    if (!(await write(`pantry/${item.id}`, "DELETE"))) return;
    notify({
      message: `${item.name} salió de la despensa.`,
      undo: () => write("pantry", "POST", { items: [{ name: item.name, quantity: item.quantity, unit: item.unit, expiresOn: item.expiresOn }] }),
    });
  }

  async function add() {
    const name = draft.name.trim();
    if (!name) return;
    const quantity = parse(draft.quantity);
    if (await write("pantry", "POST", { items: [{ name, ...(quantity ? { quantity, unit: draft.unit } : {}) }] })) setDraft({ name: "", quantity: "", unit: draft.unit });
  }

  const aisles = SHOPPING_CATEGORIES.map((c) => ({ category: c, items: items.filter((i) => i.category === c) })).filter((a) => a.items.length > 0);

  const addRow = (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Añadir lo que tienes: «Arroz»" className={cn(field, "min-w-48 flex-1")} aria-label="Qué tienes" />
      <input value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} inputMode="decimal" placeholder="Cantidad" className={cn(field, "w-24 tabular")} aria-label="Cantidad" />
      <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} className={cn(field, "w-20")} aria-label="Unidad">
        <option value="g">g</option>
        <option value="ml">ml</option>
        <option value="ud">ud.</option>
      </select>
      <button type="submit" disabled={!draft.name.trim()} className={buttonSoft}>
        Añadir
      </button>
    </form>
  );

  return (
    <>
      <Card>
        {items.length === 0 ? (
          <EmptyState compact icon={Home} color="var(--domain-body)" title="La despensa está vacía" line="Lo que marques como comprado o «Ya tengo» en la lista aparece aquí, y el plan lo va gastando." />
        ) : (
          <p className="text-muted-foreground mb-4 text-[13px]">
            <span className="text-foreground tabular text-[15px] font-semibold">{items.length}</span> {items.length === 1 ? "cosa" : "cosas"} en casa. Es una estimación: cocinar y comer lo del plan la va gastando. Corrige una cantidad si no cuadra; 0 es que se acabó.
          </p>
        )}
        {addRow}
        {error && <p className="text-destructive mt-3 text-[13px]">{error}</p>}
      </Card>

      <div className="mt-5 grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
        {aisles.map(({ category, items }, n) => {
          const aisle = AISLES[category];
          return (
            <Card key={category} delay={40 + n * 40}>
              <CardTitle icon={aisle.icon} color={aisle.color} title={SHOPPING_CATEGORY_LABELS[category]} />
              <ul className="-mx-2 -my-1">
                {items.map((item) => (
                  <li key={`${item.id}-${item.updatedAt}`} className="group hover:bg-muted/50 flex min-h-12 items-center gap-2 rounded-xl px-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">{item.name}</span>
                      <span className="text-muted-foreground block truncate text-[12px]">
                        {item.source === "list" ? "De la lista" : "Añadido a mano"}
                        {item.boughtOn && ` · ${dayMonth.format(new Date(`${item.boughtOn}T00:00:00Z`))}`}
                      </span>
                    </span>
                    <AmountField item={item} onSave={(quantity) => write(`pantry/${item.id}`, "PATCH", { quantity })} />
                    <button onClick={() => remove(item)} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 grid size-9 shrink-0 place-items-center rounded-lg transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100" aria-label={`Quitar ${item.name}`} title="Quitar">
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </>
  );
}
