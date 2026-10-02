"use client";

import { ArrowRightLeft, CupSoda } from "lucide-react";
import type { DietaEntry } from "@/src/web/dieta";
import type { SlotView } from "@/src/web/dieta-plan";
import { Card } from "../../../_ui/card";
import { fmtNumber } from "../../../_ui/format";
import { EntryActions } from "./actions";
import { byDish, DishRow } from "./dish";
import { usePlanActions } from "./plan-actions";
import { RowMenu } from "./slot-row";
import { fmtAmount } from "./units";

/** What was eaten outside the plan's meals, compact: name, time and amount, kcal. Correct, delete or move one into a meal. */
export function Extras({ entries, slots, delay }: { entries: DietaEntry[]; slots: SlotView[]; delay?: number }) {
  const actions = usePlanActions();
  const kcal = entries.reduce((s, e) => s + e.kcal, 0);
  const moves = (ids: string[]) => slots.map((slot) => ({ label: `Mover a ${slot.title.toLowerCase()}`, icon: ArrowRightLeft, run: () => void actions.move(ids, slot) }));
  const row = (e: DietaEntry, inDish = false) => (
    <li key={e.id} className="group hover:bg-muted/50 flex min-h-11 items-center gap-3 rounded-xl px-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px]">{e.name}</span>
        <span className="text-muted-foreground block truncate text-[12px] tabular">
          {inDish ? fmtAmount(e.measure, e.quantity, e.unit) : `${e.time} · ${fmtAmount(e.measure, e.quantity, e.unit)}`}
        </span>
      </span>
      <EntryActions entry={e} />
      {!inDish && <RowMenu label={e.name} items={moves([e.id])} />}
      <span className="w-14 shrink-0 text-right text-[13px] font-medium tabular">{fmtNumber(e.kcal)} kcal</span>
    </li>
  );
  return (
    <Card className="relative has-[[aria-expanded=true]]:z-10" delay={delay}>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="bg-energy/15 text-energy grid size-7 place-items-center rounded-lg">
          <CupSoda className="size-4" strokeWidth={2.2} />
        </span>
        <h2 className="text-[15px] font-semibold tracking-tight">Extras</h2>
        <p className="text-muted-foreground ml-auto text-[13px] tabular">{fmtNumber(kcal)} kcal</p>
      </div>
      <ul className="-mx-2">
        {byDish(entries).map(({ dish, entries: parts }) =>
          dish ? <DishRow key={dish.id} dish={dish} entries={parts} detail={parts[0]!.time} renderEntry={(e) => row(e, true)} /> : row(parts[0]!),
        )}
      </ul>
    </Card>
  );
}
