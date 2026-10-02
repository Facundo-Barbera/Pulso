"use client";

import type { DoseSlot, DoseStatus } from "@pulso/contract";
import { Check, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "../../../_ui/cn";
import { Button } from "../../../_ui/fields";
import { send } from "../../../_ui/send";

/** A write, then a server refresh; the error, if any, as one short line. */
function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

const log = (slot: Pick<DoseSlot, "medicationId" | "date" | "slot">, status: DoseStatus) => send("/api/web/medicacion/tomas", "POST", { medicationId: slot.medicationId, date: slot.date, scheduledTime: slot.slot, status });
const undo = (eventId: string) => send(`/api/web/medicacion/tomas/${eventId}`, "DELETE");

const iconButton = "text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring grid size-10 place-items-center rounded-full outline-none focus-visible:ring-2 disabled:opacity-40";

/** A slot's actions: «Tomada» (and a quiet «Omitir») while pending; the outcome and an undo once logged. */
export function DoseActions({ slot, takenLabel }: { slot: DoseSlot; takenLabel: string | null }) {
  const { busy, error, run } = useAction();
  const logged = slot.eventId !== null && slot.status !== "pospuesta";

  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <span className="flex items-center gap-1">
        {logged ? (
          <>
            <span className={cn("flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium", slot.status === "tomada" ? "text-good bg-good/12" : "text-muted-foreground bg-muted")}>
              {slot.status === "tomada" ? <Check className="size-3.5" strokeWidth={3} /> : <X className="size-3.5" />}
              {slot.status === "tomada" ? `Tomada${takenLabel ? ` · ${takenLabel}` : ""}` : "Omitida"}
            </span>
            <button className={iconButton} onClick={() => run(() => undo(slot.eventId!))} disabled={busy} aria-label="Deshacer: volver a pendiente" title="Deshacer">
              <RotateCcw className="size-4" />
            </button>
          </>
        ) : (
          <>
            <button className={iconButton} onClick={() => run(() => log(slot, "omitida"))} disabled={busy} aria-label={`Omitir ${slot.name}`} title="Omitir">
              <X className="size-4" />
            </button>
            <Button variant="primary" onClick={() => run(() => log(slot, "tomada"))} disabled={busy} className="min-h-10 px-4" style={{ background: "var(--domain-medication)", color: "white" }}>
              <Check className="size-4" strokeWidth={2.6} />
              Tomada
            </Button>
          </>
        )}
      </span>
      {error && <span className="text-destructive text-[12px]">{error}</span>}
    </span>
  );
}

/** «Tomé una» for an as-needed medication: logs an intake now. */
export function TakeOneButton({ medicationId, date, name, label = "Tomé una" }: { medicationId: string; date: string; name: string; label?: string }) {
  const { busy, error, run } = useAction();
  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <Button onClick={() => run(() => send("/api/web/medicacion/tomas", "POST", { medicationId, date, scheduledTime: null, status: "tomada" }))} disabled={busy} aria-label={`Tomé una de ${name}`}>
        <Plus className="size-4" />
        {label}
      </Button>
      {error && <span className="text-destructive text-[12px]">{error}</span>}
    </span>
  );
}

/** Deletes one history entry (asks once). */
export function DeleteEntryButton({ eventId, label }: { eventId: string; label: string }) {
  const { busy, error, run } = useAction();
  const [sure, setSure] = useState(false);
  if (sure)
    return (
      <span className="flex items-center gap-1">
        <Button variant="danger" onClick={() => run(() => undo(eventId))} disabled={busy} className="min-h-9 px-3 text-[13px]">
          Borrar
        </Button>
        <Button variant="ghost" onClick={() => setSure(false)} className="min-h-9 px-3 text-[13px]">
          No
        </Button>
        {error && <span className="text-destructive text-[12px]">{error}</span>}
      </span>
    );
  return (
    <button className={cn(iconButton, "opacity-60 group-hover:opacity-100 focus-visible:opacity-100")} onClick={() => setSure(true)} aria-label={`Borrar el registro de ${label}`} title="Borrar registro">
      <Trash2 className="size-4" />
    </button>
  );
}
