"use client";

import type { DishRef, Recipe } from "@pulso/contract";
import { BookmarkCheck, BookmarkPlus, CopyPlus, Pencil, Plus, Trash2 } from "lucide-react";
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

/** Under a dish's components: add one, or keep the dish in Mis platillos to log it again in one tap. */
export function DishActions({ dish }: { dish: DishRef }) {
  const { register } = useDieta();
  const { run, pending, error } = useAction();
  const quiet = "text-muted-foreground hover:text-foreground hover:bg-muted flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium";
  return (
    <div className="flex flex-wrap items-center gap-1 py-1">
      <button onClick={() => register(undefined, undefined, dish)} className={quiet}>
        <Plus className="size-3.5" />
        Añadir ingrediente
      </button>
      {dish.savedDishId ? (
        <span className="text-muted-foreground flex min-h-9 items-center gap-1.5 px-2 text-[12.5px]">
          <BookmarkCheck className="size-3.5" />
          En Mis platillos
        </span>
      ) : (
        <button onClick={() => run("dishes", "POST", { loggedDishId: dish.id })} disabled={pending} className={quiet}>
          <BookmarkPlus className="size-3.5" />
          Guardar como platillo
        </button>
      )}
      <ErrorLine message={error} />
    </div>
  );
}

/** A plan recipe as a saved dish (one portion), so it can be logged in one tap any day. */
export function SaveRecipeAsDish({ recipe }: { recipe: Recipe }) {
  const { dishes } = useDieta();
  const { run, pending, error } = useAction();
  if (dishes.some((d) => d.recipeId === recipe.id)) {
    return (
      <p className="text-muted-foreground flex items-center gap-1.5 text-[12.5px]">
        <BookmarkCheck className="size-3.5" />
        En Mis platillos
      </p>
    );
  }
  return (
    <div>
      <button onClick={() => run("dishes", "POST", { recipeId: recipe.id })} disabled={pending} className={buttonSoft}>
        <BookmarkPlus className="size-4" />
        Guardar como platillo
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
