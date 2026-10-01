"use client";

import { CopyPlus, Pencil, Trash2 } from "lucide-react";
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
