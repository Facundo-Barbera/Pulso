"use client";

import type { Profile } from "@pulso/contract";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "../../../_ui/cn";
import { inputClass, primaryButton, problem } from "./metrics";

type Draft = { age: string; sex: string; heightCm: string; goals: string; experience: string };

const draftOf = (p: Profile): Draft => ({
  age: p.age?.toString() ?? "",
  sex: p.sex ?? "",
  heightCm: p.heightCm?.toString().replace(".", ",") ?? "",
  goals: p.goals ?? "",
  experience: p.experience ?? "",
});

const num = (text: string) => (text.trim() ? Number(text.replace(",", ".")) : null);

/** The profile fields that describe the body. The Coach reads the same profile, so an edit here is an edit there. */
export function ProfileForm({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [saved, setSaved] = useState(() => draftOf(profile));
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const dirty = (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k] !== saved[k]);
  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setDone(false);
    setDraft({ ...draft, [key]: e.target.value });
  };

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
    setDone(true);
    router.refresh();
  }

  const actions = (
    <>
      <button type="submit" disabled={!dirty || busy} className={primaryButton}>
        {busy ? "Guardando…" : "Guardar perfil"}
      </button>
      {done && !dirty ? (
        <span className="text-success flex items-center gap-1 text-[13px] font-medium" aria-live="polite">
          <Check className="size-4" /> Guardado
        </span>
      ) : (
        <span className="text-muted-foreground text-[12px]">El Coach lo usa para tus metas y planes.</span>
      )}
    </>
  );

  return (
    <form onSubmit={submit} className="@container">
      <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] @3xl:gap-6">
        <div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block min-w-0">
              <span className="text-muted-foreground text-[12px] font-medium">Edad</span>
              <input inputMode="numeric" value={draft.age} onChange={set("age")} placeholder="años" className={cn(inputClass, "mt-1")} />
            </label>
            <label className="block min-w-0">
              <span className="text-muted-foreground text-[12px] font-medium">Altura</span>
              <input inputMode="decimal" value={draft.heightCm} onChange={set("heightCm")} placeholder="cm" className={cn(inputClass, "mt-1")} />
            </label>
            <label className="block min-w-0">
              <span className="text-muted-foreground text-[12px] font-medium">Sexo</span>
              <select value={draft.sex} onChange={set("sex")} className={cn(inputClass, "mt-1 appearance-none")}>
                <option value="">—</option>
                <option value="male">Hombre</option>
                <option value="female">Mujer</option>
                <option value="other">Otro</option>
              </select>
            </label>
          </div>
          <div className="mt-4 hidden items-center gap-3 @3xl:flex">{actions}</div>
        </div>
        <div className="grid gap-3 @xl:grid-cols-2">
          <label className="block">
            <span className="text-muted-foreground text-[12px] font-medium">Objetivos</span>
            <textarea value={draft.goals} onChange={set("goals")} rows={3} maxLength={2000} placeholder="Qué quieres conseguir, con tus palabras" className={cn(inputClass, "mt-1 resize-y py-2.5 leading-relaxed")} />
          </label>
          <label className="block">
            <span className="text-muted-foreground text-[12px] font-medium">Actividad y experiencia</span>
            <textarea value={draft.experience} onChange={set("experience")} rows={3} maxLength={2000} placeholder="Cuánto te mueves y desde cuándo entrenas" className={cn(inputClass, "mt-1 resize-y py-2.5 leading-relaxed")} />
          </label>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3 @3xl:hidden">{actions}</div>
      {error && <p className="text-destructive mt-3 text-[13px]">{error}</p>}
    </form>
  );
}
