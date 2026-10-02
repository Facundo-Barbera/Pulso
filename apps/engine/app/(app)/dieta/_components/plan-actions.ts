"use client";

import type { MealEntry, PlanChange, PrepBatch } from "@pulso/contract";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
import type { SlotView } from "@/src/web/dieta-plan";
import { send } from "./client";
import { useToast } from "./toast";

/**
 * What the person can do to a planned meal, each answered by a toast with the
 * engine's Spanish summary and «Deshacer». Plan changes go through
 * `plan/ops` (undo = its revision); eating is a log (undo = delete it).
 */
export function usePlanActions() {
  const router = useRouter();
  const notify = useToast();
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);
  const fail = useCallback((message: string) => notify({ message, tone: "error" }), [notify]);

  /** Takes a revision back; the toast says what came back (the engine's summary starts with «Deshecho:»). */
  const undo = useCallback(
    async (id: string): Promise<boolean> => {
      const result = await send("plan/revisions/undo", "POST", { id });
      if (!result.ok) {
        fail(result.message);
        return false;
      }
      notify({ message: (result.data as PlanChange).summary });
      refresh();
      return true;
    },
    [notify, fail, refresh],
  );

  /** Runs one plan op and offers to undo it. `after` runs once the undo succeeded. */
  const op = useCallback(
    async (body: Record<string, unknown>, after?: () => Promise<unknown>): Promise<boolean> => {
      const result = await send("plan/ops", "POST", body);
      if (!result.ok) {
        fail(result.message);
        return false;
      }
      const change = result.data as PlanChange;
      notify({
        message: change.summary,
        undo: async () => {
          const ok = await undo(change.revision.id);
          if (ok && after) {
            await after();
            refresh();
          }
          return ok;
        },
      });
      refresh();
      return true;
    },
    [notify, fail, undo, refresh],
  );

  const forget = useCallback(async (ids: string[]) => {
    for (const id of ids) await send(`meals/${id}`, "DELETE");
  }, []);

  return useMemo(
    () => ({
      pending,
      undo,
      /** «Me lo comí»: logs the meal as planned (adjusted portions included). */
      async eat(slot: SlotView) {
        const result = await send("plan/eat", "POST", { slotId: slot.id });
        if (!result.ok) return fail(result.message);
        const meals = (result.data as { meals: MealEntry[] }).meals;
        notify({
          message: `${slot.title}: ${slot.label}, comida.`,
          undo: async () => {
            await forget(meals.map((m) => m.id));
            notify({ message: `${slot.title} vuelve a estar pendiente.` });
            refresh();
            return true;
          },
        });
        refresh();
      },
      /** Takes back «Me lo comí»: deletes what it logged. */
      async uneat(slot: SlotView) {
        await forget(slot.entryIds);
        notify({ message: `${slot.title} vuelve a estar pendiente.` });
        refresh();
      },
      skip: (slot: SlotView) => op({ op: "skip", slotId: slot.id, date: slot.date }),
      /** «Comí fuera»: an estimate (the planned meal × 1.3) as its real meal; undo deletes it. */
      ateOut: (slot: SlotView) => op({ op: "ate_out", slotId: slot.id, date: slot.date }),
      noTimeToCook: (slot: SlotView) => op({ op: "no_time_to_cook", date: slot.date, slot: slot.slot }),
      /** «Lo cambié por…» after the replacement was logged: ties it to the slot. Undoing also deletes the log. */
      replace: (slot: SlotView, entry: MealEntry) => op({ op: "replace", slotId: slot.id, date: slot.date, entryIds: [entry.id] }, () => forget([entry.id])),
      /** «Mover a la cena»: entries already logged now count for that meal; the one they leave settles. */
      move: (entryIds: string[], slot: SlotView) => op({ op: "replace", slotId: slot.id, date: slot.date, entryIds }),
      cooked: (prep: PrepBatch, cooked = true) => op({ op: "prep_cooked", prepId: prep.id, cooked }),
    }),
    [pending, undo, op, fail, notify, forget, refresh],
  );
}
