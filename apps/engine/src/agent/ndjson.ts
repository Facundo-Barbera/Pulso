import type { AgentStreamEvent } from "@pulso/contract";

export const NDJSON_HEADERS = { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" };

export const encodeEvent = (event: AgentStreamEvent): string => `${JSON.stringify(event)}\n`;

export const isTerminal = (event: AgentStreamEvent) => event.type === "done" || event.type === "error";

/**
 * An NDJSON body fed by `subscribe`, which must call `emit` for every event
 * (replaying past ones first) and return an unsubscribe function. The body ends
 * after `done` or `error`; a client hanging up only unsubscribes, it never
 * stops the turn.
 */
export function eventStream(subscribe: (emit: (event: AgentStreamEvent) => void) => () => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let closed = false;
  return new ReadableStream({
    start(controller) {
      const emit = (event: AgentStreamEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(encodeEvent(event)));
        if (!isTerminal(event)) return;
        closed = true;
        controller.close();
        // emit may run inside subscribe, before it has returned the unsubscribe.
        queueMicrotask(() => unsubscribe?.());
      };
      unsubscribe = subscribe(emit);
      if (closed) unsubscribe();
    },
    cancel() {
      closed = true;
      unsubscribe?.();
    },
  });
}
