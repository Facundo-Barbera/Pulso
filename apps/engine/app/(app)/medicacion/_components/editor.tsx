"use client";

import { DAY_PART_RANGES, DEFAULT_ANY_TIME_REMINDER, type DayPart, type DoseMeal, type DoseWindow, type Medication, type MedicationInput, type MedicationKind, type MedicationSchedule } from "@pulso/contract";
import { BedDouble, CalendarCheck, CalendarClock, Clock, Dumbbell, Plus, Sun, Trash2, Utensils, X, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState } from "react";
import { readBack } from "@/src/web/read-back";
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
/** Step 1, «¿Cada cuándo?». */
type Frequency = "daily" | "weekdays" | "interval" | "monthly" | "asNeeded";

type Draft = {
  name: string;
  kind: MedicationKind;
  dose: string;
  unit: string;
  form: string;
  instructions: string;
  frequency: Frequency;
  every: number;
  everyUnit: "day" | "week";
  intervalStart: string;
  monthDay: number;
  /** Which «¿Cuándo durante el día?» part is on: one, chosen fresh (`chooseTiming`); a schedule from the Coach may bring several. */
  useTimes: boolean;
  times: string[];
  useTraining: boolean;
  withinMinutes: number;
  restDay: RestDay;
  restDayTime: string;
  useMeals: boolean;
  meals: DoseMeal[];
  bedtime: boolean;
  useWindows: boolean;
  windows: DoseWindow[];
  anyTime: boolean;
  remind: boolean;
  reminder: string;
  days: number[];
  startDate: string;
  endDate: string;
  stock: string;
  lowStockThreshold: string;
  active: boolean;
  notes: string;
};

const DEFAULT_UNIT: Record<MedicationKind, string> = { medicamento: "mg", suplemento: "g" };

const frequencyOf = (s: MedicationSchedule): Frequency =>
  s.asNeeded ? "asNeeded" : s.monthDay ? "monthly" : s.interval ? "interval" : s.days.length ? "weekdays" : "daily";

const draftOf = (m: Medication | null, kind: MedicationKind, today: string): Draft => {
  const s = m && !m.schedule.asNeeded ? m.schedule : null;
  // Something already timed some other way doesn't also get a default hour.
  const timedElsewhere = !!s && (s.anyTime || s.windows.length > 0 || !!s.training || s.meals.length > 0 || s.bedtime);
  return {
    name: m?.name ?? "",
    kind: m?.kind ?? kind,
    dose: m ? String(m.dose) : "",
    unit: m?.unit ?? DEFAULT_UNIT[kind],
    form: m?.form ?? "",
    instructions: m?.instructions ?? "",
    frequency: m ? frequencyOf(m.schedule) : "daily",
    every: s?.interval?.every ?? 2,
    everyUnit: s?.interval?.unit ?? "week",
    intervalStart: s?.interval?.start ?? m?.startDate ?? today,
    monthDay: s?.monthDay ?? Number(today.slice(8, 10)),
    useTimes: s ? s.times.length > 0 || !timedElsewhere : true,
    times: s?.times.length ? s.times : ["09:00"],
    useTraining: !!s?.training,
    withinMinutes: s?.training?.withinMinutes ?? 60,
    restDay: s?.training && s.training.restDayTime === null ? "none" : "time",
    restDayTime: s?.training?.restDayTime ?? "09:00",
    useMeals: !!s?.meals.length,
    meals: s?.meals.length ? s.meals : ["desayuno"],
    bedtime: s?.bedtime ?? false,
    useWindows: !!s?.windows.length,
    windows: s?.windows.length ? s.windows : [{ part: "manana", ...DAY_PART_RANGES.manana }],
    anyTime: s?.anyTime ?? false,
    // Any time starts without a reminder: it is an optional nudge, not the dose's hour.
    remind: !!s?.anyTime && s.reminder !== null,
    reminder: s?.reminder ?? DEFAULT_ANY_TIME_REMINDER,
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
    frequency: "daily",
    days: [],
    useTimes: !!s.times?.length,
    useTraining: !!s.training,
    withinMinutes: s.training?.withinMinutes ?? d.withinMinutes,
    restDay: s.training && s.training.restDayTime === null ? "none" : "time",
    restDayTime: s.training?.restDayTime ?? d.restDayTime,
    useMeals: !!s.meals?.length,
    meals: s.meals?.length ? s.meals : d.meals,
    bedtime: !!s.bedtime,
    useWindows: false,
    anyTime: false,
  };
}

/** Step 2, «¿Cuándo durante el día?». */
type Timing = "times" | "windows" | "anyTime" | "training" | "meals" | "bedtime";

const TIMINGS: { value: Timing; label: string; icon: LucideIcon }[] = [
  { value: "times", label: "A una hora", icon: Clock },
  { value: "windows", label: "En la mañana…", icon: Sun },
  { value: "anyTime", label: "Cualquier hora", icon: CalendarCheck },
  { value: "training", label: "Después de entrenar", icon: Dumbbell },
  { value: "meals", label: "Con una comida", icon: Utensils },
  { value: "bedtime", label: "Antes de dormir", icon: BedDouble },
];

const timingOn = (d: Draft, t: Timing): boolean =>
  ({ times: d.useTimes, windows: d.useWindows, anyTime: d.anyTime, training: d.useTraining, meals: d.useMeals, bedtime: d.bedtime })[t];

const TIMING_KEYS = ["useTimes", "times", "useTraining", "withinMinutes", "restDay", "restDayTime", "useMeals", "meals", "bedtime", "useWindows", "windows", "anyTime", "remind", "reminder"] as const;

/** Every timing setting back to a new medication's defaults (at a time, 09:00). */
function freshTiming(d: Draft): Draft {
  const fresh = draftOf(null, d.kind, d.startDate);
  return { ...d, ...(Object.fromEntries(TIMING_KEYS.map((k) => [k, fresh[k]])) as Pick<Draft, (typeof TIMING_KEYS)[number]>) };
}

/** Picks one timing: the others go off and nothing of them is kept; the new one starts at its defaults. */
function chooseTiming(d: Draft, t: Timing): Draft {
  const base = timingOn(d, t) ? d : freshTiming(d);
  return { ...base, useTimes: t === "times", useWindows: t === "windows", anyTime: t === "anyTime", useTraining: t === "training", useMeals: t === "meals", bedtime: t === "bedtime" };
}

/** ISO weekday (1 = lunes) of a "yyyy-mm-dd", so «Algunos días» starts on one and never reads as every day. */
const weekdayOf = (date: string) => new Date(`${date}T12:00:00`).getDay() || 7;

const UNITS: Record<MedicationKind, string[]> = {
  medicamento: ["mg", "g", "µg", "UI", "ml", "gotas", "comprimidos", "cápsulas", "sobres"],
  suplemento: ["g", "mg", "µg", "UI", "scoop", "cazo", "cápsula", "gomita", "ml"],
};
const FORMS: Record<MedicationKind, string[]> = {
  medicamento: ["comprimido", "cápsula", "gotas", "polvo", "jarabe", "sobre", "inyección", "spray", "crema"],
  suplemento: ["polvo", "cápsula", "gomita", "comprimido", "líquido", "gotas"],
};

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "daily", label: "Diario" },
  { value: "weekdays", label: "Algunos días" },
  { value: "interval", label: "Cada N semanas" },
  { value: "monthly", label: "Cada mes" },
  { value: "asNeeded", label: "Cuando haga falta" },
];

const PARTS: { value: DayPart; label: string }[] = [
  { value: "manana", label: "Mañana" },
  { value: "tarde", label: "Tarde" },
  { value: "noche", label: "Noche" },
];

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
  if (d.frequency !== "asNeeded") {
    if (d.frequency === "weekdays" && d.days.length === 0) return "Marca al menos un día.";
    if (d.frequency === "interval" && !(Number.isInteger(d.every) && d.every >= 1 && d.every <= 52)) return "Elige cada cuántos días o semanas (1 a 52).";
    if (!d.useTimes && !d.useTraining && !d.useMeals && !d.bedtime && !d.useWindows && !d.anyTime) return "Elige cuándo durante el día; si no hay una hora fija, «Cualquier hora».";
    if (d.useTimes && d.times.filter(Boolean).length === 0) return "Añade al menos una hora.";
    if (d.useWindows && d.windows.length === 0) return "Elige mañana, tarde o noche.";
    if (d.useWindows && d.windows.some((w) => !w.start || !w.end || w.start >= w.end)) return "Cada franja tiene que empezar antes de terminar.";
    if (d.anyTime && d.remind && !d.reminder) return "Pon la hora del recordatorio, o apágalo.";
    if (d.useMeals && d.meals.length === 0) return "Elige con qué comida.";
    if (d.useTraining && d.restDay === "time" && !d.restDayTime) return "Pon la hora para los días sin entreno, o elige «No tomar».";
  }
  if (d.endDate && d.endDate < d.startDate) return "La fecha de fin es anterior a la de inicio.";
  for (const n of [d.stock, d.lowStockThreshold]) if (n.trim() && !(Number(n.replace(",", ".")) >= 0)) return "Las existencias tienen que ser un número.";
  return null;
}

function scheduleOf(d: Draft): MedicationSchedule {
  const none = { days: [], interval: null, monthDay: null, windows: [], anyTime: false, reminder: null };
  if (d.frequency === "asNeeded") return { asNeeded: true, ...none, ...noSchedule };
  const weekly = d.frequency === "weekdays" || (d.frequency === "interval" && d.everyUnit === "week");
  return {
    asNeeded: false,
    times: d.useTimes ? d.times.filter(Boolean) : [],
    days: weekly ? d.days : [],
    interval: d.frequency === "interval" ? { every: d.every, unit: d.everyUnit, start: d.intervalStart } : null,
    monthDay: d.frequency === "monthly" ? d.monthDay : null,
    training: d.useTraining ? { withinMinutes: d.withinMinutes, restDayTime: d.restDay === "time" ? d.restDayTime : null } : null,
    meals: d.useMeals ? d.meals : [],
    bedtime: d.bedtime,
    windows: d.useWindows ? d.windows : [],
    anyTime: d.anyTime,
    reminder: d.anyTime && d.remind ? d.reminder : null,
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

/** A "HH:MM" input in the editor's rounded field. */
function TimeInput({ value, onChange, label, prefix }: { value: string; onChange: (value: string) => void; label: string; prefix?: string }) {
  return (
    <span className="bg-card border-border flex items-center gap-1 rounded-xl border pl-3">
      {prefix && <span className="text-muted-foreground text-[13px]">{prefix}</span>}
      <input type="time" className="tabular h-10 bg-transparent px-2 text-[15px] outline-none" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
    </span>
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

      <FieldGroup label="Horario">
        <p className="bg-muted/40 border-border flex items-start gap-2 rounded-2xl border p-3.5 text-[14px] font-medium" aria-live="polite">
          <CalendarClock className="mt-0.5 size-4 shrink-0" style={{ color: MED }} />
          <span>{readBack(scheduleOf(draft))}</span>
        </p>
      </FieldGroup>

      <FieldGroup label="¿Cada cuándo?" hint={draft.frequency === "asNeeded" ? "No cuenta para la adherencia: anótala cuando la tomes." : undefined}>
        <div className="flex flex-wrap gap-2">
          {FREQUENCIES.map(({ value, label }) => (
            <Chip key={value} on={draft.frequency === value} onClick={() => setDraft((d) => ({ ...(value === "asNeeded" ? freshTiming(d) : d), frequency: value, days: value === "weekdays" && !d.days.length ? [weekdayOf(d.startDate)] : d.days }))}>
              {label}
            </Chip>
          ))}
        </div>
        {draft.frequency === "weekdays" && (
          <div className="mt-3">
            <WeekdayPicker value={draft.days} onChange={(days) => set("days", days)} color={MED} />
          </div>
        )}
        {draft.frequency === "interval" && (
          <div className="mt-3">
            <Part title="Cada cuánto">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground text-[13px]">Cada</span>
                <input className={cn(inputClass, "tabular w-20 text-center")} inputMode="numeric" value={String(draft.every)} onChange={(e) => set("every", Number(e.target.value.replace(/\D/g, "")) || 0)} aria-label="Cada cuántos" />
                <Segmented<"day" | "week"> label="Unidad" value={draft.everyUnit} onChange={(v) => set("everyUnit", v)} options={[{ value: "week", label: "semanas" }, { value: "day", label: "días" }]} />
              </div>
              <Field label="A partir del">
                <input type="date" className={inputClass} value={draft.intervalStart} onChange={(e) => set("intervalStart", e.target.value || draft.startDate)} />
              </Field>
              {draft.everyUnit === "week" && (
                <FieldGroup label="Qué día" hint={draft.days.length === 0 ? "Sin días marcados: el mismo día de la semana que el inicio." : undefined}>
                  <WeekdayPicker value={draft.days} onChange={(days) => set("days", days)} color={MED} />
                </FieldGroup>
              )}
            </Part>
          </div>
        )}
        {draft.frequency === "monthly" && (
          <div className="mt-3">
            <Part title="Cada mes" hint={draft.monthDay > 28 ? "En los meses más cortos, el último día." : undefined}>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-[13px]">El día</span>
                <select className={cn(inputClass, "tabular w-24")} value={draft.monthDay} onChange={(e) => set("monthDay", Number(e.target.value))} aria-label="Día del mes">
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </Part>
          </div>
        )}
      </FieldGroup>

      {draft.frequency !== "asNeeded" && (
        <FieldGroup label="¿Cuándo durante el día?" hint={TIMINGS.filter((t) => timingOn(draft, t.value)).length > 1 ? "Este horario combina varios momentos; elegir uno lo reemplaza." : undefined}>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {TIMINGS.map(({ value, label, icon }) => (
                <Chip key={value} on={timingOn(draft, value)} onClick={() => setDraft((d) => chooseTiming(d, value))} icon={icon}>
                  {label}
                </Chip>
              ))}
            </div>

            {draft.useTimes && (
              <Part title="A una hora">
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

            {draft.useWindows && (
              <Part title="En una parte del día" hint="Una toma cuando quieras dentro de la franja. Cuenta como olvidada solo al acabar el día.">
                <div className="flex flex-wrap gap-2">
                  {PARTS.map(({ value, label }) => {
                    const on = draft.windows.some((w) => w.part === value);
                    const toggled = on ? draft.windows.filter((w) => w.part !== value) : [...draft.windows, { part: value, ...DAY_PART_RANGES[value] }];
                    return (
                      <Chip key={value} on={on} onClick={() => set("windows", PARTS.flatMap((p) => toggled.filter((w) => w.part === p.value)))}>
                        {label}
                      </Chip>
                    );
                  })}
                </div>
                {draft.windows.map((w) => {
                  const edit = (patch: Partial<DoseWindow>) => set("windows", draft.windows.map((x) => (x.part === w.part ? { ...x, ...patch } : x)));
                  const label = PARTS.find((p) => p.value === w.part)!.label;
                  return (
                    <details key={w.part} className="group">
                      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-[13px]">
                        <span className="font-medium">{label}</span>
                        <span className="tabular text-muted-foreground">
                          {w.start}–{w.end}
                        </span>
                        <span className="text-muted-foreground ml-auto text-[12px] group-open:hidden">Cambiar</span>
                      </summary>
                      <div className="flex flex-wrap items-center gap-2 pb-1">
                        <TimeInput value={w.start} onChange={(start) => edit({ start })} label={`${label}: desde`} prefix="de" />
                        <TimeInput value={w.end} onChange={(end) => edit({ end })} label={`${label}: hasta`} prefix="a" />
                      </div>
                    </details>
                  );
                })}
              </Part>
            )}

            {draft.anyTime && (
              <>
                <Part title="Cualquier hora" hint="Toca ese día, sin hora: cuando quieras. Solo cuenta como olvidada si se acaba el día sin tomarla." />
                {/* The optional nudge apart, so its hour never reads as the dose's. */}
                <Part title="Recordatorio">
                  <Toggle checked={draft.remind} onChange={(on) => set("remind", on)} label="Recordatorio si no la has tomado" hint={draft.remind ? "Solo si a esa hora aún no la marcaste." : "Opcional. Sin él, Pulso no te avisa."} />
                  {draft.remind && <TimeInput value={draft.reminder} onChange={(v) => set("reminder", v)} label="Hora del recordatorio" prefix="a las" />}
                </Part>
              </>
            )}

            {draft.useTraining && (
              <Part title="Después de entrenar" hint="Cuando termina una sesión de Pulso o un entreno de Salud. Si tienes una sesión en el Calendario, espera a que acabe.">
                <FieldGroup label="Dentro de">
                  <Segmented<string> label="Dentro de" value={String(draft.withinMinutes)} onChange={(v) => set("withinMinutes", Number(v))} options={windows.map((m) => ({ value: String(m), label: fmtWindow(m) }))} className="w-full" />
                </FieldGroup>
                <FieldGroup label="Días sin entreno">
                  <div className="flex flex-wrap items-center gap-2">
                    <Segmented<RestDay> label="Días sin entreno" value={draft.restDay} onChange={(v) => set("restDay", v)} options={[{ value: "none", label: "No tomar" }, { value: "time", label: "A una hora" }]} />
                    {draft.restDay === "time" && <TimeInput value={draft.restDayTime} onChange={(v) => set("restDayTime", v)} label="Hora en días sin entreno" prefix="a las" />}
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
          </div>
        </FieldGroup>
      )}

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
