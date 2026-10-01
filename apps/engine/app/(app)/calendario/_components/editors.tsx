"use client";

import type { BusyBlock, BusyBlockInput, CalendarPreferences, HealthEvent, HealthEventInput, HealthEventKind, HealthEventStatus, MealSlot, Replan } from "@pulso/contract";
import { ArrowRight, Briefcase, HeartPulse, Plus, RefreshCw, Trash2, TriangleAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState } from "react";
import { cn } from "../../../_ui/cn";
import { Button, Field, FieldGroup, inputClass, Segmented, Toggle, WeekdayPicker } from "../../../_ui/fields";
import { send } from "../../../_ui/send";
import { Sheet } from "../../../_ui/sheet";

type Editing = { kind: "busy"; block: BusyBlock | null; date: string } | { kind: "health"; event: HealthEvent | null } | { kind: "prefs" } | null;

type Calendar = {
  openBusy: (block: BusyBlock | null, date?: string) => void;
  openBusyById: (id: string | null) => void;
  openHealth: (event: HealthEvent | null) => void;
  openHealthById: (id: string | null) => void;
  openPreferences: () => void;
  replan: Replan | null;
  dismissReplan: () => void;
};

const CalendarContext = createContext<Calendar | null>(null);
const useCalendar = () => useContext(CalendarContext)!;

export type Area = { value: string; label: string };

/**
 * The page's editors (busy time, health events, availability) and the last
 * re-plan: every change to availability or health re-checks the planned
 * training, and what moved or still clashes is shown until dismissed.
 */
export function CalendarProvider({ today, day, busyBlocks, healthEvents, preferences, areas, children }: { today: string; day: string; busyBlocks: BusyBlock[]; healthEvents: HealthEvent[]; preferences: CalendarPreferences; areas: Area[]; children: React.ReactNode }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [replan, setReplan] = useState<Replan | null>(null);
  const close = () => setEditing(null);
  const done = (result: { replan?: Replan }) => {
    if (result.replan && (result.replan.moved.length || result.replan.unresolved.length)) setReplan(result.replan);
    close();
  };

  const value: Calendar = {
    openBusy: (block, date) => setEditing({ kind: "busy", block, date: date ?? (day < today ? today : day) }),
    openBusyById: (id) => {
      const block = busyBlocks.find((b) => b.id === id);
      if (block) setEditing({ kind: "busy", block, date: block.date });
    },
    openHealth: (event) => setEditing({ kind: "health", event }),
    openHealthById: (id) => {
      const event = healthEvents.find((e) => e.id === id);
      if (event) setEditing({ kind: "health", event });
    },
    openPreferences: () => setEditing({ kind: "prefs" }),
    replan,
    dismissReplan: () => setReplan(null),
  };

  const title =
    editing?.kind === "busy" ? (editing.block ? editing.block.title : "Marcar ocupado") : editing?.kind === "health" ? (editing.event ? editing.event.title : "Lesión o enfermedad") : "Disponibilidad";

  return (
    <CalendarContext.Provider value={value}>
      {children}
      <Sheet open={editing !== null} onClose={close} title={title}>
        {editing?.kind === "busy" && <BusyForm block={editing.block} date={editing.date} onDone={done} onCancel={close} />}
        {editing?.kind === "health" && <HealthForm event={editing.event} today={today} areas={areas} onDone={done} onCancel={close} />}
        {editing?.kind === "prefs" && <PreferencesForm preferences={preferences} onDone={done} onCancel={close} />}
      </Sheet>
    </CalendarContext.Provider>
  );
}

// ── Triggers ─────────────────────────────────────────────────────────────────

/** «Añadir»: busy time or a health event. */
export function AddMenu() {
  const { openBusy, openHealth } = useCalendar();
  const [open, setOpen] = useState(false);
  const item = "hover:bg-accent focus-visible:bg-accent flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[14px] outline-none";
  return (
    <div className="app-no-drag relative">
      <Button variant="primary" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <Plus className="size-4" />
        Añadir
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div role="menu" className="bg-popover text-popover-foreground shadow-3 border-border absolute right-0 z-40 mt-2 w-60 rounded-2xl border p-1.5" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
            <button role="menuitem" autoFocus className={item} onClick={() => (setOpen(false), openBusy(null))}>
              <Briefcase className="text-muted-foreground size-4" />
              Marcar ocupado
            </button>
            <button role="menuitem" className={item} onClick={() => (setOpen(false), openHealth(null))}>
              <HeartPulse className="size-4" style={{ color: "var(--domain-heart)" }} />
              Lesión o enfermedad
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Opens the editor of the busy block or health event behind a timeline item. */
export function EditItem({ kind, id, className, children, label }: { kind: "busy" | "health"; id: string | null; className?: string; children: React.ReactNode; label: string }) {
  const { openBusyById, openHealthById } = useCalendar();
  return (
    <button type="button" onClick={() => (kind === "busy" ? openBusyById(id) : openHealthById(id))} className={className} aria-label={label}>
      {children}
    </button>
  );
}

/** A small «+» that marks a given day busy. */
export function AddBusyOn({ date, className }: { date: string; className?: string }) {
  const { openBusy } = useCalendar();
  return (
    <button type="button" onClick={() => openBusy(null, date)} className={cn("text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring grid size-8 place-items-center rounded-full outline-none focus-visible:ring-2", className)} aria-label="Marcar ocupado este día" title="Marcar ocupado">
      <Plus className="size-4" />
    </button>
  );
}

export function AddHealthButton({ prominent = false }: { prominent?: boolean }) {
  const { openHealth } = useCalendar();
  return (
    <Button variant={prominent ? "primary" : "secondary"} onClick={() => openHealth(null)}>
      <Plus className="size-4" />
      Lesión o enfermedad
    </Button>
  );
}

export function EditHealthRow({ event, className, children }: { event: HealthEvent; className?: string; children: React.ReactNode }) {
  const { openHealth } = useCalendar();
  return (
    <button type="button" onClick={() => openHealth(event)} className={cn("focus-visible:ring-ring hover:bg-muted/60 w-full rounded-xl text-left outline-none focus-visible:ring-2", className)} aria-label={`Editar ${event.title}`}>
      {children}
    </button>
  );
}

export function EditPreferencesButton() {
  const { openPreferences } = useCalendar();
  return (
    <Button variant="ghost" onClick={openPreferences} className="-mr-2 min-h-8 px-2.5 text-[13px]">
      Editar
    </Button>
  );
}

// ── Re-plan ──────────────────────────────────────────────────────────────────

const dayLabel = (date: string) => new Intl.DateTimeFormat("es", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00`));

/** What the last change did to planned training: what moved and what still clashes. */
export function ReplanBanner() {
  const { replan, dismissReplan } = useCalendar();
  if (!replan) return null;
  return (
    <section className="bg-card shadow-1 border-border mb-5 rounded-[18px] border p-5 motion-safe:animate-[pulso-rise_420ms_cubic-bezier(.2,.7,.2,1)_both]" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 place-items-center rounded-lg" style={{ background: "color-mix(in oklab, var(--domain-training) 16%, transparent)", color: "var(--domain-training)" }}>
          <RefreshCw className="size-4" strokeWidth={2.2} />
        </span>
        <h2 className="flex-1 text-[15px] font-semibold tracking-tight">Entreno reorganizado</h2>
        <button onClick={dismissReplan} className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-9 place-items-center rounded-full" aria-label="Cerrar">
          <X className="size-4" />
        </button>
      </div>
      <ul className="mt-3 space-y-2 text-[14px]">
        {replan.moved.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-x-2">
            <span className="font-medium">{m.name}</span>
            <span className="text-muted-foreground flex items-center gap-1.5">
              movido de {dayLabel(m.from)} <ArrowRight className="size-3.5" /> a {dayLabel(m.to)} · {m.time}
            </span>
          </li>
        ))}
        {replan.unresolved.map((u) => (
          <li key={u.id} className="text-warning flex gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="font-medium">{u.name}</span> ({dayLabel(u.date)}): {u.conflict}. No había hueco cerca; pídele al Coach que lo resuelva.
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Forms ────────────────────────────────────────────────────────────────────

type Done = (result: { replan?: Replan }) => void;

function useSave(onDone: Done) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<{ replan?: Replan }>) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      router.refresh();
      onDone(result);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

function Footer({ busy, error, onCancel, onDelete, deleteLabel, readOnly = false }: { busy: boolean; error: string | null; onCancel: () => void; onDelete?: () => void; deleteLabel?: string; readOnly?: boolean }) {
  const [sure, setSure] = useState(false);
  return (
    <>
      {error && <p className="text-destructive text-[13px]">{error}</p>}
      <div className="bg-popover sticky -bottom-5 flex flex-wrap items-center gap-2 py-3">
        {onDelete &&
          (sure ? (
            <span className="flex items-center gap-2">
              <Button variant="danger" onClick={onDelete} disabled={busy} className="bg-destructive/10">
                {deleteLabel ?? "Eliminar"}
              </Button>
              <Button variant="ghost" onClick={() => setSure(false)}>
                No
              </Button>
            </span>
          ) : (
            <Button variant="danger" onClick={() => setSure(true)}>
              <Trash2 className="size-4" /> Eliminar
            </Button>
          ))}
        <span className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {readOnly ? "Cerrar" : "Cancelar"}
          </Button>
          {!readOnly && (
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Guardando…" : "Guardar"}
            </Button>
          )}
        </span>
      </div>
    </>
  );
}

type BusyMode = "once" | "range" | "weekly";

function BusyForm({ block, date, onDone, onCancel }: { block: BusyBlock | null; date: string; onDone: Done; onCancel: () => void }) {
  const readOnly = block?.source === "apple_calendar";
  const [d, setDraft] = useState({
    title: block?.title ?? "",
    mode: (block?.weekdays.length ? "weekly" : block?.endDate ? "range" : "once") as BusyMode,
    date: block?.date ?? date,
    endDate: block?.endDate ?? "",
    weekdays: block?.weekdays.length ? block.weekdays : [],
    until: block?.until ?? "",
    allDay: block?.allDay ?? false,
    start: block?.start ?? "09:00",
    end: block?.end ?? "18:00",
    notes: block?.notes ?? "",
  });
  const set = <K extends keyof typeof d>(key: K, value: (typeof d)[K]) => setDraft((x) => ({ ...x, [key]: value }));
  const { busy, error, setError, run } = useSave(onDone);

  function save() {
    if (!d.title.trim()) return setError("Ponle un nombre: «Trabajo», «Viaje»…");
    if (!d.allDay && !(d.start && d.end && d.end > d.start)) return setError("La hora de fin tiene que ser después de la de inicio (si cruza la medianoche, divídelo en dos).");
    if (d.mode === "range" && !(d.endDate && d.endDate > d.date)) return setError("Elige hasta qué día dura.");
    if (d.mode === "weekly" && d.weekdays.length === 0) return setError("Marca al menos un día de la semana.");
    if (d.mode === "weekly" && d.until && d.until < d.date) return setError("«Hasta» es anterior a «Desde».");
    const body: BusyBlockInput = {
      title: d.title.trim(),
      allDay: d.allDay,
      date: d.date,
      endDate: d.mode === "range" ? d.endDate : null,
      start: d.allDay ? null : d.start,
      end: d.allDay ? null : d.end,
      weekdays: d.mode === "weekly" ? d.weekdays : [],
      until: d.mode === "weekly" ? d.until || null : null,
      notes: d.notes.trim() || null,
    };
    void run(() => (block ? send(`/api/web/calendario/ocupado/${block.id}`, "PATCH", body) : send("/api/web/calendario/ocupado", "POST", body)));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-5"
    >
      {readOnly && <p className="bg-muted/70 rounded-xl px-3 py-2.5 text-[13px]">Viene de tu Calendario de Apple: cámbialo allí.</p>}
      <fieldset disabled={readOnly} className="space-y-5">
        <Field label="Qué es">
          <input className={inputClass} value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="Trabajo, viaje, cena…" autoFocus={!block} maxLength={120} />
        </Field>
        <Segmented<BusyMode>
          label="Cuándo"
          value={d.mode}
          onChange={(v) => set("mode", v)}
          options={[
            { value: "once", label: "Un día" },
            { value: "range", label: "Varios días" },
            { value: "weekly", label: "Cada semana" },
          ]}
          className="w-full"
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label={d.mode === "once" ? "Día" : "Desde"}>
            <input type="date" className={inputClass} value={d.date} onChange={(e) => e.target.value && set("date", e.target.value)} />
          </Field>
          {d.mode === "range" && (
            <Field label="Hasta">
              <input type="date" className={inputClass} value={d.endDate} min={d.date} onChange={(e) => set("endDate", e.target.value)} />
            </Field>
          )}
          {d.mode === "weekly" && (
            <Field label="Hasta (opcional)">
              <input type="date" className={inputClass} value={d.until} min={d.date} onChange={(e) => set("until", e.target.value)} />
            </Field>
          )}
        </div>
        {d.mode === "weekly" && (
          <FieldGroup label="Qué días">
            <WeekdayPicker value={d.weekdays} onChange={(days) => set("weekdays", days)} color="var(--muted-foreground)" />
          </FieldGroup>
        )}
        <Toggle checked={d.allDay} onChange={(on) => set("allDay", on)} label="Todo el día" hint={d.allDay ? "Ese día no se planifica entreno." : undefined} />
        {!d.allDay && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="De">
              <input type="time" className={cn(inputClass, "tabular")} value={d.start} onChange={(e) => set("start", e.target.value)} />
            </Field>
            <Field label="A">
              <input type="time" className={cn(inputClass, "tabular")} value={d.end} onChange={(e) => set("end", e.target.value)} />
            </Field>
          </div>
        )}
        <Field label="Notas">
          <input className={inputClass} value={d.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Opcional" maxLength={500} />
        </Field>
      </fieldset>
      <Footer busy={busy} error={error} onCancel={onCancel} readOnly={readOnly} onDelete={block && !readOnly ? () => run(() => send(`/api/web/calendario/ocupado/${block.id}`, "DELETE")) : undefined} />
    </form>
  );
}

const KINDS: { value: HealthEventKind; label: string }[] = [
  { value: "lesion", label: "Lesión" },
  { value: "enfermedad", label: "Enfermedad" },
  { value: "sintoma", label: "Síntoma" },
  { value: "cirugia", label: "Cirugía" },
  { value: "otro", label: "Otro" },
];
const SEVERITY = ["", "Leve", "Molesta", "Moderada", "Fuerte", "Muy fuerte"];

function HealthForm({ event, today, areas, onDone, onCancel }: { event: HealthEvent | null; today: string; areas: Area[]; onDone: Done; onCancel: () => void }) {
  const [d, setDraft] = useState({
    kind: event?.kind ?? ("lesion" as HealthEventKind),
    title: event?.title ?? "",
    bodyArea: (event?.bodyArea ?? "") as string,
    severity: event?.severity ?? 2,
    startDate: event?.startDate ?? today,
    endDate: event?.endDate ?? "",
    status: event?.status ?? ("activa" as HealthEventStatus),
    affectedTraining: event?.affectedTraining ?? "",
    notes: event?.notes ?? "",
  });
  const set = <K extends keyof typeof d>(key: K, value: (typeof d)[K]) => setDraft((x) => ({ ...x, [key]: value }));
  const { busy, error, setError, run } = useSave(onDone);

  function save() {
    if (!d.title.trim()) return setError("Ponle un nombre: «Esguince de tobillo», «Gripe»…");
    if (d.endDate && d.endDate < d.startDate) return setError("La fecha de fin es anterior a la de inicio.");
    const body = {
      kind: d.kind,
      title: d.title.trim(),
      bodyArea: d.bodyArea || null,
      severity: d.severity,
      startDate: d.startDate,
      endDate: d.endDate || null,
      status: d.status,
      affectedTraining: d.affectedTraining.trim() || null,
      notes: d.notes.trim() || null,
    } as HealthEventInput;
    void run(() => (event ? send(`/api/web/calendario/salud/${event.id}`, "PATCH", body) : send("/api/web/calendario/salud", "POST", body)));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-5"
    >
      <div className="grid grid-cols-[1fr_1.4fr] gap-3">
        <Field label="Tipo">
          <select className={inputClass} value={d.kind} onChange={(e) => set("kind", e.target.value as HealthEventKind)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Zona">
          <select className={inputClass} value={d.bodyArea} onChange={(e) => set("bodyArea", e.target.value)}>
            <option value="">Sin zona</option>
            {areas.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Qué es">
        <input className={inputClass} value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="Esguince de tobillo, gripe…" autoFocus={!event} maxLength={120} />
      </Field>
      <FieldGroup label={`Intensidad · ${SEVERITY[d.severity]} (${d.severity}/5)`}>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={d.severity === n}
              aria-label={`${SEVERITY[n]}, ${n} de 5`}
              onClick={() => set("severity", n)}
              className={cn("focus-visible:ring-ring h-10 flex-1 rounded-xl text-[14px] font-semibold outline-none focus-visible:ring-2", n <= d.severity ? "text-white" : "bg-muted text-muted-foreground")}
              style={n <= d.severity ? { background: `color-mix(in oklab, var(--domain-heart) ${40 + n * 12}%, var(--muted))` } : undefined}
            >
              {n}
            </button>
          ))}
        </div>
      </FieldGroup>
      <Segmented<HealthEventStatus>
        label="Estado"
        value={d.status}
        onChange={(v) => set("status", v)}
        options={[
          { value: "activa", label: "Activa" },
          { value: "recuperandose", label: "Recuperándome" },
          { value: "resuelta", label: "Resuelta" },
        ]}
        className="w-full"
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Desde">
          <input type="date" className={inputClass} value={d.startDate} onChange={(e) => e.target.value && set("startDate", e.target.value)} />
        </Field>
        <Field label="Hasta" hint={d.status === "resuelta" && !d.endDate ? "Si la dejas vacía, termina hoy." : undefined}>
          <input type="date" className={inputClass} value={d.endDate} min={d.startDate} onChange={(e) => set("endDate", e.target.value)} />
        </Field>
      </div>
      <Field label="Cómo limita el entreno" hint="El Coach lo tiene en cuenta al planificar.">
        <input className={inputClass} value={d.affectedTraining} onChange={(e) => set("affectedTraining", e.target.value)} placeholder="Evitar sentadilla y saltos…" maxLength={300} />
      </Field>
      <Field label="Notas">
        <textarea className={cn(inputClass, "h-auto min-h-20 py-2.5")} value={d.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Opcional" maxLength={1000} />
      </Field>
      <p className="text-muted-foreground text-[12px] leading-relaxed">Pulso no diagnostica. Si el dolor es fuerte, empeora o viene de un golpe, consulta a un profesional.</p>
      <Footer busy={busy} error={error} onCancel={onCancel} onDelete={event ? () => run(() => send(`/api/web/calendario/salud/${event.id}`, "DELETE")) : undefined} />
    </form>
  );
}

const MEALS: { slot: MealSlot; label: string }[] = [
  { slot: "desayuno", label: "Desayuno" },
  { slot: "media_manana", label: "Media mañana" },
  { slot: "comida", label: "Comida" },
  { slot: "merienda", label: "Merienda" },
  { slot: "cena", label: "Cena" },
  { slot: "snack", label: "Snack" },
];

function PreferencesForm({ preferences, onDone, onCancel }: { preferences: CalendarPreferences; onDone: Done; onCancel: () => void }) {
  const [d, setDraft] = useState({
    trainingTimes: preferences.trainingTimes,
    sessionMinutes: preferences.sessionMinutes,
    restDays: preferences.restDays,
    wakeTime: preferences.wakeTime,
    sleepTime: preferences.sleepTime,
    meals: Object.fromEntries(MEALS.map((m) => [m.slot, preferences.mealTimes.find((t) => t.slot === m.slot)?.time ?? ""])) as Record<MealSlot, string>,
  });
  const set = <K extends keyof typeof d>(key: K, value: (typeof d)[K]) => setDraft((x) => ({ ...x, [key]: value }));
  const { busy, error, run } = useSave(onDone);

  function save() {
    const body: CalendarPreferences = {
      trainingTimes: d.trainingTimes.filter(Boolean),
      sessionMinutes: d.sessionMinutes,
      restDays: d.restDays,
      wakeTime: d.wakeTime,
      sleepTime: d.sleepTime,
      mealTimes: MEALS.filter((m) => d.meals[m.slot]).map((m) => ({ slot: m.slot, time: d.meals[m.slot] })),
    };
    void run(() => send("/api/web/calendario/preferencias", "PUT", body));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-5"
    >
      <FieldGroup label="Horas preferidas para entrenar" hint={d.trainingTimes.length === 0 ? "Sin horas: cualquier hueco entre que te levantas y te acuestas." : "La primera es la favorita."}>
        <div className="flex flex-wrap gap-2">
          {d.trainingTimes.map((time, i) => (
            <span key={i} className="bg-muted/60 border-border flex items-center rounded-xl border pl-1">
              <input type="time" className="tabular h-10 bg-transparent px-2 text-[15px] outline-none" value={time} onChange={(e) => set("trainingTimes", d.trainingTimes.map((t, j) => (j === i ? e.target.value : t)))} aria-label={`Hora ${i + 1}`} />
              <button type="button" onClick={() => set("trainingTimes", d.trainingTimes.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-foreground grid size-9 place-items-center" aria-label="Quitar esta hora">
                <X className="size-3.5" />
              </button>
            </span>
          ))}
          {d.trainingTimes.length < 6 && (
            <Button variant="ghost" onClick={() => set("trainingTimes", [...d.trainingTimes, "18:00"])} className="min-h-10 rounded-xl">
              <Plus className="size-4" /> Hora
            </Button>
          )}
        </div>
      </FieldGroup>
      <Field label="Duración de una sesión">
        <select className={inputClass} value={d.sessionMinutes} onChange={(e) => set("sessionMinutes", Number(e.target.value))}>
          {[30, 45, 60, 75, 90, 105, 120, 150, 180].map((m) => (
            <option key={m} value={m}>
              {m} min
            </option>
          ))}
        </select>
      </Field>
      <FieldGroup label="Días de descanso" hint="Nunca se planifica entreno en ellos.">
        <WeekdayPicker value={d.restDays} onChange={(days) => set("restDays", days)} color="var(--domain-training)" />
      </FieldGroup>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Te levantas">
          <input type="time" className={cn(inputClass, "tabular")} value={d.wakeTime} onChange={(e) => e.target.value && set("wakeTime", e.target.value)} />
        </Field>
        <Field label="Te acuestas">
          <input type="time" className={cn(inputClass, "tabular")} value={d.sleepTime} onChange={(e) => e.target.value && set("sleepTime", e.target.value)} />
        </Field>
      </div>
      <FieldGroup label="Horas de comida" hint="Vacía, esa comida no se planifica.">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
          {MEALS.map((m) => (
            <label key={m.slot} className="block">
              <span className="text-muted-foreground mb-1 block text-[12px]">{m.label}</span>
              <input type="time" className={cn(inputClass, "tabular h-10")} value={d.meals[m.slot]} onChange={(e) => set("meals", { ...d.meals, [m.slot]: e.target.value })} />
            </label>
          ))}
        </div>
      </FieldGroup>
      <Footer busy={busy} error={error} onCancel={onCancel} />
    </form>
  );
}

