/**
 * What the Coach screen (phone and browser) reads and does, over the one
 * perpetual conversation. The API routes are thin wrappers around these.
 */
import type { AgentConversation } from "@pulso/contract";
import { conversationThreadId, ensureConversation, feedPage, listContexts, newContext, PAGE, switchContext } from "./conversation";
import { activeTurn, type QueryFn } from "./runner";
import { sendMessage, type SendResult } from "./send";
import { compacting, settled } from "./upkeep";

export class ConversationError extends Error {
  constructor(
    public status: 404 | 409,
    public code: "not_found" | "busy",
    message: string,
  ) {
    super(message);
  }
}

const BUSY = "Espera a que el Coach termine de responder.";

/** A page of the feed (the latest without `before`), with the contexts and what is running. `limit` is clamped to 1–100. */
export function conversationView(before?: string | null, limit?: number | null): AgentConversation {
  const { thread_id, active_context_id } = ensureConversation();
  const page = feedPage(before ?? undefined, Math.min(100, Math.max(1, limit || PAGE)));
  return { threadId: thread_id, activeContextId: active_context_id, contexts: listContexts(), ...page, running: !!activeTurn(thread_id), compacting: compacting() };
}

/** `?before=&limit=` of a feed request. */
export function pageParams(request: Request): [string | null, number | null] {
  const params = new URL(request.url).searchParams;
  return [params.get("before"), Number(params.get("limit")) || null];
}

/** A message into the active context. Waits for an hourly summary or the first distillation in flight, so the turn starts from them. */
export function sendToConversation(request: Request, run?: QueryFn): Promise<SendResult> {
  return sendMessage(conversationThreadId(), request, run, async () => {
    await settled();
    return compacting() ? "El Coach está resumiendo la conversación. Intenta de nuevo en un momento." : null;
  });
}

export const conversationTurn = () => activeTurn(conversationThreadId());

function idle(): string {
  const threadId = conversationThreadId();
  if (activeTurn(threadId)) throw new ConversationError(409, "busy", BUSY);
  return threadId;
}

/** «Contexto nuevo». */
export function startNewContext(): AgentConversation {
  idle();
  newContext();
  return conversationView();
}

/** «Volver a este contexto». */
export function returnToContext(id: string): AgentConversation {
  idle();
  if (!switchContext(id)) throw new ConversationError(404, "not_found", "Ese contexto ya no existe.");
  return conversationView();
}
