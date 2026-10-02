"use client";

import type { JoinCandidate, RecordedPart } from "@pulso/contract";
import { Link2, Unlink, Watch } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { HistoryEntry } from "@/src/web/entreno";
import { send } from "../../../_ui/send";
import { Sparkline } from "../../../_ui/sparkline";

const minutes = (p: { startedAt: number; endedAt: number }) => Math.max(1, Math.round((p.endedAt - p.startedAt) / 60_000));
const km = (meters: number) => `${(meters / 1000).toLocaleString("es", { maximumFractionDigits: 2 })} km`;

function facts(p: RecordedPart | JoinCandidate): string {
  return [
    `${minutes(p)} min`,
    p.energy != null ? `${Math.round(p.energy)} kcal` : null,
    p.avgHeartRate != null ? `FC media ${Math.round(p.avgHeartRate)}` : null,
    p.distance != null ? km(p.distance) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "20 min antes", "1 h después": where a candidate sits against the session, with no clock (no timezone to get wrong). */
function offset(c: JoinCandidate, h: HistoryEntry): string {
  const gap = c.endedAt <= h.startedAt ? h.startedAt - c.endedAt : c.startedAt >= h.endedAt ? c.startedAt - h.endedAt : 0;
  if (gap === 0) return "durante";
  const span = gap >= 3_600_000 ? `${Math.round(gap / 3_600_000)} h` : `${Math.round(gap / 60_000)} min`;
  return `${span} ${c.endedAt <= h.startedAt ? "antes" : "después"}`;
}

/**
 * What Apple Watch recorded during a session, merged into it: each workout
 * with its kcal and heart rate, the heart-rate line, and — for whoever may
 * edit — "Separar" for a wrong guess and "Unir con…" for a missed one.
 */
export function Recorded({ entry: h, canEdit }: { entry: HistoryEntry; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parts = h.recorded?.parts ?? [];
  const joinable = canEdit ? h.joinable : [];
  if (parts.length === 0 && joinable.length === 0) return null;

  const link = async (workoutId: string, sessionId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/web/entreno/workouts/${workoutId}/link`, "PUT", { sessionId });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const byWatch = parts.length > 0 && parts.every((p) => p.sourceName?.toLowerCase().includes("watch"));

  return (
    <div className="border-border mt-4 border-t pt-3">
      {parts.length > 0 && (
        <>
          <p className="text-muted-foreground mb-2 flex items-center gap-1.5 text-[12px] font-medium">
            <Watch className="text-heart size-3.5" /> Registrado también por {byWatch ? "Apple Watch" : "Salud"}
          </p>
          <ul className="space-y-1.5">
            {parts.map((p) => (
              <li key={p.workoutId} className="flex min-h-9 items-center gap-2 text-[13px]">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{p.title}</span> <span className="text-muted-foreground tabular">{facts(p)}</span>
                </span>
                {canEdit && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => link(p.workoutId, null)}
                    className="text-muted-foreground hover:bg-muted focus-visible:ring-ring inline-flex min-h-9 items-center gap-1 rounded-full px-2.5 text-[12px] outline-none focus-visible:ring-2 disabled:opacity-50"
                    title="No era parte de esta sesión"
                  >
                    <Unlink className="size-3.5" /> Separar
                  </button>
                )}
              </li>
            ))}
          </ul>
          {h.heartRate.length > 1 && (
            <div className="mt-3">
              <Sparkline points={h.heartRate} color="var(--domain-heart)" unit="ppm" height={48} label="Frecuencia cardiaca" />
            </div>
          )}
        </>
      )}
      {joinable.length > 0 && (
        <label className="text-muted-foreground mt-2 flex items-center gap-2 text-[12px]">
          <Link2 className="size-3.5 shrink-0" />
          <select
            disabled={busy}
            value=""
            onChange={(e) => e.target.value && link(e.target.value, h.id)}
            className="bg-muted/60 focus-visible:ring-ring min-h-9 min-w-0 flex-1 rounded-full px-3 text-[13px] outline-none focus-visible:ring-2"
            aria-label="Unir un entrenamiento de Salud con esta sesión"
          >
            <option value="">Unir con…</option>
            {joinable.map((c) => (
              <option key={c.workoutId} value={c.workoutId}>
                {c.title} · {facts(c)} · {offset(c, h)}
                {c.joinedTo ? " · en otra sesión" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p className="text-destructive mt-2 text-[12px]">{error}</p>}
    </div>
  );
}
