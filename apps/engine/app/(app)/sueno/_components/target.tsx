"use client";

import { Minus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../../_ui/fields";
import { fmtMinutes } from "../../../_ui/format";
import { send } from "../../../_ui/send";

const MIN = 240;
const MAX = 720;
const STEP = 15;

/** The nightly target, in 15-minute steps between 4 and 12 hours. Saves when changed. */
export function TargetControl({ targetMin }: { targetMin: number }) {
  const router = useRouter();
  const [value, setValue] = useState(targetMin);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = value !== targetMin;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await send("/api/web/sueno/objetivo", "PUT", { minutes: value });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const stepper = "bg-muted hover:bg-accent focus-visible:ring-ring grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 disabled:opacity-40";
  return (
    <div>
      <p className="text-muted-foreground text-[12px] font-medium">Objetivo por noche</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button className={stepper} onClick={() => setValue((v) => Math.max(MIN, v - STEP))} disabled={value <= MIN} aria-label="15 minutos menos">
          <Minus className="size-4" />
        </button>
        <span className="tabular min-w-28 text-center text-[22px] font-semibold tracking-tight" aria-live="polite">
          {fmtMinutes(value)}
        </span>
        <button className={stepper} onClick={() => setValue((v) => Math.min(MAX, v + STEP))} disabled={value >= MAX} aria-label="15 minutos más">
          <Plus className="size-4" />
        </button>
        {dirty && (
          <Button variant="primary" onClick={save} disabled={saving} className="ml-auto">
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        )}
      </div>
      {error && <p className="text-destructive mt-2 text-[13px]">{error}</p>}
    </div>
  );
}
