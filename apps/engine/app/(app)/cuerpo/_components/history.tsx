"use client";

import { CircleAlert, CircleCheck, Equal, History, ScanLine, SquarePen, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardTitle } from "../../../_ui/card";
import { cn } from "../../../_ui/cn";
import { METRIC, problem } from "./metrics";

/** How one metric moved since the scan before that measured it; `good` is null when flat. */
export type ScanDelta = { metric: "weight" | "skeletalMuscleMass" | "bodyFatMass"; label: string; text: string; good: boolean | null };

/** One scan as a row, formatted on the server. */
export type ScanRow = { id: string; date: string; source: string; inbody: boolean; device: string | null; values: string; deltas: ScanDelta[] };

const SHOWN = 6;

/** Every scan, newest first, each removable (with a confirm). */
export function HistoryCard({ rows, delay }: { rows: ScanRow[]; delay: number }) {
  const router = useRouter();
  const [all, setAll] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    setError(null);
    const response = await fetch(`/api/web/cuerpo/scans/${id}`, { method: "DELETE" });
    if (!response.ok) setError(await problem(response));
    setConfirming(null);
    router.refresh();
  }

  return (
    <Card delay={delay}>
      <CardTitle icon={History} color="var(--muted-foreground)" title={`Mediciones · ${rows.length}`} />
      <ul className="-mx-2 space-y-0.5">
        {(all ? rows : rows.slice(0, SHOWN)).map((row) => (
          <li key={row.id} className="group hover:bg-muted/50 flex min-h-13 items-center gap-3 rounded-xl px-2 py-2">
            <span
              className={cn("relative grid size-9 shrink-0 place-items-center rounded-xl", !row.inbody && "bg-muted text-muted-foreground")}
              style={row.inbody ? { background: "color-mix(in oklab, var(--domain-body) 15%, transparent)", color: "var(--domain-body)" } : undefined}
              title={row.source}
            >
              {row.inbody ? <ScanLine className="size-4" /> : <SquarePen className="size-4" />}
              {row.device && <span className="bg-card text-foreground shadow-1 tabular absolute -right-1.5 -bottom-1.5 rounded-md px-1 text-[9px] leading-[14px] font-semibold">{row.device}</span>}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium">{row.date}</span>
              <span className="text-muted-foreground tabular block truncate text-[12px]">{row.values}</span>
              {row.deltas.length > 0 && (
                <span className="mt-1 flex flex-wrap gap-1">
                  {row.deltas.map((d) => (
                    <Delta key={d.metric} delta={d} />
                  ))}
                </span>
              )}
            </span>
            {confirming === row.id ? (
              <span className="flex gap-1.5">
                <button onClick={() => setConfirming(null)} className="hover:bg-muted min-h-9 rounded-lg px-2.5 text-[13px]">
                  Cancelar
                </button>
                <button onClick={() => remove(row.id)} className="bg-destructive text-background min-h-9 rounded-lg px-2.5 text-[13px] font-medium">
                  Borrar
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirming(row.id)}
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 focus-visible:ring-ring grid size-9 place-items-center rounded-lg opacity-60 outline-none group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2"
                aria-label={`Borrar la medición del ${row.date}`}
                title="Borrar"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {rows.length > SHOWN && (
        <button onClick={() => setAll(!all)} className="text-muted-foreground hover:text-foreground mt-2 min-h-9 text-[13px]">
          {all ? "Ver menos" : `Ver las ${rows.length}`}
        </button>
      )}
      {error && <p className="text-destructive mt-3 text-[13px]">{error}</p>}
    </Card>
  );
}

/** "⚖ −0,6 kg ✓": the metric's icon says which, the sign the direction, the check (blue) or alert (orange) whether that suits the goal. */
function Delta({ delta: d }: { delta: ScanDelta }) {
  const Icon = METRIC[d.metric].icon;
  const Verdict = d.good === null ? Equal : d.good ? CircleCheck : CircleAlert;
  const verdict = d.good === null ? "sin cambio" : d.good ? "a tu favor" : "en contra de tu objetivo";
  return (
    <span
      className={cn(
        "tabular inline-flex min-h-5 items-center gap-1 rounded-full px-1.5 text-[11px] font-medium whitespace-nowrap",
        d.good === null ? "bg-muted text-muted-foreground" : d.good ? "bg-good/10 text-good" : "bg-caution/10 text-caution",
      )}
      title={`${d.label}: ${d.text}, ${verdict}`}
    >
      <Icon className="size-3" strokeWidth={2.4} aria-hidden />
      {d.text}
      <Verdict className="size-3" strokeWidth={2.6} aria-hidden />
      <span className="sr-only">
        {d.label}, {verdict}
      </span>
    </span>
  );
}
