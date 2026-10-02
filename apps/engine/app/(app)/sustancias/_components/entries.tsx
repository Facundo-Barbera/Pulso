"use client";

import type { Substance, SubstanceEntry } from "@pulso/contract";
import { useState } from "react";
import { AMOUNT_LABEL, capitalize, CONTEXT_LABEL } from "./labels";
import { draftOf, EntrySheet } from "./entry-sheet";

/** Recent uses, newest first; a row opens its editor. `labels` are the server-formatted dates; `showName` for Todas. */
export function EntryList({ entries, labels, substances, showName }: { entries: SubstanceEntry[]; labels: Record<string, string>; substances: Substance[]; showName: boolean }) {
  const [editing, setEditing] = useState<SubstanceEntry | null>(null);
  const byId = new Map(substances.map((s) => [s.id, s]));
  const pickable = (entry: SubstanceEntry) => substances.filter((s) => !s.archived || s.id === entry.substanceId);
  return (
    <>
      <ul className="-mx-2 space-y-0.5">
        {entries.map((e) => {
          const substance = byId.get(e.substanceId);
          return (
            <li key={e.id}>
              <button onClick={() => setEditing(e)} className="hover:bg-muted/60 focus-visible:ring-ring flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left outline-none focus-visible:ring-2">
                <span className="tabular text-muted-foreground w-24 shrink-0 text-[13px]">
                  {labels[e.date]} · {e.time}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px]">
                  {[showName && substance?.name, e.form && capitalize(e.form), AMOUNT_LABEL[e.amount].toLowerCase(), e.quantity && `${e.quantity} ${substance?.unit ?? ""}`.trim(), e.thcMg && `${e.thcMg} mg THC`, e.context && CONTEXT_LABEL[e.context].toLowerCase()]
                    .filter(Boolean)
                    .join(" · ")}
                  {e.note && <span className="text-muted-foreground"> — {e.note}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {editing && <EntrySheet open onClose={() => setEditing(null)} initial={draftOf(editing)} id={editing.id} substances={pickable(editing)} />}
    </>
  );
}
