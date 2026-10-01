"use client";

import type { WeightUnit } from "@pulso/contract";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LIVE_KEY, parseLive, setUnit } from "@/src/web/entreno-live";
import { cn } from "../../../_ui/cn";
import { send } from "../../../_ui/send";
import { saveLive } from "./live-store";

const UNITS: WeightUnit[] = ["kg", "lb"];

/** A compact kg | lb switch. */
export function UnitSwitch({ value, onChange, label, disabled }: { value: WeightUnit; onChange: (unit: WeightUnit) => void; label: string; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} title={label} className="bg-muted/70 inline-flex shrink-0 rounded-full p-0.5">
      {UNITS.map((unit) => (
        <button
          key={unit}
          type="button"
          role="radio"
          aria-checked={value === unit}
          disabled={disabled}
          onClick={() => value !== unit && onChange(unit)}
          className={cn(
            "focus-visible:ring-ring min-h-7 min-w-9 rounded-full px-2 text-[12px] font-semibold outline-none focus-visible:ring-2 motion-safe:transition-colors disabled:opacity-60",
            value === unit ? "bg-card text-foreground shadow-1" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {unit}
        </button>
      ))}
    </div>
  );
}

/**
 * Saves an exercise's unit on the engine (it belongs to the machine, so it
 * sticks) and moves the session in progress in this browser to it. Resolves
 * false when the engine refused.
 */
export async function saveExerciseUnit(exerciseId: string, unit: WeightUnit): Promise<boolean> {
  try {
    await send(`/api/web/entreno/exercises/${encodeURIComponent(exerciseId)}/unit`, "PUT", { unit });
  } catch {
    return false;
  }
  const live = parseLive(localStorage.getItem(LIVE_KEY));
  if (live?.exercises.some((e) => e.exerciseId === exerciseId)) saveLive(setUnit(live, exerciseId, unit));
  return true;
}

/** «Unidad por defecto»: for totals and for exercises without a unit of their own. */
export function DefaultUnit({ value }: { value: WeightUnit }) {
  const [unit, setUnitState] = useState(value);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const change = async (next: WeightUnit) => {
    setUnitState(next);
    setBusy(true);
    try {
      await send("/api/web/entreno/settings", "PUT", { defaultUnit: next });
      router.refresh();
    } catch {
      setUnitState(unit);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="text-muted-foreground flex items-center gap-2 text-[13px]">
      <span className="hidden sm:inline">Unidad por defecto</span>
      <UnitSwitch value={unit} onChange={change} label="Unidad por defecto" disabled={busy} />
    </span>
  );
}
