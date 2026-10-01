import type { DishRef } from "@pulso/contract";
import { ChevronDown } from "lucide-react";
import type { DietaEntry } from "@/src/web/dieta";
import { fmtNumber } from "../../../_ui/format";
import { DishActions } from "./actions";

export type EntryGroup = { dish: DishRef | null; entries: DietaEntry[] };

/** Entries in order, a dish's components together under it; foods on their own stay single. */
export function byDish(entries: DietaEntry[]): EntryGroup[] {
  const groups: EntryGroup[] = [];
  for (const e of entries) {
    const group = e.dish && groups.find((g) => g.dish?.id === e.dish!.id);
    if (group) group.entries.push(e);
    else groups.push({ dish: e.dish, entries: [e] });
  }
  return groups;
}

/** A dish eaten: its name and total, opening to its components (each correctable) and what to do with it. */
export function DishRow({ dish, entries, leading, detail, renderEntry }: { dish: DishRef; entries: DietaEntry[]; leading?: React.ReactNode; detail?: string; renderEntry: (e: DietaEntry) => React.ReactNode }) {
  const kcal = entries.reduce((s, e) => s + e.kcal, 0);
  const protein = entries.reduce((s, e) => s + e.protein, 0);
  return (
    <li>
      <details className="group/dish">
        <summary className="hover:bg-muted/50 flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-xl px-2 [&::-webkit-details-marker]:hidden">
          {leading}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium">{dish.name}</span>
            <span className="text-muted-foreground block truncate text-[12px] tabular">
              {detail && `${detail} · `}
              {entries.length === 1 ? "1 ingrediente" : `${entries.length} ingredientes`} · {fmtNumber(protein)} g prot.
            </span>
          </span>
          <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform group-open/dish:rotate-180" aria-hidden />
          <span className="w-12 shrink-0 text-right text-[13px] font-medium tabular">{fmtNumber(kcal)}</span>
        </summary>
        <ul className="border-border mb-1 ml-4 border-l pl-2">
          {entries.map(renderEntry)}
          <li>
            <DishActions dish={dish} />
          </li>
        </ul>
      </details>
    </li>
  );
}
