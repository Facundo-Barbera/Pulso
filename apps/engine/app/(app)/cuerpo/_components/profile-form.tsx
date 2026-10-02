"use client";

import type { Profile } from "@pulso/contract";
import { Cake, Check, Dumbbell, Pencil, Ruler, Target, UserRound, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "../../../_ui/cn";
import { Segmented } from "../../../_ui/fields";
import { inputClass, primaryButton, problem, quietButton } from "./metrics";

type Draft = { age: string; sex: string; heightCm: string; goals: string; experience: string };

const draftOf = (p: Profile): Draft => ({
  age: p.age?.toString() ?? "",
  sex: p.sex ?? "",
  heightCm: p.heightCm?.toString().replace(".", ",") ?? "",
  goals: p.goals ?? "",
  experience: p.experience ?? "",
});

const num = (text: string) => (text.trim() ? Number(text.replace(",", ".")) : null);

const SEX: Record<string, string> = { male: "Hombre", female: "Mujer", other: "Otro" };

const FIELDS: { key: keyof Draft; label: string; icon: LucideIcon; show: (d: Draft) => string }[] = [
  { key: "age", label: "Edad", icon: Cake, show: (d) => d.age && `${d.age} años` },
  { key: "heightCm", label: "Altura", icon: Ruler, show: (d) => d.heightCm && `${d.heightCm} cm` },
  { key: "sex", label: "Sexo", icon: UserRound, show: (d) => SEX[d.sex] ?? "" },
  { key: "goals", label: "Objetivos", icon: Target, show: (d) => d.goals },
  { key: "experience", label: "Actividad y experiencia", icon: Dumbbell, show: (d) => d.experience },
];

function Icon({ icon: I }: { icon: LucideIcon }) {
  return (
    <span className="bg-muted text-muted-foreground grid size-8 shrink-0 place-items-center rounded-lg">
      <I className="size-4" strokeWidth={2} aria-hidden />
    </span>
  );
}

/**
 * The profile fields that describe the body, read first with an Editar
 * button. The Coach reads the same profile, so an edit here is an edit there;
 * height and sex also set the standards the analysis compares with.
 */
export function ProfileForm({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [saved, setSaved] = useState(() => draftOf(profile));
  const [draft, setDraft] = useState(saved);
  const [editing, setEditing] = useState(() => FIELDS.every((f) => !saved[f.key]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const dirty = (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k] !== saved[k]);
  const set = (key: keyof Draft) => (value: string) => setDraft({ ...draft, [key]: value });
  const input = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key)(e.target.value);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Only what changed; a cleared field is null, which removes it.
    const patch: Record<string, unknown> = {};
    for (const k of Object.keys(draft) as (keyof Draft)[]) {
      if (draft[k] === saved[k]) continue;
      const text = draft[k].trim();
      patch[k] = k === "age" || k === "heightCm" ? num(text) : text || null;
    }
    const response = await fetch("/api/web/cuerpo/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    setBusy(false);
    if (!response.ok) return setError(await problem(response));
    const next = draftOf((await response.json()) as Profile);
    setSaved(next);
    setDraft(next);
    setEditing(false);
    setDone(true);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="@container">
        <dl className="grid gap-x-6 gap-y-4 @lg:grid-cols-3 @3xl:grid-cols-5">
          {FIELDS.map((f) => {
            const value = f.show(saved);
            return (
              <div key={f.key} className={cn("flex min-w-0 gap-3", (f.key === "goals" || f.key === "experience") && "@lg:col-span-3 @3xl:col-span-1")}>
                <Icon icon={f.icon} />
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-[12px] font-medium">{f.label}</dt>
                  <dd className={cn("mt-0.5 text-[14px] leading-snug", value ? "font-medium" : "text-muted-foreground")}>{value || "Sin completar"}</dd>
                </div>
              </div>
            );
          })}
        </dl>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => (setDone(false), setEditing(true))} className={quietButton}>
            <Pencil className="size-4" /> Editar
          </button>
          {done ? (
            <span className="text-good flex items-center gap-1 text-[13px] font-medium" aria-live="polite">
              <Check className="size-4" /> Guardado
            </span>
          ) : (
            <span className="text-muted-foreground text-[12px]">El Coach lo usa para tus metas y planes; altura y sexo fijan tus rangos.</span>
          )}
        </div>
      </div>
    );
  }

  const label = (f: (typeof FIELDS)[number], control: React.ReactNode) => (
    <label className="flex min-w-0 gap-3">
      <span className="pt-6">
        <Icon icon={f.icon} />
      </span>
      <span className="block min-w-0 flex-1">
        <span className="text-muted-foreground text-[12px] font-medium">{f.label}</span>
        {control}
      </span>
    </label>
  );
  const [age, height, sex, goals, experience] = FIELDS as [(typeof FIELDS)[number], (typeof FIELDS)[number], (typeof FIELDS)[number], (typeof FIELDS)[number], (typeof FIELDS)[number]];

  return (
    <form onSubmit={submit} className="@container">
      <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] @3xl:gap-6">
        <div className="grid content-start gap-3 @md:grid-cols-2 @3xl:grid-cols-1">
          {label(age, <input inputMode="numeric" value={draft.age} onChange={input("age")} placeholder="años" className={cn(inputClass, "mt-1")} />)}
          {label(height, <input inputMode="decimal" value={draft.heightCm} onChange={input("heightCm")} placeholder="cm" className={cn(inputClass, "mt-1")} />)}
          <div className="flex min-w-0 gap-3 @md:col-span-2 @3xl:col-span-1">
            <span className="pt-6">
              <Icon icon={sex.icon} />
            </span>
            <div className="min-w-0 flex-1">
              <span className="text-muted-foreground text-[12px] font-medium">{sex.label}</span>
              <Segmented
                label="Sexo"
                value={draft.sex}
                onChange={set("sex")}
                options={[
                  { value: "male", label: "Hombre" },
                  { value: "female", label: "Mujer" },
                  { value: "other", label: "Otro" },
                ]}
                className="mt-1 w-full"
              />
            </div>
          </div>
        </div>
        <div className="grid gap-3 @xl:grid-cols-2">
          {label(goals, <textarea value={draft.goals} onChange={input("goals")} rows={3} maxLength={2000} placeholder="Qué quieres conseguir, con tus palabras" className={cn(inputClass, "mt-1 resize-y py-2.5 leading-relaxed")} />)}
          {label(experience, <textarea value={draft.experience} onChange={input("experience")} rows={3} maxLength={2000} placeholder="Cuánto te mueves y desde cuándo entrenas" className={cn(inputClass, "mt-1 resize-y py-2.5 leading-relaxed")} />)}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={!dirty || busy} className={primaryButton}>
          {busy ? "Guardando…" : "Guardar perfil"}
        </button>
        <button type="button" onClick={() => (setDraft(saved), setError(null), setEditing(false))} className="text-muted-foreground hover:text-foreground min-h-10 px-2 text-[13px]">
          Cancelar
        </button>
      </div>
      {error && <p className="text-destructive mt-3 text-[13px]">{error}</p>}
    </form>
  );
}
