"use client";

import { Check, ExternalLink, Lightbulb, ListOrdered, NotebookPen, Trophy, WifiOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ExerciseView } from "@/src/web/entreno";
import { cn } from "../../../_ui/cn";
import { Skeleton } from "../../../_ui/skeleton";
import { Sparkline } from "../../../_ui/sparkline";
import { StatTile } from "../../../_ui/stat-tile";
import { MuscleMap } from "./body-map";
import { Thumb } from "./thumb";

const kg = (n: number) => n.toLocaleString("es", { maximumFractionDigits: 1 });
const day = (at: number) => new Date(at).toLocaleDateString("es", { day: "numeric", month: "short" });

/**
 * One exercise, as a side panel over the plan: Guía (the looping
 * demonstration, muscles, technique, videos, the person's notes) and
 * Rendimiento (records and the e1RM trend). A native <dialog>: Esc closes it
 * and focus stays inside.
 */
export function ExerciseSheet({ exerciseId, name, canEdit, onClose }: { exerciseId: string | null; name?: string; canEdit: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<ExerciseView | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<"guide" | "performance">("guide");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (exerciseId && !dialog.open) dialog.showModal();
    if (!exerciseId && dialog.open) dialog.close();
  }, [exerciseId]);

  useEffect(() => {
    if (!exerciseId) return;
    let live = true;
    setView(null);
    setFailed(false);
    setTab("guide");
    fetch(`/api/web/entreno/exercises/${encodeURIComponent(exerciseId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<ExerciseView>) : Promise.reject()))
      .then((v) => live && setView(v))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [exerciseId]);

  const detail = view?.detail;
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={detail?.name ?? name ?? "Ejercicio"}
      className="bg-card text-card-foreground shadow-3 m-0 mt-auto h-[92dvh] max-h-none w-full max-w-none rounded-t-[22px] p-0 backdrop:bg-black/40 backdrop:backdrop-blur-[2px] open:motion-safe:animate-[pulso-rise_320ms_cubic-bezier(.2,.7,.2,1)_both] md:mt-0 md:ml-auto md:h-dvh md:w-[min(520px,100vw)] md:rounded-none md:rounded-l-[22px]"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start gap-3 px-6 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <p className="text-training text-[12px] font-semibold tracking-wide uppercase">Ejercicio</p>
            <h2 className="mt-0.5 text-[22px] leading-tight font-semibold tracking-tight">{detail?.name ?? name ?? "…"}</h2>
            {detail?.nameEn && <p className="text-muted-foreground text-[13px]">{detail.nameEn}</p>}
          </div>
          <button onClick={onClose} className="hover:bg-muted focus-visible:ring-ring -mr-2 grid size-10 place-items-center rounded-full outline-none focus-visible:ring-2" aria-label="Cerrar">
            <X className="size-5" />
          </button>
        </header>
        <div role="tablist" aria-label="Sección" className="bg-muted mx-6 mb-2 grid grid-cols-2 rounded-full p-1 text-[13px] font-medium">
          {(["guide", "performance"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn("focus-visible:ring-ring min-h-8 rounded-full outline-none focus-visible:ring-2", tab === t ? "bg-card shadow-1" : "text-muted-foreground")}
            >
              {t === "guide" ? "Guía" : "Rendimiento"}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-6 pt-3 pb-10">
          {failed ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 py-16 text-center text-[14px]">
              <WifiOff className="size-6" />
              No se pudo cargar este ejercicio.
            </div>
          ) : !view ? (
            <div className="space-y-4">
              <Skeleton className="aspect-square w-full rounded-2xl" />
              <Skeleton className="h-40 w-full rounded-2xl" />
            </div>
          ) : tab === "guide" ? (
            <Guide view={view} canEdit={canEdit} />
          ) : (
            <Performance view={view} />
          )}
        </div>
      </div>
    </dialog>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Check; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h3 className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
        <Icon className="text-training size-4" strokeWidth={2.2} />
        {title}
      </h3>
      {children}
    </section>
  );
}

function Guide({ view, canEdit }: { view: ExerciseView; canEdit: boolean }) {
  const { detail } = view;
  return (
    <>
      {detail.media.animation && (
        <figure>
          <Thumb src={detail.media.animation} alt={`Demostración: ${detail.name}`} className="aspect-square w-full rounded-2xl" />
          {detail.media.attribution && <figcaption className="text-muted-foreground mt-1.5 text-[11px]">{detail.media.attribution}</figcaption>}
        </figure>
      )}
      {(detail.primaryMuscles.length > 0 || detail.secondaryMuscles.length > 0) && (
        <section className={cn(detail.media.animation && "mt-7")}>
          <MuscleMap primary={detail.primaryMuscles} secondary={detail.secondaryMuscles} />
        </section>
      )}
      {detail.instructions.length > 0 && (
        <Section icon={ListOrdered} title="Cómo se hace">
          <ol className="space-y-2.5 text-[14px] leading-relaxed">
            {detail.instructions.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="bg-training/15 text-training tabular grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </Section>
      )}
      {detail.tips.length > 0 && (
        <Section icon={Lightbulb} title="Claves">
          <ul className="flex flex-wrap gap-2">
            {detail.tips.map((tip) => (
              <li key={tip} className="bg-muted rounded-full px-3 py-1.5 text-[13px]">
                {tip}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {detail.videos.length > 0 && (
        <Section icon={ExternalLink} title="Vídeos de técnica">
          <ul className="space-y-1">
            {detail.videos.map((v) => (
              <li key={v.youtubeId}>
                <a
                  href={`https://www.youtube.com/watch?v=${v.youtubeId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:bg-muted focus-visible:ring-ring -mx-2 flex min-h-11 items-center gap-3 rounded-xl px-2 outline-none focus-visible:ring-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{v.title}</span>
                    <span className="text-muted-foreground text-[12px]">
                      {v.channel} · {v.lang === "es" ? "español" : "inglés"}
                    </span>
                  </span>
                  <ExternalLink className="text-muted-foreground size-4" />
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section icon={NotebookPen} title="Tus notas">
        <Notes exerciseId={detail.id} initial={detail.notes} canEdit={canEdit} />
      </Section>
    </>
  );
}

function Notes({ exerciseId, initial, canEdit }: { exerciseId: string; initial: string | null; canEdit: boolean }) {
  const [text, setText] = useState(initial ?? "");
  const [saved, setSaved] = useState(initial ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  if (!canEdit) return <p className="text-muted-foreground text-[14px] whitespace-pre-wrap">{initial || "Sin notas."}</p>;
  const save = async () => {
    if (text.trim() === saved.trim()) return;
    setState("saving");
    const r = await fetch(`/api/web/entreno/exercises/${encodeURIComponent(exerciseId)}/notes`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ notes: text }) }).catch(() => null);
    if (!r?.ok) return setState("error");
    const { notes } = (await r.json()) as { notes: string | null };
    setSaved(notes ?? "");
    setState("saved");
  };
  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setState("idle");
        }}
        onBlur={save}
        rows={3}
        maxLength={4000}
        placeholder="Agarre, ajustes de la máquina, sensaciones…"
        className="bg-muted/60 focus-visible:ring-ring w-full resize-y rounded-xl p-3 text-[14px] leading-relaxed outline-none focus-visible:ring-2"
      />
      <p className={cn("mt-1 h-4 text-[12px]", state === "error" ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
        {state === "saving" ? "Guardando…" : state === "saved" ? "Guardado" : state === "error" ? "No se pudo guardar." : ""}
      </p>
    </div>
  );
}

function Performance({ view }: { view: ExerciseView }) {
  const p = view.performance;
  if (!p || p.history.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <span className="bg-training/15 text-training grid size-14 place-items-center rounded-2xl">
          <Trophy className="size-6" strokeWidth={1.8} />
        </span>
        <p className="font-semibold">Aún sin registros</p>
        <p className="text-muted-foreground max-w-xs text-[14px]">Cuando registres series de este ejercicio verás aquí tus récords y su progreso.</p>
      </div>
    );
  }
  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <StatTile label="Peso máximo" value={p.maxWeight ? kg(p.maxWeight.kg) : "—"} unit="kg" caption={p.maxWeight ? `× ${p.maxWeight.reps} · ${day(p.maxWeight.at)}` : undefined} />
        <StatTile label="1RM estimado" value={p.bestE1rm ? kg(p.bestE1rm.kg) : "—"} unit="kg" caption={p.bestE1rm ? day(p.bestE1rm.at) : undefined} color="var(--domain-training)" />
        <StatTile label="Volumen" value={p.maxVolume ? kg(p.maxVolume.kg) : "—"} unit="kg" caption={p.maxVolume ? day(p.maxVolume.at) : undefined} />
      </div>
      <div className="bg-muted/50 mt-6 rounded-2xl p-4">
        <p className="text-muted-foreground mb-3 text-[12px] font-medium">1RM estimado por sesión</p>
        <Sparkline points={p.history.map((h) => ({ label: day(h.at), value: h.e1rm || null }))} color="var(--domain-training)" unit="kg" decimals={1} height={96} label="1RM estimado por sesión" />
      </div>
      <ul className="mt-6 space-y-2 text-[14px]">
        {[...p.history].reverse().slice(0, 8).map((h) => (
          <li key={h.at} className="flex justify-between">
            <span className="text-muted-foreground">{day(h.at)}</span>
            <span className="tabular">
              {kg(h.topWeightKg)} kg · {kg(h.volumeKg)} kg vol.
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
