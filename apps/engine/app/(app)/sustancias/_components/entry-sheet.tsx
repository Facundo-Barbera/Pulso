"use client";

import type { Substance, SubstanceAmount, SubstanceContext, SubstanceEntry, SubstanceEntryInput } from "@pulso/contract";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "../../../_ui/cn";
import { Button, Field, FieldGroup, inputClass, Segmented } from "../../../_ui/fields";
import { send } from "../../../_ui/send";
import { Sheet } from "../../../_ui/sheet";
import { AMOUNT_LABEL, capitalize, COLOR, CONTEXT_LABEL, emojiOf, options } from "./labels";

type Draft = { substanceId: string; date: string; time: string; form: string | null; amount: SubstanceAmount; quantity: string; thcMg: string; context: SubstanceContext | null; note: string };

const pad = (n: number) => String(n).padStart(2, "0");
const nowDraft = (substance: Substance): Draft => {
  const d = new Date();
  return { substanceId: substance.id, date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, form: substance.forms[0] ?? null, amount: "normal", quantity: "", thcMg: "", context: null, note: "" };
};
export const draftOf = (e: SubstanceEntry): Draft => ({ substanceId: e.substanceId, date: e.date, time: e.time, form: e.form, amount: e.amount, quantity: e.quantity?.toString() ?? "", thcMg: e.thcMg?.toString() ?? "", context: e.context, note: e.note ?? "" });

const edible = (d: Draft) => d.substanceId === "cannabis" && d.form === "comestible";

function toInput(d: Draft): SubstanceEntryInput {
  return {
    substanceId: d.substanceId,
    date: d.date,
    time: d.time,
    form: d.form,
    amount: d.amount,
    quantity: d.quantity ? Number(d.quantity) : null,
    thcMg: edible(d) && d.thcMg ? Number(d.thcMg) : null,
    context: d.context,
    note: d.note.trim() || null,
  };
}

/** The header's «Registrar»: a quick sheet with sensible defaults (now, the substance in view or the first, its first form, normal). */
export function LogButton({ substances, current }: { substances: Substance[]; current: string | null }) {
  const [open, setOpen] = useState(false);
  const start = substances.find((s) => s.id === current) ?? substances[0];
  if (!start) return null;
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Registrar
      </Button>
      <EntrySheet open={open} onClose={() => setOpen(false)} initial={nowDraft(start)} substances={substances} />
    </>
  );
}

/** Logs a new use or edits one (`id`), with delete. `substances` are the active ones (plus the entry's own, if archived). */
export function EntrySheet({ open, onClose, initial, id, substances }: { open: boolean; onClose: () => void; initial: Draft; id?: string; substances: Substance[] }) {
  return (
    <Sheet open={open} onClose={onClose} title={id ? "Editar registro" : "Registrar consumo"}>
      <Editor initial={initial} id={id} onDone={onClose} substances={substances} />
    </Sheet>
  );
}

function Chips<T extends string>({ value, options, onChange }: { value: T | null; options: { value: T; label: string }[]; onChange: (value: T | null) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? null : o.value)}
            className={cn("focus-visible:ring-ring min-h-9 rounded-full px-3.5 text-[13px] font-medium outline-none focus-visible:ring-2 motion-safe:transition-colors", on ? "text-white" : "bg-muted text-muted-foreground hover:text-foreground")}
            style={on ? { background: COLOR } : undefined}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Editor({ initial, id, onDone, substances }: { initial: Draft; id?: string; onDone: () => void; substances: Substance[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const substance = substances.find((s) => s.id === draft.substanceId);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      router.refresh();
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => (id ? send(`/api/web/sustancias/${id}`, "PATCH", toInput(draft)) : send("/api/web/sustancias", "POST", toInput(draft))));
      }}
    >
      <FieldGroup label="Sustancia">
        <Chips
          value={draft.substanceId}
          options={substances.map((s) => ({ value: s.id, label: [emojiOf(s), s.name].filter(Boolean).join(" ") }))}
          onChange={(next) => {
            const picked = substances.find((s) => s.id === next);
            if (picked) set({ substanceId: picked.id, form: picked.forms[0] ?? null });
          }}
        />
      </FieldGroup>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Día">
          <input type="date" required value={draft.date} onChange={(e) => set({ date: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Hora">
          <input type="time" required value={draft.time} onChange={(e) => set({ time: e.target.value })} className={inputClass} />
        </Field>
      </div>
      {substance && substance.forms.length > 0 && (
        <FieldGroup label="Forma">
          <Chips value={draft.form} options={substance.forms.map((f) => ({ value: f, label: capitalize(f) }))} onChange={(form) => set({ form })} />
        </FieldGroup>
      )}
      <FieldGroup label="Cantidad">
        <Segmented label="Cantidad" value={draft.amount} options={options(AMOUNT_LABEL)} onChange={(amount) => set({ amount })} className="w-full" />
      </FieldGroup>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`${capitalize(substance?.unit ?? "veces")} (opcional)`}>
          <input type="number" inputMode="decimal" min={0} step="any" value={draft.quantity} onChange={(e) => set({ quantity: e.target.value })} className={inputClass} />
        </Field>
        {edible(draft) && (
          <Field label="mg de THC (opcional)">
            <input type="number" inputMode="decimal" min={0} step="0.5" value={draft.thcMg} onChange={(e) => set({ thcMg: e.target.value })} className={inputClass} />
          </Field>
        )}
      </div>
      <FieldGroup label="Contexto (opcional)">
        <Chips value={draft.context} options={options(CONTEXT_LABEL)} onChange={(context) => set({ context })} />
      </FieldGroup>
      <Field label="Nota (opcional)">
        <textarea value={draft.note} maxLength={500} rows={2} onChange={(e) => set({ note: e.target.value })} className={cn(inputClass, "h-auto py-2.5")} />
      </Field>
      {error && <p className="text-destructive text-[13px]">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        {id && (
          <Button variant="danger" disabled={busy} onClick={() => run(() => send(`/api/web/sustancias/${id}`, "DELETE"))}>
            <Trash2 className="size-4" /> Borrar
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={busy} className="ml-auto">
          {busy ? "Guardando…" : id ? "Guardar" : "Registrar"}
        </Button>
      </div>
    </form>
  );
}
