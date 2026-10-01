/** A conversation with the Coach. Times are epoch ms. */
export type AgentThread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** First characters of the latest message, for the thread list. */
  preview: string | null;
};

export type AgentToolUse = {
  /** Tool name without the `mcp__pulso__` prefix, e.g. `list_workouts`, `WebSearch`. */
  name: string;
  status: "running" | "done" | "error";
};

/** `streaming` while the turn runs; the text grows until `done` or `error`. */
export type AgentMessageStatus = "streaming" | "done" | "error";

export type AgentMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  /** Markdown for assistant messages. */
  text: string;
  tools: AgentToolUse[];
  status: AgentMessageStatus;
  error: string | null;
  createdAt: number;
};

export type AgentThreadDetail = { thread: AgentThread; messages: AgentMessage[] };

/**
 * One line of the NDJSON stream for a turn. `start` comes first and names the
 * assistant message being written, so a client that drops can re-read it from
 * the thread later. The stream always ends with `done` or `error`.
 */
export type AgentStreamEvent =
  | { type: "start"; messageId: string; userMessageId: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; status: AgentToolUse["status"] }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };

export type SendAgentMessage = { text: string };

/** What the Coach knows about the person. Every field is optional; the agent fills it in over time. */
export type Profile = {
  age?: number;
  sex?: "male" | "female" | "other";
  /** cm */
  heightCm?: number;
  goals?: string;
  /** e.g. "principiante", "2 años de pesas" */
  experience?: string;
  equipment?: string;
  /** Days and times available to train. */
  schedule?: string;
  injuries?: string;
  allergies?: string;
  foodPreferences?: string;
  notes?: string;
};
