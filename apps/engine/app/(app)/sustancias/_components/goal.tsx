"use client";

import { Minus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../../_ui/fields";
import { send } from "../../../_ui/send";

/** The person's own weekly limit for one substance, optional and never suggested. */
export function GoalEditor({ substanceId, max }: { substanceId: string; max: number | null }) {
  const router = useRouter();
  const [value, setValue] = useState(max ?? 2);
  const [error, setError] = useState<string | null>(null);
  const save = async (maxDaysPerWeek: number | null) => {
    setError(null);
    try {
      await send(`/api/web/sustancias/tipos/${substanceId}`, "PATCH", { maxDaysPerWeek });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="text-[14px]">Máximo</span>
        <span className="bg-muted inline-flex items-center rounded-full p-1">
          <button type="button" aria-label="Menos" onClick={() => setValue((v) => Math.max(0, v - 1))} className="hover:bg-card grid size-9 place-items-center rounded-full">
            <Minus className="size-4" />
          </button>
          <span className="tabular w-8 text-center text-[17px] font-semibold">{value}</span>
          <button type="button" aria-label="Más" onClick={() => setValue((v) => Math.min(7, v + 1))} className="hover:bg-card grid size-9 place-items-center rounded-full">
            <Plus className="size-4" />
          </button>
        </span>
        <span className="text-[14px]">{value === 1 ? "día por semana" : "días por semana"}</span>
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="primary" disabled={max === value} onClick={() => save(value)}>
          {max === null ? "Poner objetivo" : "Guardar"}
        </Button>
        {max !== null && (
          <Button variant="ghost" onClick={() => save(null)}>
            Quitar
          </Button>
        )}
      </div>
      {error && <p className="text-destructive mt-2 text-[13px]">{error}</p>}
    </div>
  );
}
