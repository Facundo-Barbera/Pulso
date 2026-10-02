import type { AgentMessage, CoachBrief } from "@pulso/contract";
import { quoteMessage } from "../agent/conversation";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const short = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;

export const briefTitle = (brief: CoachBrief) => (brief.kind === "daily" ? `Resumen del ${short(brief.period)}` : `Revisión de la semana del ${short(brief.period)}`);

/**
 * «Responder»: the brief goes into the conversation as the Coach's message, so
 * the person's reply has it as context (the next turn reads it, runner.withQuoted).
 * Replying to the same brief again doesn't add it twice.
 */
export function replyToBrief(brief: CoachBrief): AgentMessage {
  return quoteMessage({ kind: "brief", title: briefTitle(brief) }, brief.text);
}
