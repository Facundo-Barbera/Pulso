"use client";

import type { PersonalRecord, SessionSaved, WeightUnit } from "@pulso/contract";
import { Check, ChevronLeft, CornerDownRight, Minus, Plus, Timer, Trash2, Trophy, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatBoth, formatWeight, fromUnit, shown, toUnit } from "@/src/training/units";
import type { PlanDay } from "@/src/web/entreno";
import { volumeOf } from "@/src/training/segments";
import {
  addDrop,
  addSet,
  current,
  editDrop,
  editSet,
  MAX_DROPS,
  removeDrop,
  extendRest,
  removeSet,
  setsDone,
  setsTotal,
  skipRest,
  startSession,
  stepDropWeight,
  stepWeight,
  toggleSet,
  toSessionInput,
  unitOfExercise,
  volumeKg,
  type LiveState,
} from "@/src/web/entreno-live";
import { Card } from "../../../_ui/card";
import { cn } from "../../../_ui/cn";
import { EmptyState } from "../../../_ui/empty-state";
import { Skeleton } from "../../../_ui/skeleton";
import { saveLive, useLive } from "./live-store";
import { saveExerciseUnit, UnitSwitch } from "./units";

const fmt = (n: number, decimals = 2) => n.toLocaleString("es", { maximumFractionDigits: decimals });
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s % 60).padStart(2, "0")}`;
};

function useNow(active: boolean, every = 500) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [active, every]);
  return now;
}

/** A soft two-note chime when the rest ends. Silent if the browser refuses audio. */
function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.4);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch {}
}

type Saved = { saved: SessionSaved; state: LiveState };

/**
 * Logging a session at a desk. Each set is a row of three fields (load in
 * the exercise's unit, reps, RPE): ↑↓ adjust, Enter checks the set off and jumps to the next one, Esc
 * skips the rest. The session lives in localStorage until it is finished, then
 * goes to the same store the phone posts to.
 */
export function Logger({ days, programId, dayId, defaultUnit }: { days: PlanDay[]; programId: string | null; dayId: string | null; defaultUnit: WeightUnit }) {
  const [live, ready] = useLive();
  const [saved, setSaved] = useState<Saved | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const day = days.find((d) => d.id === dayId);

  // Nothing in progress and a day was asked for: start it.
  useEffect(() => {
    if (!ready || live || saved || !day || day.exercises.length === 0) return;
    saveLive(startSession(day, programId));
    // Drop ?dia so a reload resumes rather than starting the day again.
    router.replace("/entreno/sesion");
  }, [ready, live, saved, day, programId, router]);

  if (saved) return <Summary {...saved} defaultUnit={defaultUnit} />;
  if (!ready || (!live && day)) return <LoggerSkeleton />;
  if (!live) {
    return (
      <div className="pt-[calc(env(safe-area-inset-top)+20px)] md:pt-[calc(var(--titlebar-height)+12px)]">
        <Card>
          <EmptyState icon={Timer} color="var(--domain-training)" title="No hay ninguna sesión en curso" line="Elige un día en Entreno y pulsa «Empezar»." action={{ href: "/entreno", label: "Ir a Entreno" }} />
        </Card>
      </div>
    );
  }

  const update = (next: LiveState) => saveLive(next);

  const finish = async () => {
    if (setsDone(live) === 0) {
      if (confirm("No marcaste ninguna serie. ¿Descartar la sesión?")) discard(true);
      return;
    }
    setBusy(true);
    setError(null);
    const input = toSessionInput(live);
    const response = await fetch("/api/web/entreno/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setError("No se pudo guardar. Tus series siguen aquí: vuelve a intentarlo.");
      return;
    }
    setSaved({ saved: (await response.json()) as SessionSaved, state: live });
    saveLive(null);
    router.refresh();
  };

  const discard = (confirmed = false) => {
    if (!confirmed && !confirm("¿Descartar esta sesión? Se perderán las series marcadas.")) return;
    saveLive(null);
    router.push("/entreno");
  };

  return <LiveView live={live} update={update} finish={finish} discard={() => discard()} busy={busy} error={error} defaultUnit={defaultUnit} />;
}

function LiveView({ live, update, finish, discard, busy, error, defaultUnit }: { live: LiveState; update: (s: LiveState) => void; finish: () => void; discard: () => void; busy: boolean; error: string | null; defaultUnit: WeightUnit }) {
  const now = useNow(true);
  const resting = live.restEndsAt !== null && live.restEndsAt > now;
  const at = current(live);
  const fields = useRef(new Map<string, HTMLInputElement>());
  const wasResting = useRef(resting);

  useEffect(() => {
    if (wasResting.current && !resting && live.restEndsAt !== null) chime();
    wasResting.current = resting;
  }, [resting, live.restEndsAt]);

  // Esc skips the rest from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && resting) {
        e.preventDefault();
        update(skipRest(live));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resting, live, update]);

  // On arrival, the first open set's weight field has focus.
  useEffect(() => {
    if (at) fields.current.get(`${at.exercise}-${at.set}-kg`)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const check = (e: number, i: number) => {
    const done = live.exercises[e]!.sets[i]!.doneAt !== null;
    const next = toggleSet(live, e, i);
    update(next);
    const to = current(next);
    if (!done && to) requestAnimationFrame(() => fields.current.get(`${to.exercise}-${to.set}-kg`)?.focus());
  };

  const total = setsTotal(live);
  const done = setsDone(live);

  return (
    <>
      <header className="sticky top-0 z-10 -mx-5 flex flex-wrap items-center gap-x-4 gap-y-2 bg-[color-mix(in_oklab,var(--background)_88%,transparent)] px-5 pt-[calc(env(safe-area-inset-top)+12px)] pb-3 backdrop-blur-md md:-mx-10 md:px-10 md:pt-[calc(var(--titlebar-height)+4px)]">
        <Link href="/entreno" className="text-muted-foreground hover:text-foreground focus-visible:ring-ring app-no-drag -ml-1.5 flex min-h-10 items-center rounded-md pr-1 text-[14px] outline-none focus-visible:ring-2">
          <ChevronLeft className="size-4" /> Entreno
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[22px] font-semibold tracking-tight">{live.name}</h1>
          <p className="text-muted-foreground tabular text-[13px]">
            {clock(now - live.startedAt)} · {done}/{total} series · {fmt(Math.round(toUnit(volumeKg(live), defaultUnit)))} {defaultUnit}
          </p>
        </div>
        <div className="app-no-drag flex items-center gap-2">
          <button onClick={discard} className="text-muted-foreground hover:text-destructive hover:bg-muted focus-visible:ring-ring grid size-10 place-items-center rounded-full outline-none focus-visible:ring-2" aria-label="Descartar sesión" title="Descartar sesión">
            <Trash2 className="size-4" />
          </button>
          <button onClick={finish} disabled={busy} className="bg-training shadow-1 focus-visible:ring-ring min-h-10 rounded-full px-5 text-[14px] font-semibold text-white outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60">
            {busy ? "Guardando…" : "Terminar"}
          </button>
        </div>
        <div className="bg-muted h-1 w-full overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Series hechas">
          <div className="bg-training h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
      </header>

      {error && <p className="bg-destructive/10 text-destructive mt-3 rounded-xl px-4 py-3 text-[14px]" role="alert">{error}</p>}

      {resting && <RestBar live={live} now={now} update={update} />}

      <div className="mt-4 grid gap-5 xl:grid-cols-2">
        {live.exercises.map((ex, e) => {
          const unit = unitOfExercise(ex);
          const load = (ex.sets.find((s) => s.doneAt === null) ?? ex.sets.at(-1))?.weightKg ?? 0;
          return (
          <Card key={ex.id} as="article" delay={e * 40} className={cn(at?.exercise === e && "ring-training/50 ring-2")}>
            <div className="mb-3 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-[17px] font-semibold tracking-tight">{ex.name}</h2>
                <p className="text-muted-foreground tabular text-[13px]">
                  {ex.target} · descanso {clock(ex.restSeconds * 1000)}
                  {load > 0 && <span className="block text-[12px]">{formatBoth(load, unit)}</span>}
                </p>
                {ex.hint && <p className="text-training mt-1 text-[13px]">{ex.hint}</p>}
                {ex.notes && <p className="text-muted-foreground mt-1 text-[13px] italic">{ex.notes}</p>}
              </div>
              <UnitSwitch value={unit} label={`Unidad de ${ex.name}`} onChange={(next) => void saveExerciseUnit(ex.exerciseId, next).then((ok) => !ok && alert("No se pudo cambiar la unidad."))} />
            </div>
            <div role="table" aria-label={`Series de ${ex.name}`} className="text-[14px]">
              <div role="row" className="text-muted-foreground grid grid-cols-[28px_1fr_1fr_1fr_44px] gap-2 px-1 pb-1 text-[11px] font-medium tracking-wide uppercase">
                <span role="columnheader">#</span>
                <span role="columnheader">{unit}</span>
                <span role="columnheader">Reps</span>
                <span role="columnheader">RPE</span>
                <span role="columnheader" className="sr-only">Hecha</span>
              </div>
              {ex.sets.map((set, i) => {
                const isDone = set.doneAt !== null;
                const isCurrent = at?.exercise === e && at.set === i;
                const key = (f: string) => `${e}-${i}-${f}`;
                const ref = (f: string) => (el: HTMLInputElement | null) => {
                  if (el) fields.current.set(key(f), el);
                  else fields.current.delete(key(f));
                };
                const drops = set.drops ?? [];
                return (
                  // The set's editor is its row: while one of its fields has focus, "+ otro peso" shows under it.
                  <div key={i} role="rowgroup" className="group">
                  <div role="row" className={cn("grid grid-cols-[28px_1fr_1fr_1fr_44px] items-center gap-2 rounded-xl px-1 py-1", isCurrent && "bg-training/8", isDone && "text-muted-foreground")}>
                    <span role="cell" className="tabular text-center text-[13px] font-semibold">
                      {i + 1}
                    </span>
                    <NumberField
                      inputRef={ref("kg")}
                      label={`Serie ${i + 1}, ${unit}`}
                      value={shown(set.weightKg, unit)}
                      decimals={2}
                      onCommit={(v) => update(editSet(live, e, i, { weightKg: fromUnit(v ?? 0, unit) }))}
                      onStep={(d) => update(stepWeight(live, e, i, d))}
                      onEnter={() => check(e, i)}
                    />
                    <NumberField
                      inputRef={ref("reps")}
                      label={`Serie ${i + 1}, repeticiones`}
                      value={set.reps}
                      decimals={0}
                      onCommit={(v) => update(editSet(live, e, i, { reps: v ?? 0 }))}
                      onStep={(d) => update(editSet(live, e, i, { reps: set.reps + d }))}
                      onEnter={() => check(e, i)}
                    />
                    <NumberField
                      inputRef={ref("rpe")}
                      label={`Serie ${i + 1}, RPE`}
                      value={set.rpe}
                      decimals={1}
                      placeholder="—"
                      onCommit={(v) => update(editSet(live, e, i, { rpe: v }))}
                      onStep={(d) => update(editSet(live, e, i, { rpe: Math.round(((set.rpe ?? 7.5) + d * 0.5) * 2) / 2 }))}
                      onEnter={() => check(e, i)}
                    />
                    <span role="cell" className="flex justify-end">
                      <button
                        onClick={() => check(e, i)}
                        aria-pressed={isDone}
                        aria-label={isDone ? `Desmarcar serie ${i + 1}` : `Marcar serie ${i + 1}`}
                        className={cn(
                          "focus-visible:ring-ring grid size-10 place-items-center rounded-full outline-none focus-visible:ring-2 motion-safe:transition-colors",
                          isDone ? "bg-training text-white" : "bg-muted hover:bg-training/20 text-muted-foreground",
                        )}
                      >
                        <Check className="size-4" strokeWidth={2.6} />
                      </button>
                    </span>
                  </div>
                  {drops.map((drop, d) => (
                    <div key={d} role="row" className={cn("grid grid-cols-[28px_1fr_1fr_1fr_44px] items-center gap-2 px-1 py-0.5", isDone && "text-muted-foreground")}>
                      <span role="cell" className="text-training grid place-items-center">
                        <CornerDownRight className="size-3.5" aria-hidden />
                      </span>
                      <NumberField
                        inputRef={ref(`drop-${d}-kg`)}
                        label={`Serie ${i + 1}, bajó a, ${unit}`}
                        value={shown(drop.weightKg, unit)}
                        decimals={2}
                        onCommit={(v) => update(editDrop(live, e, i, d, { weightKg: fromUnit(v ?? 0, unit) }))}
                        onStep={(dir) => update(stepDropWeight(live, e, i, d, dir))}
                        onEnter={() => !isDone && check(e, i)}
                      />
                      <NumberField
                        inputRef={ref(`drop-${d}-reps`)}
                        label={`Serie ${i + 1}, repeticiones después de bajar`}
                        value={drop.reps}
                        decimals={0}
                        onCommit={(v) => update(editDrop(live, e, i, d, { reps: v ?? 1 }))}
                        onStep={(dir) => update(editDrop(live, e, i, d, { reps: drop.reps + dir }))}
                        onEnter={() => !isDone && check(e, i)}
                      />
                      <span role="cell" />
                      <span role="cell" className="flex justify-end">
                        <button
                          onClick={() => update(removeDrop(live, e, i, d))}
                          aria-label={`Quitar este peso de la serie ${i + 1}`}
                          className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring grid size-10 place-items-center rounded-full outline-none focus-visible:ring-2"
                        >
                          <X className="size-4" />
                        </button>
                      </span>
                    </div>
                  ))}
                  {drops.length < MAX_DROPS && (
                    <div role="row" className="hidden grid-cols-[28px_1fr] gap-2 px-1 group-focus-within:grid">
                      <span role="cell" className="col-start-2">
                        <button
                          // Keeps focus in the row (Safari doesn't focus a clicked button), so the row stays open.
                          onMouseDown={(ev) => ev.preventDefault()}
                          onClick={() => {
                            update(addDrop(live, e, i));
                            requestAnimationFrame(() => fields.current.get(key(`drop-${drops.length}-kg`))?.focus());
                          }}
                          className="text-training hover:bg-training/10 focus-visible:ring-ring flex min-h-8 items-center gap-1 rounded-full px-2 text-[12px] font-medium outline-none focus-visible:ring-2"
                        >
                          <Plus className="size-3.5" /> otro peso
                        </button>
                      </span>
                    </div>
                  )}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex gap-1">
              <button onClick={() => update(addSet(live, e))} className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring flex min-h-9 items-center gap-1 rounded-full px-3 text-[13px] outline-none focus-visible:ring-2">
                <Plus className="size-3.5" /> Serie
              </button>
              {ex.sets.length > 1 && ex.sets.at(-1)!.doneAt === null && (
                <button onClick={() => update(removeSet(live, e, ex.sets.length - 1))} className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring flex min-h-9 items-center gap-1 rounded-full px-3 text-[13px] outline-none focus-visible:ring-2">
                  <Minus className="size-3.5" /> Quitar
                </button>
              )}
            </div>
          </Card>
          );
        })}
      </div>
      <p className="text-muted-foreground mt-6 hidden text-center text-[12px] md:block">
        <Kbd>Enter</Kbd> marca la serie · <Kbd>↑</Kbd> <Kbd>↓</Kbd> ajustan · <Kbd>Tab</Kbd> pasa al campo siguiente · <Kbd>Esc</Kbd> salta el descanso
      </p>
    </>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="bg-muted rounded px-1.5 py-0.5 font-sans text-[11px]">{children}</kbd>;
}

function RestBar({ live, now, update }: { live: LiveState; now: number; update: (s: LiveState) => void }) {
  const left = live.restEndsAt! - now;
  const span = live.restEndsAt! - (live.restStartedAt ?? now);
  return (
    <div className="bg-card shadow-2 sticky top-[calc(var(--titlebar-height,0px)+96px)] z-10 mt-3 flex items-center gap-4 rounded-[18px] px-5 py-3 motion-safe:animate-[pulso-rise_300ms_cubic-bezier(.2,.7,.2,1)_both]" role="timer" aria-live="off">
      <Timer className="text-training size-5" />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="tabular text-[24px] leading-none font-semibold">{clock(left)}</span>
          <span className="text-muted-foreground text-[13px]">descanso</span>
        </p>
        <div className="bg-muted mt-2 h-1 overflow-hidden rounded-full">
          <div className="bg-training h-full rounded-full" style={{ width: `${span > 0 ? Math.max(0, Math.min(1, left / span)) * 100 : 0}%` }} />
        </div>
      </div>
      <button onClick={() => update(extendRest(live, 30))} className="hover:bg-muted focus-visible:ring-ring tabular min-h-10 rounded-full px-3 text-[14px] font-medium outline-none focus-visible:ring-2">
        +30 s
      </button>
      <button onClick={() => update(skipRest(live))} className="bg-muted hover:bg-muted/70 focus-visible:ring-ring min-h-10 rounded-full px-4 text-[14px] font-medium outline-none focus-visible:ring-2">
        Saltar
      </button>
    </div>
  );
}

/**
 * A number typed the Spanish way ("62,5"). Text, not `type=number`: the comma
 * stays, and ↑↓ go through `onStep` so loads land on the exercise's increment.
 */
function NumberField({ value, decimals, label, placeholder, inputRef, onCommit, onStep, onEnter }: { value: number | null; decimals: number; label: string; placeholder?: string; inputRef: (el: HTMLInputElement | null) => void; onCommit: (v: number | null) => void; onStep: (dir: number) => void; onEnter: () => void }) {
  const shown = value === null ? "" : value.toLocaleString("es", { maximumFractionDigits: decimals, useGrouping: false });
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <span role="cell">
      <input
        ref={inputRef}
        type="text"
        inputMode={decimals ? "decimal" : "numeric"}
        aria-label={label}
        placeholder={placeholder}
        value={draft ?? shown}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          const n = Number(text.replace(",", "."));
          if (text.trim() === "") onCommit(null);
          else if (Number.isFinite(n)) onCommit(n);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            setDraft(null);
            onStep(e.key === "ArrowUp" ? 1 : -1);
          } else if (e.key === "Enter") {
            e.preventDefault();
            setDraft(null);
            onEnter();
          }
        }}
        className="bg-muted/70 focus-visible:ring-ring tabular h-10 w-full min-w-0 rounded-lg px-3 text-center text-[15px] font-medium outline-none focus-visible:ring-2"
      />
    </span>
  );
}

const RECORD_ES: Record<PersonalRecord["kind"], string> = { e1rm: "1RM estimado", weight: "Peso máximo", reps: "Más repeticiones" };

function Summary({ saved, state, defaultUnit }: Saved & { defaultUnit: WeightUnit }) {
  const { session, prs } = saved;
  const volume = session.sets.reduce((n, s) => n + volumeOf(s), 0);
  const unitOf = (exerciseId: string) => {
    const ex = state.exercises.find((e) => e.exerciseId === exerciseId);
    return ex ? unitOfExercise(ex) : defaultUnit;
  };
  return (
    <div className="pt-[calc(env(safe-area-inset-top)+20px)] md:pt-[calc(var(--titlebar-height)+12px)]">
      <Card className="relative overflow-hidden !p-8 text-center">
        <div className="pointer-events-none absolute -top-28 left-1/2 size-72 -translate-x-1/2 rounded-full opacity-20 blur-3xl" style={{ background: "var(--domain-training)" }} aria-hidden />
        <div className="relative">
          <span className="bg-training mx-auto grid size-14 place-items-center rounded-full text-white motion-safe:animate-[pulso-rise_420ms_cubic-bezier(.2,.7,.2,1)_both]">
            <Check className="size-7" strokeWidth={2.6} />
          </span>
          <h1 className="mt-4 text-[28px] font-semibold tracking-tight">Sesión guardada</h1>
          <p className="text-muted-foreground mt-1 text-[15px]">{state.name}</p>
          <div className="mx-auto mt-6 grid max-w-md grid-cols-3 gap-4">
            <Figure label="Duración" value={clock(session.endedAt - session.startedAt)} />
            <Figure label="Series" value={String(session.sets.length)} />
            <Figure label="Volumen" value={`${fmt(Math.round(toUnit(volume, defaultUnit)))} ${defaultUnit}`} />
          </div>
          {prs.length > 0 && (
            <ul className="mx-auto mt-8 max-w-md space-y-2 text-left">
              {prs.map((pr) => (
                <li key={`${pr.exerciseId}-${pr.kind}`} className="bg-carbs/12 flex items-center gap-3 rounded-2xl px-4 py-3">
                  <Trophy className="text-carbs size-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold">{pr.exerciseName}</span>
                    <span className="text-muted-foreground text-[12px]">{RECORD_ES[pr.kind]}</span>
                  </span>
                  <span className="tabular text-right text-[14px] font-semibold">
                    {pr.kind === "reps" ? `${pr.value} reps` : formatWeight(pr.value, unitOf(pr.exerciseId))}
                    {pr.previous !== null && <span className="text-muted-foreground block text-[11px] font-normal">antes {pr.kind === "reps" ? pr.previous : formatWeight(pr.previous, unitOf(pr.exerciseId))}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/entreno" className="bg-training focus-visible:ring-ring mt-8 inline-flex min-h-11 items-center rounded-full px-6 text-[15px] font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-offset-2">
            Volver a Entreno
          </Link>
        </div>
      </Card>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="tabular text-[22px] font-semibold">{value}</p>
      <p className="text-muted-foreground text-[12px]">{label}</p>
    </div>
  );
}

function LoggerSkeleton() {
  return (
    <div className="pt-[calc(env(safe-area-inset-top)+20px)] md:pt-[calc(var(--titlebar-height)+12px)]">
      <Skeleton className="mb-2 h-7 w-56" />
      <Skeleton className="mb-6 h-4 w-40" />
      <div className="grid gap-5 xl:grid-cols-2">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-64 rounded-[18px]" />
        ))}
      </div>
    </div>
  );
}
