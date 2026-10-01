import type { AgentThread, CoachBrief } from "@pulso/contract";
import { addMessage, createThread, getThread } from "../agent/threads";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const short = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;

export const briefTitle = (brief: CoachBrief) => (brief.kind === "daily" ? `Resumen del ${short(brief.period)}` : `Revisión de la semana del ${short(brief.period)}`);

/**
 * A new thread that opens with the brief as the Coach's first message, so the
 * person's reply has it as context (it reaches the SDK through the recap of a
 * thread with no session yet).
 */
export function threadFromBrief(brief: CoachBrief): AgentThread {
  const thread = createThread(briefTitle(brief));
  addMessage(thread.id, "assistant", brief.text, "done");
  return getThread(thread.id)!;
}
