"use client";

import type { PrepBatch, Recipe } from "@pulso/contract";
import { Check, ChefHat } from "lucide-react";
import { useState } from "react";
import { cn } from "../../../_ui/cn";
import { usePlanActions } from "./plan-actions";
import { Sheet } from "./sheet";
import { RecipeDetail } from "./slot-sheet";

function RecipeSheet({ recipe, prep, onClose }: { recipe: Recipe; prep: PrepBatch; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <Sheet
      open={open}
      onClose={() => {
        setOpen(false);
        onClose();
      }}
      title={recipe.name}
    >
      <p className="text-muted-foreground -mt-2 mb-5 text-[13px]">
        Batch de {prep.portions} porciones · {prep.eaten} comidas{prep.leftover > 0 && ` · ${prep.leftover} sin asignar`}
      </p>
      <RecipeDetail recipe={recipe} portions={prep.portions} />
    </Sheet>
  );
}

/**
 * A cooking session on its day: «Cocinar: Pollo con arroz ×4». The name opens
 * the recipe; «Ya lo cociné» marks the batch cooked (its ingredients leave the
 * list and the pantry), with «Deshacer» in the toast.
 */
export function PrepChip({ prep, recipe, today, compact = false }: { prep: PrepBatch; recipe: Recipe | null; today: string; compact?: boolean }) {
  const actions = usePlanActions();
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const cooked = prep.status === "cooked";
  return (
    <div className={cn("bg-energy/10 flex items-center gap-2 rounded-xl", compact ? "flex-col items-stretch p-2" : "min-h-12 py-1.5 pr-1.5 pl-3")}>
      <button
        type="button"
        onClick={() => recipe && setSheet(true)}
        disabled={!recipe}
        className="focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left outline-none focus-visible:ring-2"
        title={recipe ? "Ver receta" : undefined}
      >
        <ChefHat className={cn("text-energy size-4 shrink-0", compact && "self-start")} />
        {compact ? (
          <span className="min-w-0 flex-1 leading-tight">
            <span className="text-energy block text-[11px] font-semibold">
              {cooked ? "Cocinado" : "Cocinar"} <span className="tabular">×{prep.portions}</span>
            </span>
            <span className="line-clamp-2 text-[12.5px] font-medium">{prep.recipeName}</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
            {cooked ? "Cocinado" : "Cocinar"}: {prep.recipeName} <span className="text-muted-foreground tabular">×{prep.portions}</span>
          </span>
        )}
      </button>
      {cooked ? (
        <span className="text-body flex min-h-8 shrink-0 items-center justify-center gap-1 px-2 text-[12px] font-medium">
          <Check className="size-3.5" strokeWidth={2.6} />
          Hecho
        </span>
      ) : (
        prep.cookDate <= today && (
          <button
            onClick={async () => {
              setBusy(true);
              await actions.cooked(prep);
              setBusy(false);
            }}
            disabled={busy}
            className="bg-card hover:bg-muted focus-visible:ring-ring shadow-1 min-h-9 shrink-0 rounded-lg px-3 text-[12px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-50"
          >
            Ya lo cociné
          </button>
        )
      )}
      {sheet && recipe && <RecipeSheet recipe={recipe} prep={prep} onClose={() => setSheet(false)} />}
    </div>
  );
}
