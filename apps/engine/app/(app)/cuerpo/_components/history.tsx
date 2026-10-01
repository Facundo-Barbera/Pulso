"use client";

import { History, ScanLine, SquarePen, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardTitle } from "../../../_ui/card";
import { problem } from "./metrics";

/** One scan as a row, formatted on the server. */
export type ScanRow = { id: string; date: string; source: string; inbody: boolean; values: string };

const SHOWN = 8;

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
          <li key={row.id} className="group hover:bg-muted/50 flex min-h-13 items-center gap-3 rounded-xl px-2 py-1.5">
            <span className="bg-muted text-muted-foreground grid size-8 shrink-0 place-items-center rounded-lg" title={row.source}>
              {row.inbody ? <ScanLine className="size-4" /> : <SquarePen className="size-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium">{row.date}</span>
              <span className="text-muted-foreground tabular block truncate text-[12px]">{row.values}</span>
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
