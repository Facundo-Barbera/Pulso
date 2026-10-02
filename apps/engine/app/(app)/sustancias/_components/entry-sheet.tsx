"use client";

import type { Substance, SubstanceAmount, SubstanceContext, SubstanceEntry, SubstanceEntryInput, SubstanceForm } from "@pulso/contract";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "../../../_ui/cn";
import { Button, Field, FieldGroup, inputClass, Segmented } from "../../../_ui/fields";
import { send } from "../../../_ui/send";
import { Sheet } from "../../../_ui/sheet";
import { AMOUNT_LABEL, COLOR, CONTEXT_LABEL, FORM_LABEL, options, SUBSTANCE_LABEL } from "./labels";

type Draft = { substance: Substance; date: string; time: string; form: SubstanceForm; amount: SubstanceAmount; count: string; thcMg: string; context: SubstanceContext | null; note: string };

const pad = (n: number) => String(n).padStart(2, "0");
const nowDraft = (substance: Substance): Draft => {
  const d = new Date();
  return { substance, date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, form: "fumado", amount: "normal", count: "", thcMg: "", context: null, note: "" };
};
const fromEntry = (e: SubstanceEntry): Draft => ({ substance: e.substance, date: e.date, time: e.time, form: e.form ?? "fumado", amount: e.amount, count: e.count?.toString() ?? "", thcMg: e.thcMg?.toString() ?? "", context: e.context, note: e.note ?? "" });

function toInput(d: Draft): SubstanceEntryInput {
  const cannabis = d.substance === "cannabis";
  return {
    substance: d.substance,
    date: d.date,
    time: d.time,
    form: cannabis ? d.form : null,
    amount: d.amount,
    count: d.count ? Number(d.count) : null,
    thcMg: cannabis && d.form === "comestible" && d.thcMg ? Number(d.thcMg) : null,
    context: d.context,
    note: d.note.trim() || null,
  };
}

/** The header's «Registrar»: a quick sheet with sensible defaults (now, fumado, normal). */
export function LogButton({ substance }: { substance: Substance }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Registrar
      </Button>
      <EntrySheet open={open} onClose={() => setOpen(false)} initial={nowDraft(substance)} />
    </>
  );
}

/** Logs a new use or edits one (`id`), with delete. */
export function EntrySheet({ open, onClose, initial, id }: { open: boolean; onClose: () => void; initial: Draft; id?: string }) {
  return (
    <Sheet open={open} onClose={onClose} title={id ? "Editar registro" : "Registrar consumo"}>
      <Editor initial={initial} id={id} onDone={onClose} />
    </Sheet>
  );
}

export const draftOf = fromEntry;

function Editor({ initial, id, onDone }: { initial: Draft; id?: string; onDone: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

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
        <Segmented label="Sustancia" value={draft.substance} options={options(SUBSTANCE_LABEL)} onChange={(substance) => set({ substance })} className="w-full" />
      </FieldGroup>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Día">
          <input type="date" required value={draft.date} onChange={(e) => set({ date: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Hora">
          <input type="time" required value={draft.time} onChange={(e) => set({ time: e.target.value })} className={inputClass} />
        </Field>
      </div>
      {draft.substance === "cannabis" && (
        <FieldGroup label="Forma">
          <Segmented label="Forma" value={draft.form} options={options(FORM_LABEL)} onChange={(form) => set({ form })} className="w-full" />
        </FieldGroup>
      )}
      <FieldGroup label="Cantidad">
        <Segmented label="Cantidad" value={draft.amount} options={options(AMOUNT_LABEL)} onChange={(amount) => set({ amount })} className="w-full" />
      </FieldGroup>
      <div className="grid grid-cols-2 gap-3">
        <Field label={draft.substance === "alcohol" ? "Bebidas (opcional)" : "Sesiones o caladas (opcional)"}>
          <input type="number" inputMode="numeric" min={1} max={100} value={draft.count} onChange={(e) => set({ count: e.target.value })} className={inputClass} />
        </Field>
        {draft.substance === "cannabis" && draft.form === "comestible" && (
          <Field label="mg de THC (opcional)">
            <input type="number" inputMode="decimal" min={0} step="0.5" value={draft.thcMg} onChange={(e) => set({ thcMg: e.target.value })} className={inputClass} />
          </Field>
        )}
      </div>
      <FieldGroup label="Contexto (opcional)">
        <div className="flex flex-wrap gap-2">
          {options(CONTEXT_LABEL).map((o) => {
            const on = draft.context === o.value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => set({ context: on ? null : o.value })}
                className={cn("focus-visible:ring-ring min-h-9 rounded-full px-3.5 text-[13px] font-medium outline-none focus-visible:ring-2 motion-safe:transition-colors", on ? "text-white" : "bg-muted text-muted-foreground hover:text-foreground")}
                style={on ? { background: COLOR } : undefined}
              >
                {o.label}
              </button>
            );
          })}
        </div>
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
