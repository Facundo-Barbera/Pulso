import type { AgentMessage, AgentStreamEvent } from "@pulso/contract";

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

/**
 * The saved conversation, keeping the ids of rows already on screen. A local
 * placeholder and the message the Mac saved for it are the same row, matched by
 * position and role, so re-reading the thread never re-keys (remounts) the list.
 */
export function keepIds(shown: AgentMessage[], saved: AgentMessage[]): AgentMessage[] {
  return saved.map((message, i) => {
    const row = shown[i];
    return row && row.role === message.role && row.id.startsWith("local-") ? { ...message, id: row.id } : message;
  });
}

/** One event applied to the reply being written: a new message, never a mutation (React state). */
export function applyEvent(message: AgentMessage, event: AgentStreamEvent): AgentMessage {
  switch (event.type) {
    case "text":
      return { ...message, text: message.text + event.delta };
    case "tool": {
      const tools = [...message.tools];
      const running = tools.findLastIndex((t) => t.name === event.name && t.status === "running");
      if (event.status === "running") tools.push({ name: event.name, status: "running" });
      else if (running >= 0) tools[running] = { name: event.name, status: event.status, ...(event.result ? { result: event.result } : {}) };
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
