/**
 * What the web Coach draws: the same conversation and runner the phone uses.
 * The page renders it on the server; `/api/web/coach/conversation/*` serves the
 * same shapes for the client to refresh, page and stream.
 */
import type { AgentConversation, CoachBrief } from "@pulso/contract";
import { conversationView } from "../agent/feed";
import { nudgeCoachScheduler } from "../coach/scheduler";
import { latestBrief } from "../coach/store";

export const coachConversation = (): AgentConversation => conversationView();

/** The latest morning brief, at the top of the feed. Also nudges the brief scheduler, like the phone opening Hoy. */
export function coachBrief(): CoachBrief | null {
  nudgeCoachScheduler();
  return latestBrief("daily");
}
