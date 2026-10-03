"use client";

import type { ManualSleepNight } from "@pulso/contract";
import { Info, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "../../../_ui/cn";
import { Button, Field, inputClass } from "../../../_ui/fields";
import { fmtLongDate, fmtMinutes } from "../../../_ui/format";
import { send } from "../../../_ui/send";
import { Sheet } from "../../../_ui/sheet";

/** A night logged by hand, as the form edits it. Times are epoch ms. */
export type ManualDraft = { id: string; start: number; end: number; note: string | null };

// Same limits as the engine (src/sleep/manual.ts); it still has the last word.
const MIN_MIN = 60;
const MAX_MIN = 16 * 60;
const FUTURE_SLACK_MS = 5 * 60_000;
const NOTE_MAX = 280;

const pad = (n: number) => String(n).padStart(2, "0");
/** Epoch ms → the browser-local "YYYY-MM-DDTHH:mm" a datetime-local input takes. */
const toInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** A datetime-local value (no zone) parses as browser-local time. */
const fromInput = (value: string) => (value ? new Date(value).getTime() : NaN);

/** The date a night is named after, like the engine's `nightOf`: the local day six hours after falling asleep. */
const nightOf = (start: number) => {
  const d = new Date(start + 6 * 3_600_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function problem(start: number, end: number, now: number): string | null {
  if (Number.isNaN(start) || Number.isNaN(end)) return "Indica cuándo te dormiste y cuándo te despertaste.";
  if (end <= start) return "La hora de despertar tiene que ser después de la de dormir.";
  const minutes = (end - start) / 60_000;
  if (minutes < MIN_MIN) return "Una noche dura al menos 1 hora.";
  if (minutes > MAX_MIN) return "Una noche dura como mucho 16 horas.";
  if (end > now + FUTURE_SLACK_MS) return "La hora de despertar todavía no llegó.";
  return null;
}

/** After a write: show that night (or the newest) with fresh data. */
function useShowNight() {
  const router = useRouter();
  return (night: string | null) => {
    router.push(night ? `/sueno?noche=${night}` : "/sueno");
    router.refresh();
  };
}

/**
 * «Añadir noche»: opens the form for a night the watch missed. `autoOpen` opens
 * it once on arrival (Hoy links to `/sueno?anadir=1`), then drops the param so a
 * reload doesn't open it again.
 */
export function AddNightButton({ prominent = false, autoOpen = false }: { prominent?: boolean; autoOpen?: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!autoOpen) return;
    setOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.delete("anadir");
    window.history.replaceState(null, "", url);
  }, [autoOpen]);

  return (
    <>
      <Button variant={prominent ? "primary" : "secondary"} onClick={() => setOpen(true)} className={cn("app-no-drag", !prominent && "bg-card shadow-1")}>
        <Plus className="size-4" />
        Añadir noche
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Añadir noche">
        <NightForm onDone={() => setOpen(false)} />
      </Sheet>
    </>
  );
}

/** Editar / Borrar for a night logged by hand. Borrar asks once, in place. */
export function ManualNightActions({ night }: { night: ManualDraft }) {
  const showNight = useShowNight();
  const [editing, setEditing] = useState(false);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/web/sueno/noches/${night.id}`, "DELETE");
      showNight(null);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2 md:items-start">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {sure ? (
          <>
            <span className="text-muted-foreground text-[13px]">¿Borrar esta noche?</span>
            <Button variant="danger" onClick={remove} disabled={busy} className="bg-destructive/10 min-h-9 px-3.5 text-[13px]">
              <Trash2 className="size-4" /> {busy ? "Borrando…" : "Borrar"}
            </Button>
            <Button variant="ghost" onClick={() => setSure(false)} disabled={busy} className="min-h-9 px-3.5 text-[13px]">
              No
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setEditing(true)} className="min-h-9 px-3.5 text-[13px]">
              <Pencil className="size-3.5" /> Editar
            </Button>
            <Button variant="danger" onClick={() => setSure(true)} className="min-h-9 px-3.5 text-[13px]">
              <Trash2 className="size-3.5" /> Borrar
            </Button>
          </>
        )}
      </div>
      {error && <p className="text-destructive text-[13px]">{error}</p>}
      <Sheet open={editing} onClose={() => setEditing(false)} title="Editar noche">
        <NightForm editing={night} onDone={() => setEditing(false)} />
      </Sheet>
    </div>
  );
}

/** When you fell asleep and woke up, with the duration read back live, and an optional note. Mounts fresh each time the sheet opens. */
function NightForm({ editing, onDone }: { editing?: ManualDraft; onDone: () => void }) {
  const showNight = useShowNight();
  const [now] = useState(() => Date.now());
  const [start, setStart] = useState(() => {
    if (editing) return toInput(editing.start);
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    d.setHours(23, 0, 0, 0);
    return toInput(d.getTime());
  });
  const [end, setEnd] = useState(() => toInput(editing?.end ?? now));
  const [note, setNote] = useState(editing?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startMs = fromInput(start);
  const endMs = fromInput(end);
  const issue = problem(startMs, endMs, now);
  const minutes = issue ? null : (endMs - startMs) / 60_000;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (issue) return;
    setBusy(true);
    setError(null);
    const body = { start: startMs, end: endMs, tzOffsetMin: -new Date(startMs).getTimezoneOffset(), note: note.trim() || null };
    try {
      const saved = editing ? await send<ManualSleepNight>(`/api/web/sueno/noches/${editing.id}`, "PATCH", body) : await send<ManualSleepNight>("/api/web/sueno/noches", "POST", body);
      onDone();
      showNight(saved.night);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={save}>
      <p className="text-muted-foreground text-[14px] leading-relaxed">Para una noche que el reloj no midió. Si Salud la tiene medida, cuenta esa.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Me dormí">
          <input type="datetime-local" required value={start} max={toInput(now)} onChange={(e) => setStart(e.target.value)} className={cn(inputClass, "tabular")} />
        </Field>
        <Field label="Me desperté">
          <input type="datetime-local" required value={end} max={toInput(now)} onChange={(e) => setEnd(e.target.value)} className={cn(inputClass, "tabular")} />
        </Field>
      </div>

      <div className="bg-muted/50 rounded-2xl px-4 py-3.5" aria-live="polite">
        {minutes !== null ? (
          <>
            <p className="text-muted-foreground text-[12px] font-medium">Dormiste</p>
            <p className="tabular text-[26px] leading-tight font-semibold tracking-tight">{fmtMinutes(minutes)}</p>
            <p className="text-muted-foreground mt-0.5 text-[13px] first-letter:uppercase">Noche al {fmtLongDate(new Date(`${nightOf(startMs)}T12:00:00`))}</p>
          </>
        ) : (
          <p className="text-muted-foreground flex items-start gap-2 text-[14px] leading-relaxed">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            {issue}
          </p>
        )}
      </div>

      <Field label="Nota (opcional)">
        <textarea value={note} maxLength={NOTE_MAX} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="Por ejemplo: dejé el reloj cargando" className={cn(inputClass, "h-auto py-2.5")} />
      </Field>

      {error && <p className="text-destructive text-[13px]">{error}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={busy || issue !== null}>
          {busy ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </form>
  );
}
