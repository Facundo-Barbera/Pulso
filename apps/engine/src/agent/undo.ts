import type { AgentMessage } from "@pulso/contract";
import { deleteMedication, MedicationError, undoDose, updateMedication } from "../medication/store";
import { PlanError } from "../nutrition/horizon";
import { undo as undoPlanChange } from "../nutrition/ops";
import { RevisionError } from "../nutrition/revisions";
import { deleteMeal } from "../nutrition/store";
import { deleteManualNight, restoreManualNight, SleepError, updateManualNight } from "../sleep/manual";
import { deleteWater } from "../nutrition/water";
import { ProgramConflictError, restoreProgramDays } from "../training/store";
import type { Revert } from "./actions";
import { updateProfile } from "./profile";
import { activeTurn } from "./runner";
import { getMessage, setTools, storedTools } from "./threads";

export class UndoError extends Error {
  constructor(
    public status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

function revert(r: Revert): void {
  switch (r.kind) {
    case "profile":
      updateProfile(r.patch);
      return;
    case "meals":
      for (const id of r.ids) deleteMeal(id);
      return;
    case "plan":
      undoPlanChange(r.revisionId);
      return;
    case "dose":
      undoDose(r.id);
      return;
    case "water":
      deleteWater(r.id);
      return;
    case "medication_added":
      deleteMedication(r.id);
      return;
    case "medication":
      updateMedication(r.id, r.patch);
      return;
    case "sleep_added":
      deleteManualNight(r.id);
      return;
    case "sleep":
      updateManualNight(r.id, r.patch);
      return;
    case "sleep_deleted":
      restoreManualNight(r.night);
      return;
    case "program":
      restoreProgramDays(r.before, r.after);
      return;
  }
}

/**
 * Deshacer on an action card: puts back what tool `index` of the message
 * changed and marks its card undone. Undoing twice is a no-op. Returns the
 * message as clients see it.
 */
export function undoToolAction(threadId: string, messageId: string, index: number): AgentMessage {
  const message = getMessage(messageId);
  if (!message || message.threadId !== threadId) throw new UndoError(404, "No encontré ese cambio.");
  if (activeTurn(threadId)?.messageId === messageId) throw new UndoError(409, "Espera a que el Coach termine de responder.");
  const tools = storedTools(messageId);
  const tool = tools[index];
  if (!tool?.result?.undo || !tool.revert) throw new UndoError(404, "Ese cambio no se puede deshacer.");
  if (tool.result.undo === "done") return message;
  try {
    revert(tool.revert);
  } catch (error) {
    if (error instanceof RevisionError) throw new UndoError(409, "Un cambio posterior toca los mismos días del plan: deshaz ese primero.");
    if (error instanceof PlanError) throw new UndoError(409, "Ese plan ya no está activo.");
    if (error instanceof MedicationError && error.code === "not_found") throw new UndoError(409, "Eso ya no existe.");
    if (error instanceof ProgramConflictError) throw new UndoError(409, "El programa cambió después: deshaz primero el cambio más reciente.");
    if (error instanceof SleepError) throw new UndoError(409, error.code === "not_found" ? "Eso ya no existe." : error.message);
    console.error("[agent] undo failed", error);
    throw new UndoError(409, "No pude deshacerlo.");
  }
  tools[index] = { ...tool, result: { ...tool.result, undo: "done" } };
  setTools(messageId, tools);
  return getMessage(messageId)!;
}
