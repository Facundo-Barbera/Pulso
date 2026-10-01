"use client";

import type { Medication, MedicationInput, MedicationKind } from "@pulso/contract";
import { Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState } from "react";
import { cn } from "../../../_ui/cn";
import { Button, Field, FieldGroup, inputClass, Segmented, Toggle, WeekdayPicker } from "../../../_ui/fields";
import { send } from "../../../_ui/send";
import { Sheet } from "../../../_ui/sheet";

const MED = "var(--domain-medication)";

type Editing = { medication: Medication | null } | null;
const EditorContext = createContext<(medication: Medication | null) => void>(() => {});

/** Holds the one medication editor of the page; anything inside can open it. */
export function MedicationEditorProvider({ today, children }: { today: string; children: React.ReactNode }) {
  const [editing, setEditing] = useState<Editing>(null);
  const close = () => setEditing(null);
  return (
    <EditorContext.Provider value={(medication) => setEditing({ medication })}>
      {children}
      <Sheet open={editing !== null} onClose={close} title={editing?.medication ? editing.medication.name : "Nueva medicación"}>
        {editing && <MedicationForm medication={editing.medication} today={today} onDone={close} />}
      </Sheet>
    </EditorContext.Provider>
  );
}

export function AddMedicationButton({ label = "Añadir", prominent = false }: { label?: string; prominent?: boolean }) {
  const open = useContext(EditorContext);
  return (
    <Button variant={prominent ? "primary" : "secondary"} onClick={() => open(null)} className={cn("app-no-drag", !prominent && "bg-card shadow-1")}>
      <Plus className="size-4" />
      {label}
    </Button>
  );
}

/** A row that opens its medication's editor. */
export function EditMedicationRow({ medication, children, className }: { medication: Medication; children: React.ReactNode; className?: string }) {
  const open = useContext(EditorContext);
  return (
    <button type="button" onClick={() => open(medication)} className={cn("focus-visible:ring-ring hover:bg-muted/60 w-full rounded-xl text-left outline-none focus-visible:ring-2", className)} aria-label={`Editar ${medication.name}`}>
      {children}
    </button>
  );
}

type Draft = {
  name: string;
  kind: MedicationKind;
  dose: string;
  unit: string;
  form: string;
  instructions: string;
  asNeeded: boolean;
  times: string[];
  days: number[];
  startDate: string;
  endDate: string;
  stock: string;
  lowStockThreshold: string;
  active: boolean;
  notes: string;
};

const draftOf = (m: Medication | null, today: string): Draft => ({
  name: m?.name ?? "",
  kind: m?.kind ?? "medicamento",
  dose: m ? String(m.dose) : "",
  unit: m?.unit ?? "mg",
  form: m?.form ?? "",
  instructions: m?.instructions ?? "",
  asNeeded: m?.schedule.asNeeded ?? false,
  times: m?.schedule.times.length ? m.schedule.times : ["09:00"],
  days: m?.schedule.days ?? [],
  startDate: m?.startDate ?? today,
  endDate: m?.endDate ?? "",
  stock: m?.stock != null ? String(m.stock) : "",
  lowStockThreshold: m?.lowStockThreshold != null ? String(m.lowStockThreshold) : "",
  active: m?.active ?? true,
  notes: m?.notes ?? "",
});

const optionalNumber = (text: string) => (text.trim() === "" ? null : Number(text.replace(",", ".")));

/** What is wrong with the draft, in Spanish, or null. */
function problem(d: Draft): string | null {
  const dose = Number(d.dose.replace(",", "."));
  if (!d.name.trim()) return "Ponle un nombre.";
  if (!(dose > 0)) return "La dosis tiene que ser un número mayor que cero.";
  if (!d.unit.trim()) return "Falta la unidad (mg, comprimidos…).";
  if (!d.asNeeded && d.times.filter(Boolean).length === 0) return "Añade al menos una hora, o elige «Cuando haga falta».";
  if (d.endDate && d.endDate < d.startDate) return "La fecha de fin es anterior a la de inicio.";
  for (const n of [d.stock, d.lowStockThreshold]) if (n.trim() && !(Number(n.replace(",", ".")) >= 0)) return "Las existencias tienen que ser un número.";
  return null;
}

function bodyOf(d: Draft): MedicationInput {
  return {
    name: d.name.trim(),
    kind: d.kind,
    dose: Number(d.dose.replace(",", ".")),
    unit: d.unit.trim(),
    form: d.form.trim() || null,
    instructions: d.instructions.trim() || null,
    schedule: d.asNeeded ? { asNeeded: true, times: [], days: [] } : { asNeeded: false, times: d.times.filter(Boolean), days: d.days },
    startDate: d.startDate,
    endDate: d.endDate || null,
    stock: optionalNumber(d.stock),
    lowStockThreshold: optionalNumber(d.lowStockThreshold),
    active: d.active,
    notes: d.notes.trim() || null,
  };
}

function MedicationForm({ medication, today, onDone }: { medication: Medication | null; today: string; onDone: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState(() => draftOf(medication, today));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      router.refresh();
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function save() {
    const issue = problem(draft);
    if (issue) return setError(issue);
    void run(() => (medication ? send(`/api/web/medicacion/${medication.id}`, "PATCH", bodyOf(draft)) : send("/api/web/medicacion", "POST", bodyOf(draft))));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-5"
    >
      <Field label="Nombre">
        <input className={inputClass} value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="Vitamina D, Ibuprofeno…" autoFocus={!medication} maxLength={80} />
      </Field>
      <Segmented<MedicationKind> label="Tipo" value={draft.kind} onChange={(v) => set("kind", v)} options={[{ value: "medicamento", label: "Medicamento" }, { value: "suplemento", label: "Suplemento" }]} className="w-full" />

      <div className="grid grid-cols-[1fr_1fr] gap-3">
        <Field label="Dosis por toma">
          <input className={cn(inputClass, "tabular")} inputMode="decimal" value={draft.dose} onChange={(e) => set("dose", e.target.value)} placeholder="500" />
        </Field>
        <Field label="Unidad">
          <input className={inputClass} list="med-units" value={draft.unit} onChange={(e) => set("unit", e.target.value)} maxLength={24} />
        </Field>
      </div>
      <datalist id="med-units">
        {["mg", "g", "µg", "UI", "ml", "gotas", "comprimidos", "cápsulas", "sobres"].map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      <FieldGroup label="Horario" hint={draft.asNeeded ? "No cuenta para la adherencia: anótala cuando la tomes." : draft.days.length === 0 ? "Sin días marcados: todos los días." : undefined}>
        <Segmented<"fixed" | "asNeeded"> label="Horario" value={draft.asNeeded ? "asNeeded" : "fixed"} onChange={(v) => set("asNeeded", v === "asNeeded")} options={[{ value: "fixed", label: "Horario fijo" }, { value: "asNeeded", label: "Cuando haga falta" }]} className="w-full" />
        {!draft.asNeeded && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              {draft.times.map((time, i) => (
                <span key={i} className="bg-muted/60 border-border flex items-center rounded-xl border pl-1">
                  <input type="time" className="tabular h-10 bg-transparent px-2 text-[15px] outline-none" value={time} onChange={(e) => set("times", draft.times.map((t, j) => (j === i ? e.target.value : t)))} aria-label={`Hora ${i + 1}`} />
                  {draft.times.length > 1 && (
                    <button type="button" onClick={() => set("times", draft.times.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-foreground grid size-9 place-items-center" aria-label="Quitar esta hora">
                      <X className="size-3.5" />
                    </button>
                  )}
                </span>
              ))}
              {draft.times.length < 8 && (
                <Button variant="ghost" onClick={() => set("times", [...draft.times, "21:00"])} className="min-h-10 rounded-xl">
                  <Plus className="size-4" /> Hora
                </Button>
              )}
            </div>
            <WeekdayPicker value={draft.days} onChange={(days) => set("days", days)} color={MED} />
          </div>
        )}
      </FieldGroup>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Forma">
          <input className={inputClass} list="med-forms" value={draft.form} onChange={(e) => set("form", e.target.value)} placeholder="Opcional" maxLength={40} />
        </Field>
        <Field label="Cómo tomarlo">
          <input className={inputClass} list="med-instructions" value={draft.instructions} onChange={(e) => set("instructions", e.target.value)} placeholder="Opcional" maxLength={200} />
        </Field>
      </div>
      <datalist id="med-forms">
        {["comprimido", "cápsula", "gotas", "polvo", "jarabe", "sobre", "inyección", "spray", "crema"].map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <datalist id="med-instructions">
        {["con comida", "en ayunas", "antes de dormir", "con agua abundante"].map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Desde">
          <input type="date" className={inputClass} value={draft.startDate} onChange={(e) => set("startDate", e.target.value || today)} />
        </Field>
        <Field label="Hasta">
          <input type="date" className={inputClass} value={draft.endDate} onChange={(e) => set("endDate", e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Quedan (dosis)" hint="Cada toma marcada descuenta una.">
          <input className={cn(inputClass, "tabular")} inputMode="numeric" value={draft.stock} onChange={(e) => set("stock", e.target.value)} placeholder="Sin contar" />
        </Field>
        <Field label="Avisar cuando queden">
          <input className={cn(inputClass, "tabular")} inputMode="numeric" value={draft.lowStockThreshold} onChange={(e) => set("lowStockThreshold", e.target.value)} placeholder="—" disabled={draft.stock.trim() === ""} />
        </Field>
      </div>

      <Field label="Notas">
        <textarea className={cn(inputClass, "h-auto min-h-20 py-2.5")} value={draft.notes} onChange={(e) => set("notes", e.target.value)} maxLength={500} placeholder="Opcional" />
      </Field>

      {medication && <Toggle checked={draft.active} onChange={(on) => set("active", on)} label="Activo" hint={draft.active ? "Aparece en Hoy y cuenta para la adherencia." : "En pausa: no se recuerda ni cuenta, y su historial se guarda."} />}

      {error && <p className="text-destructive text-[13px]">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {medication &&
          (confirmDelete ? (
            <span className="flex flex-wrap items-center gap-2">
              <Button variant="danger" onClick={() => run(() => send(`/api/web/medicacion/${medication.id}`, "DELETE"))} disabled={busy} className="bg-destructive/10">
                Borrar con su historial
              </Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                No
              </Button>
            </span>
          ) : (
            <Button variant="danger" onClick={() => setConfirmDelete(true)} aria-label="Eliminar">
              <Trash2 className="size-4" /> Eliminar
            </Button>
          ))}
        <span className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Guardando…" : "Guardar"}
          </Button>
        </span>
      </div>
      {confirmDelete && <p className="text-muted-foreground text-[12px] leading-relaxed">Para dejarlo sin perder el historial, ponle fecha de fin o pásalo a pausa.</p>}
    </form>
  );
}
