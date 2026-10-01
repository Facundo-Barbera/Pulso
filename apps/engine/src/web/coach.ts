/**
 * What the web Coach draws, from the same thread store and runner the phone
 * uses. The pages render it on the server; `/api/web/coach/*` serves the same
 * shapes for the client to refresh and stream.
 */
import type { AgentThread, AgentThreadDetail, CoachBrief } from "@pulso/contract";
import { activeTurn } from "../agent/runner";
import { getThread, listMessages, listThreads } from "../agent/threads";
import { latestBrief } from "../coach/store";

/** `running` says a turn is in flight: the client re-attaches with `GET /api/web/coach/threads/:id/turn`. */
export type CoachThreadView = AgentThreadDetail & { running: boolean };

export type CoachHome = {
  threads: AgentThread[];
  /** the latest morning brief, shown at the top of a new chat */
  brief: CoachBrief | null;
};

export function coachThread(id: string): CoachThreadView | undefined {
  const thread = getThread(id);
  if (!thread) return undefined;
  return { thread, messages: listMessages(id), running: !!activeTurn(id) };
}

export function coachHome(): CoachHome {
  return { threads: listThreads(), brief: latestBrief("daily") };
}
