"use client";

import type { DoseMeal, Medication, MedicationInput, MedicationKind, MedicationSchedule } from "@pulso/contract";
import { BedDouble, Clock, Dumbbell, Plus, Trash2, Utensils, X, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState } from "react";
import { cn } from "../../../_ui/cn";
import { Button, Field, FieldGroup, inputClass, Segmented, Toggle, WeekdayPicker } from "../../../_ui/fields";
import { send } from "../../../_ui/send";
import { Sheet } from "../../../_ui/sheet";

const MED = "var(--domain-medication)";

/** What a suggestion fills in before the editor opens; nothing is saved until «Guardar». */
export type Prefill = Pick<Medication, "schedule"> & { instructions: string | null };
type Editing = { medication: Medication | null; kind: MedicationKind; prefill?: Prefill } | null;
type Open = (medication: Medication | null, kind?: MedicationKind, prefill?: Prefill) => void;
const EditorContext = createContext<Open>(() => {});

/** Opens the page's editor: a medication (or null for a new one), optionally prefilled. */
export const useMedicationEditor = () => useContext(EditorContext);

const NEW_TITLE: Record<MedicationKind, string> = { medicamento: "Nuevo medicamento", suplemento: "Nuevo suplemento" };

/** Holds the one medication editor of the page; anything inside can open it. */
export function MedicationEditorProvider({ today, children }: { today: string; children: React.ReactNode }) {
  const [editing, setEditing] = useState<Editing>(null);
  const close = () => setEditing(null);
  return (
    <EditorContext.Provider value={(medication, kind = "medicamento", prefill) => setEditing({ medication, kind: medication?.kind ?? kind, prefill })}>
      {children}
      <Sheet open={editing !== null} onClose={close} title={editing?.medication ? editing.medication.name : NEW_TITLE[editing?.kind ?? "medicamento"]}>
        {editing && <MedicationForm medication={editing.medication} prefill={editing.prefill} kind={editing.kind} today={today} onKind={(kind) => setEditing((e) => e && { ...e, kind })} onDone={close} />}
      </Sheet>
    </EditorContext.Provider>
  );
}

export function AddMedicationButton({ label = "Añadir", kind, prominent = false }: { label?: string; kind?: MedicationKind; prominent?: boolean }) {
  const open = useContext(EditorContext);
  return (
    <Button variant={prominent ? "primary" : "secondary"} onClick={() => open(null, kind)} className={cn("app-no-drag", !prominent && "bg-card shadow-1")}>
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

type RestDay = "time" | "none";

type Draft = {
  name: string;
  kind: MedicationKind;
  dose: string;
  unit: string;
  form: string;
  instructions: string;
  asNeeded: boolean;
  /** Which "Cuándo" parts are on; their settings are kept while off so toggling back loses nothing. */
  useTimes: boolean;
  times: string[];
  useTraining: boolean;
  withinMinutes: number;
  restDay: RestDay;
  restDayTime: string;
  useMeals: boolean;
  meals: DoseMeal[];
  bedtime: boolean;
  days: number[];
  startDate: string;
  endDate: string;
  stock: string;
  lowStockThreshold: string;
  active: boolean;
  notes: string;
};

const DEFAULT_UNIT: Record<MedicationKind, string> = { medicamento: "mg", suplemento: "g" };

const draftOf =(m: Medication | null, kind: MedicationKind, today: string): Draft => {
  const s = m && !m.schedule.asNeeded ? m.schedule : null;
  return {
    name: m?.name ?? "",
    kind: m?.kind ?? kind,
    dose: m ? String(m.dose) : "",
    unit: m?.unit ?? DEFAULT_UNIT[kind],
    form: m?.form ?? "",
    instructions: m?.instructions ?? "",
    asNeeded: m?.schedule.asNeeded ?? false,
    useTimes: s ? s.times.length > 0 : true,
    times: s?.times.length ? s.times : ["09:00"],
    useTraining: !!s?.training,
    withinMinutes: s?.training?.withinMinutes ?? 60,
    restDay: s?.training && s.training.restDayTime === null ? "none" : "time",
    restDayTime: s?.training?.restDayTime ?? "09:00",
    useMeals: !!s?.meals.length,
    meals: s?.meals.length ? s.meals : ["desayuno"],
    bedtime: s?.bedtime ?? false,
    days: m?.schedule.days ?? [],
    startDate: m?.startDate ?? today,
    endDate: m?.endDate ?? "",
    stock: m?.stock != null ? String(m.stock) : "",
    lowStockThreshold: m?.lowStockThreshold != null ? String(m.lowStockThreshold) : "",
    active: m?.active ?? true,
    notes: m?.notes ?? "",
  };
};

type Preset = { name: string; dose: number; unit: string; form: string; schedule: Partial<MedicationSchedule> };

const noSchedule: Pick<MedicationSchedule, "times" | "training" | "meals" | "bedtime"> = { times: [], training: null, meals: [], bedtime: false };

/** Common supplements with sensible defaults; everything stays editable. */
const PRESETS: Preset[] = [
  { name: "Creatina", dose: 5, unit: "g", form: "polvo", schedule: { ...noSchedule, training: { withinMinutes: 60, restDayTime: "09:00" } } },
  { name: "Proteína whey", dose: 1, unit: "scoop", form: "polvo", schedule: { ...noSchedule, training: { withinMinutes: 60, restDayTime: null } } },
  { name: "Vitamina D", dose: 1000, unit: "UI", form: "cápsula", schedule: { ...noSchedule, meals: ["desayuno"] } },
  { name: "Omega 3", dose: 1, unit: "cápsula", form: "cápsula", schedule: { ...noSchedule, meals: ["comida"] } },
  { name: "Magnesio", dose: 300, unit: "mg", form: "comprimido", schedule: { ...noSchedule, bedtime: true } },
];

function applyPreset(d: Draft, p: Preset): Draft {
  const s = p.schedule;
  return {
    ...d,
    name: p.name,
    kind: "suplemento",
    dose: String(p.dose),
    unit: p.unit,
    form: p.form,
    asNeeded: false,
    useTimes: !!s.times?.length,
    useTraining: !!s.training,
    withinMinutes: s.training?.withinMinutes ?? d.withinMinutes,
    restDay: s.training && s.training.restDayTime === null ? "none" : "time",
    restDayTime: s.training?.restDayTime ?? d.restDayTime,
    useMeals: !!s.meals?.length,
    meals: s.meals?.length ? s.meals : d.meals,
    bedtime: !!s.bedtime,
  };
}

const UNITS: Record<MedicationKind, string[]> = {
  medicamento: ["mg", "g", "µg", "UI", "ml", "gotas", "comprimidos", "cápsulas", "sobres"],
  suplemento: ["g", "mg", "µg", "UI", "scoop", "cazo", "cápsula", "gomita", "ml"],
};
const FORMS: Record<MedicationKind, string[]> = {
  medicamento: ["comprimido", "cápsula", "gotas", "polvo", "jarabe", "sobre", "inyección", "spray", "crema"],
  suplemento: ["polvo", "cápsula", "gomita", "comprimido", "líquido", "gotas"],
};

const MEALS: { value: DoseMeal; label: string }[] = [
  { value: "desayuno", label: "Desayuno" },
  { value: "comida", label: "Comida" },
  { value: "cena", label: "Cena" },
];

const optionalNumber = (text: string) => (text.trim() === "" ? null : Number(text.replace(",", ".")));

/** What is wrong with the draft, in Spanish, or null. */
function problem(d: Draft): string | null {
  const dose = Number(d.dose.replace(",", "."));
  if (!d.name.trim()) return "Ponle un nombre.";
  if (!(dose > 0)) return "La dosis tiene que ser un número mayor que cero.";
  if (!d.unit.trim()) return "Falta la unidad (mg, g, cápsula…).";
  if (!d.asNeeded) {
    if (!d.useTimes && !d.useTraining && !d.useMeals && !d.bedtime) return "Elige cuándo tomarlo, o «Cuando haga falta».";
    if (d.useTimes && d.times.filter(Boolean).length === 0) return "Añade al menos una hora.";
    if (d.useMeals && d.meals.length === 0) return "Elige con qué comida.";
    if (d.useTraining && d.restDay === "time" && !d.restDayTime) return "Pon la hora para los días sin entreno, o elige «No tomar».";
  }
  if (d.endDate && d.endDate < d.startDate) return "La fecha de fin es anterior a la de inicio.";
  for (const n of [d.stock, d.lowStockThreshold]) if (n.trim() && !(Number(n.replace(",", ".")) >= 0)) return "Las existencias tienen que ser un número.";
  return null;
}

function scheduleOf(d: Draft): MedicationSchedule {
  if (d.asNeeded) return { asNeeded: true, days: [], ...noSchedule };
  return {
    asNeeded: false,
    times: d.useTimes ? d.times.filter(Boolean) : [],
    days: d.days,
    training: d.useTraining ? { withinMinutes: d.withinMinutes, restDayTime: d.restDay === "time" ? d.restDayTime : null } : null,
    meals: d.useMeals ? d.meals : [],
    bedtime: d.bedtime,
  };
}

function bodyOf(d: Draft): MedicationInput {
  return {
    name: d.name.trim(),
    kind: d.kind,
    dose: Number(d.dose.replace(",", ".")),
    unit: d.unit.trim(),
    form: d.form.trim() || null,
    instructions: d.instructions.trim() || null,
    schedule: scheduleOf(d),
    startDate: d.startDate,
    endDate: d.endDate || null,
    stock: optionalNumber(d.stock),
    lowStockThreshold: optionalNumber(d.lowStockThreshold),
    active: d.active,
    notes: d.notes.trim() || null,
  };
}

/** A pill that turns one part of the schedule on or off. */
function Chip({ on, onClick, icon: Icon, children }: { on: boolean; onClick: () => void; icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "focus-visible:ring-ring inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium outline-none focus-visible:ring-2 motion-safe:transition-colors",
        on ? "border-transparent text-white" : "border-border bg-muted/60 text-muted-foreground hover:text-foreground",
      )}
      style={on ? { background: MED } : undefined}
    >
      {Icon && <Icon className="size-4" />}
      {children}
    </button>
  );
}

/** The settings of one "Cuándo" part, indented under the chips. */
function Part({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="bg-muted/40 border-border rounded-2xl border p-3.5">
      <p className="text-[13px] font-semibold">{title}</p>
      {hint && <p className="text-muted-foreground mt-0.5 text-[12px] leading-relaxed">{hint}</p>}
      {children && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  );
}

const WINDOWS = [30, 60, 90, 120];
const fmtWindow = (min: number) => (min % 60 === 0 ? `${min / 60} h` : min > 60 ? `${Math.floor(min / 60)} h ${min % 60}` : `${min} min`);

function MedicationForm({ medication, prefill, kind, today, onKind, onDone }: { medication: Medication | null; prefill?: Prefill; kind: MedicationKind; today: string; onKind: (kind: MedicationKind) => void; onDone: () => void }) {
  const router = useRouter();
  // A suggested schedule starts today, so past as-needed days don't count as missed doses.
  const [draft, setDraft] = useState(() => draftOf(medication && prefill ? { ...medication, schedule: prefill.schedule, instructions: medication.instructions ?? prefill.instructions, startDate: today } : medication, kind, today));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const supplement = draft.kind === "suplemento";
  const windows = [...new Set([...WINDOWS, draft.withinMinutes])].sort((a, b) => a - b);

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
      <Segmented<MedicationKind>
        label="Tipo"
        value={draft.kind}
        onChange={(v) => {
          // On a new one, an untouched default unit follows the kind (mg for medicines, g for supplements).
          setDraft((d) => ({ ...d, kind: v, unit: !medication && d.unit === DEFAULT_UNIT[d.kind] ? DEFAULT_UNIT[v] : d.unit }));
          onKind(v);
        }}
        options={[
          { value: "medicamento", label: "Medicamento" },
          { value: "suplemento", label: "Suplemento" },
        ]}
        className="w-full"
      />

      {!medication && supplement && (
        <FieldGroup label="Empieza con uno común" hint="Rellena dosis y cuándo; puedes cambiar todo.">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Chip key={p.name} on={draft.name === p.name} onClick={() => setDraft((d) => applyPreset(d, p))}>
                {p.name}
              </Chip>
            ))}
          </div>
        </FieldGroup>
      )}

      <Field label="Nombre">
        <input className={inputClass} value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder={supplement ? "Creatina, Vitamina D…" : "Ibuprofeno, Levotiroxina…"} autoFocus={!medication && !supplement} maxLength={80} />
      </Field>

      <div className="grid grid-cols-[1fr_1fr] gap-3">
        <Field label="Dosis por toma">
          <input className={cn(inputClass, "tabular")} inputMode="decimal" value={draft.dose} onChange={(e) => set("dose", e.target.value)} placeholder={supplement ? "5" : "500"} />
        </Field>
        <Field label="Unidad">
          <input className={inputClass} list="med-units" value={draft.unit} onChange={(e) => set("unit", e.target.value)} maxLength={24} />
        </Field>
      </div>
      <datalist id="med-units">
        {UNITS[draft.kind].map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      <FieldGroup label="Cuándo" hint={draft.asNeeded ? "No cuenta para la adherencia: anótala cuando la tomes." : undefined}>
        <Segmented<"scheduled" | "asNeeded"> label="Cuándo" value={draft.asNeeded ? "asNeeded" : "scheduled"} onChange={(v) => set("asNeeded", v === "asNeeded")} options={[{ value: "scheduled", label: "Con horario" }, { value: "asNeeded", label: "Cuando haga falta" }]} className="w-full" />
        {!draft.asNeeded && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Chip on={draft.useTimes} onClick={() => set("useTimes", !draft.useTimes)} icon={Clock}>
                A horas fijas
              </Chip>
              <Chip on={draft.useTraining} onClick={() => set("useTraining", !draft.useTraining)} icon={Dumbbell}>
                Después de entrenar
              </Chip>
              <Chip on={draft.useMeals} onClick={() => set("useMeals", !draft.useMeals)} icon={Utensils}>
                Con una comida
              </Chip>
              <Chip on={draft.bedtime} onClick={() => set("bedtime", !draft.bedtime)} icon={BedDouble}>
                Antes de dormir
              </Chip>
            </div>

            {draft.useTimes && (
              <Part title="A horas fijas">
                <div className="flex flex-wrap gap-2">
                  {draft.times.map((time, i) => (
                    <span key={i} className="bg-card border-border flex items-center rounded-xl border pl-1">
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
              </Part>
            )}

            {draft.useTraining && (
              <Part title="Después de entrenar" hint="Cuando termina una sesión de Pulso o un entreno de Salud. Si tienes una sesión en el Calendario, espera a que acabe.">
                <FieldGroup label="Tómala dentro de">
                  <Segmented<string> label="Tómala dentro de" value={String(draft.withinMinutes)} onChange={(v) => set("withinMinutes", Number(v))} options={windows.map((m) => ({ value: String(m), label: fmtWindow(m) }))} className="w-full" />
                </FieldGroup>
                <FieldGroup label="En días sin entreno">
                  <div className="flex flex-wrap items-center gap-2">
                    <Segmented<RestDay> label="En días sin entreno" value={draft.restDay} onChange={(v) => set("restDay", v)} options={[{ value: "time", label: "A una hora" }, { value: "none", label: "No tomar" }]} />
                    {draft.restDay === "time" && (
                      <span className="bg-card border-border flex items-center gap-1 rounded-xl border pl-3">
                        <span className="text-muted-foreground text-[13px]">a las</span>
                        <input type="time" className="tabular h-10 bg-transparent px-2 text-[15px] outline-none" value={draft.restDayTime} onChange={(e) => set("restDayTime", e.target.value)} aria-label="Hora en días sin entreno" />
                      </span>
                    )}
                  </div>
                </FieldGroup>
              </Part>
            )}

            {draft.useMeals && (
              <Part title="Con una comida" hint="A la hora de esa comida en tu Calendario.">
                <div className="flex flex-wrap gap-2">
                  {MEALS.map(({ value, label }) => {
                    const on = draft.meals.includes(value);
                    return (
                      <Chip key={value} on={on} onClick={() => set("meals", on ? draft.meals.filter((m) => m !== value) : MEALS.map((m) => m.value).filter((m) => m === value || draft.meals.includes(m)))}>
                        {label}
                      </Chip>
                    );
                  })}
                </div>
              </Part>
            )}

            {draft.bedtime && <Part title="Antes de dormir" hint="Media hora antes de tu hora de dormir del Calendario." />}

            <FieldGroup label="Qué días" hint={draft.days.length === 0 ? "Sin días marcados: todos los días." : undefined}>
              <WeekdayPicker value={draft.days} onChange={(days) => set("days", days)} color={MED} />
            </FieldGroup>
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
        {FORMS[draft.kind].map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <datalist id="med-instructions">
        {(supplement ? ["con agua", "en un batido", "con comida"] : ["con comida", "en ayunas", "con agua abundante"]).map((f) => (
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

      <div className="bg-popover sticky -bottom-5 flex flex-wrap items-center gap-2 py-3">
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
