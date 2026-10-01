"use client";

import { Check, CopyPlus, Pencil, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import type { DietaEntry } from "@/src/web/dieta";
import { cn } from "../../../_ui/cn";
import { useAction, useDieta } from "./client";
import { buttonPrimary, buttonSoft } from "./sheet";

function ErrorLine({ message }: { message: string | null }) {
  return message ? <p className="text-destructive mt-2 text-[12px]">{message}</p> : null;
}

/** Correct or delete one logged entry. Quiet until hovered on the desktop; delete asks once. */
export function EntryActions({ entry }: { entry: DietaEntry }) {
  const { register } = useDieta();
  const { run, pending, error } = useAction();
  const [sure, setSure] = useState(false);
  const icon = "text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring grid size-9 place-items-center rounded-lg outline-none focus-visible:ring-2";
  return (
    <span className="flex shrink-0 items-center gap-0.5 transition-opacity md:opacity-0 md:group-has-[:focus-visible]:opacity-100 md:group-hover:opacity-100">
      {sure ? (
        <button onClick={() => run(`meals/${entry.id}`, "DELETE")} disabled={pending} onBlur={() => setSure(false)} autoFocus className="bg-destructive text-background min-h-9 rounded-lg px-2.5 text-[12px] font-medium">
          Borrar
        </button>
      ) : (
        <>
          <button onClick={() => register(entry)} className={icon} aria-label={`Corregir ${entry.name}`} title="Corregir">
            <Pencil className="size-3.5" />
          </button>
          <button onClick={() => setSure(true)} className={cn(icon, "hover:text-destructive hover:bg-destructive/10")} aria-label={`Borrar ${entry.name}`} title="Borrar">
            <Trash2 className="size-3.5" />
          </button>
        </>
      )}
      {error && <span className="text-destructive text-[11px]">{error}</span>}
    </span>
  );
}

/** «Comí lo del plan»: logs every item of a plan meal not yet eaten. */
export function EatPlanButton({ itemIds, label = "Comí lo del plan", quiet = false }: { itemIds: string[]; label?: string; quiet?: boolean }) {
  const { date } = useDieta();
  const { run, pending, error } = useAction();
  return (
    <div>
      <button onClick={() => run("plan/eat", "POST", { itemIds, date })} disabled={pending || itemIds.length === 0} className={quiet ? buttonSoft : buttonPrimary}>
        <Check className="size-4" strokeWidth={2.4} />
        {label}
      </button>
      <ErrorLine message={error} />
    </div>
  );
}

/** One plan item's tick: eats it, or undoes the entry that ate it. */
export function PlanItemToggle({ itemId, entryId, name }: { itemId: string; entryId: string | null; name: string }) {
  const { date } = useDieta();
  const { run, pending } = useAction();
  const eaten = entryId !== null;
  return (
    <button
      onClick={() => (eaten ? run(`meals/${entryId}`, "DELETE") : run("plan/eat", "POST", { itemIds: [itemId], date }))}
      disabled={pending}
      aria-pressed={eaten}
      aria-label={eaten ? `Desmarcar ${name}` : `Marcar ${name} como comido`}
      className={cn(
        "focus-visible:ring-ring grid size-7 shrink-0 place-items-center rounded-full border-2 outline-none transition-colors focus-visible:ring-2",
        eaten ? "border-body bg-body text-background" : "border-border hover:border-body",
        pending && "opacity-50",
      )}
    >
      {eaten && <Check className="size-4" strokeWidth={3} />}
    </button>
  );
}

export function ClearAdjustment() {
  const { date } = useDieta();
  const { run, pending, error } = useAction();
  return (
    <div>
      <button onClick={() => run(`plan/adjustment?date=${date}`, "DELETE")} disabled={pending} className={buttonSoft}>
        <Undo2 className="size-4" />
        Volver al plan
      </button>
      <ErrorLine message={error} />
    </div>
  );
}

/** For an empty day: register something, or start from the day before. */
export function EmptyDayActions() {
  const { date, register } = useDieta();
  const { run, pending, error } = useAction();
  return (
    <div className="flex flex-col items-center">
      <div className="flex flex-wrap justify-center gap-2">
        <button onClick={() => run("meals/copy", "POST", { date })} disabled={pending} className={buttonSoft}>
          <CopyPlus className="size-4" />
          Copiar el día anterior
        </button>
        <button onClick={() => register()} className={buttonPrimary}>
          Registrar
        </button>
      </div>
      <ErrorLine message={error} />
    </div>
  );
}
