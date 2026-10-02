import type { AgentFeedItem, AgentMessage, AgentStreamEvent } from "@pulso/contract";

/** The lines of an NDJSON body as `AgentStreamEvent`s, as they arrive. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) yield JSON.parse(line) as AgentStreamEvent;
      }
    }
    if (buffer.trim()) yield JSON.parse(buffer) as AgentStreamEvent;
  } finally {
    reader.releaseLock();
  }
}

const key = (item: AgentFeedItem) => (item.type === "message" ? item.message.id : `marker:${item.marker.id}`);

/**
 * The latest page from the Mac over what is on screen. Messages sent from this
 * browser keep their local id (`localOf`: the Mac's id → the local one), so
 * re-reading never re-keys (remounts) rows; older pages loaded before stay above
 * it. `continuous` is false when the page doesn't reach back to what was shown,
 * and the older rows are dropped.
 */
export function mergeLatest(shown: AgentFeedItem[], page: AgentFeedItem[], localOf: ReadonlyMap<string, string>): { items: AgentFeedItem[]; continuous: boolean } {
  const items = page.map((item): AgentFeedItem => {
    const local = item.type === "message" ? localOf.get(item.message.id) : undefined;
    return local && item.type === "message" ? { type: "message", message: { ...item.message, id: local } } : item;
  });
  const first = items.find((i) => i.type === "message");
  if (!first) return { items, continuous: shown.length === 0 };
  const at = shown.findIndex((i) => key(i) === key(first));
  if (at < 0) return { items, continuous: false };
  const ids = new Set(items.map(key));
  return { items: [...shown.slice(0, at).filter((i) => !ids.has(key(i))), ...items], continuous: true };
}

/** An older page above what is shown; a marker on both is kept once. */
export function prependOlder(shown: AgentFeedItem[], older: AgentFeedItem[]): AgentFeedItem[] {
  const ids = new Set(shown.map(key));
  return [...older.filter((i) => !ids.has(key(i))), ...shown];
}

/** One event applied to the reply being written: a new message, never a mutation (React state). */
export function applyEvent(message: AgentMessage, event: AgentStreamEvent): AgentMessage {
  switch (event.type) {
    case "text":
      return { ...message, text: message.text + event.delta };
    case "tool": {
      const tools = [...message.tools];
      const running = tools.findLastIndex((t) => t.name === event.name && t.status === "running");
      const access = event.access ? { access: event.access } : {};
      if (event.status === "running") tools.push({ name: event.name, status: "running", ...access });
      else if (running >= 0) tools[running] = { ...tools[running], name: event.name, status: event.status, ...access, ...(event.result ? { result: event.result } : {}) };
      return { ...message, tools };
    }
    case "done":
      return { ...message, status: "done", tools: message.tools.map((t) => (t.status === "running" ? { ...t, status: "done" } : t)) };
    case "error":
      return { ...message, status: "error", error: event.message };
    default:
      return message;
  }
}
