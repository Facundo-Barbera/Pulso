/**
 * What the web Coach draws, from the same thread store and runner the phone
 * uses. The pages render it on the server; `/api/web/coach/*` serves the same
 * shapes for the client to refresh and stream.
 */
import type { AgentThreadDetail, CoachBrief } from "@pulso/contract";
import { activeTurn } from "../agent/runner";
import { getThread, listMessages } from "../agent/threads";
import { nudgeCoachScheduler } from "../coach/scheduler";
import { getBrief, latestBrief } from "../coach/store";

/** `running` says a turn is in flight: the client re-attaches with `GET /api/web/coach/threads/:id/turn`. */
export type CoachThreadView = AgentThreadDetail & { running: boolean };

export type NewChatBrief = {
  /** the latest morning brief, at the top of a new chat */
  brief: CoachBrief | null;
  /** the brief a new chat answers (`/coach/nuevo?responder=<id>`), when it exists and has text */
  replyTo: CoachBrief | null;
};

export function coachThread(id: string): CoachThreadView | undefined {
  const thread = getThread(id);
  if (!thread) return undefined;
  return { thread, messages: listMessages(id), running: !!activeTurn(id) };
}

/** Also nudges the brief scheduler, like the phone opening Hoy: opening the Coach is a good moment to write a due one. */
export function coachBrief(replyTo?: string): NewChatBrief {
  nudgeCoachScheduler();
  const reply = replyTo ? getBrief(replyTo) : undefined;
  return { brief: latestBrief("daily"), replyTo: reply?.text ? reply : null };
}
