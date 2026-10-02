"use client";

import type { SubstanceEntry } from "@pulso/contract";
import { useState } from "react";
import { AMOUNT_LABEL, CONTEXT_LABEL, FORM_LABEL } from "./labels";
import { draftOf, EntrySheet } from "./entry-sheet";

/** Recent uses, newest first; a row opens its editor. `labels` are the server-formatted dates. */
export function EntryList({ entries, labels }: { entries: SubstanceEntry[]; labels: Record<string, string> }) {
  const [editing, setEditing] = useState<SubstanceEntry | null>(null);
  return (
    <>
      <ul className="-mx-2 space-y-0.5">
        {entries.map((e) => (
          <li key={e.id}>
            <button onClick={() => setEditing(e)} className="hover:bg-muted/60 focus-visible:ring-ring flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left outline-none focus-visible:ring-2">
              <span className="tabular text-muted-foreground w-24 shrink-0 text-[13px]">{labels[e.date]} · {e.time}</span>
              <span className="min-w-0 flex-1 truncate text-[14px]">
                {[e.form && FORM_LABEL[e.form], AMOUNT_LABEL[e.amount].toLowerCase(), e.count && `${e.count}×`, e.thcMg && `${e.thcMg} mg THC`, e.context && CONTEXT_LABEL[e.context].toLowerCase()].filter(Boolean).join(" · ")}
                {e.note && <span className="text-muted-foreground"> — {e.note}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {editing && <EntrySheet open onClose={() => setEditing(null)} initial={draftOf(editing)} id={editing.id} />}
    </>
  );
}
