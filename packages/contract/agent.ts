import type { FoodProduct } from "./nutrition";

/** A conversation with the Coach. Times are epoch ms. */
export type AgentThread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** First characters of the latest message, for the thread list. */
  preview: string | null;
};

/** The app tab where something a tool created lives. */
export type AgentResultTab = "hoy" | "entreno" | "dieta" | "cuerpo";

/** What a tool that changed the person's data made, for a tappable card in the chat. In Spanish. */
export type AgentToolResult = {
  /** e.g. "Programa creado". */
  title: string;
  /** e.g. "Torso/Pierna · 4 días". */
  detail: string | null;
  tab: AgentResultTab;
};

export type AgentToolUse = {
  /** Tool name without the `mcp__pulso__` prefix, e.g. `list_workouts`, `WebSearch`. */
  name: string;
  status: "running" | "done" | "error";
  /** Only on `done` tools that created or changed something the app shows. */
  result?: AgentToolResult;
};

/** `streaming` while the turn runs; the text grows until `done` or `error`. */
export type AgentMessageStatus = "streaming" | "done" | "error";

/**
 * A photo the person sent with a message. Kept on the Mac as a JPEG, at most
 * 1600 px on its long edge; clients fetch it at
 * `…/threads/:threadId/attachments/:id` (mobile and web APIs).
 */
export type AgentAttachment = { id: string; mime: "image/jpeg"; width: number; height: number };

/** At most this many photos per message. */
export const MAX_AGENT_ATTACHMENTS = 4;

/**
 * A packaged product the person scanned into a message: the code and what Open
 * Food Facts said about it when it was sent (null when unknown or unreachable).
 */
export type AgentProduct = { barcode: string; product: FoodProduct | null };

/** At most this many scanned products per message. */
export const MAX_AGENT_PRODUCTS = 4;

export type AgentMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  /** Markdown for assistant messages. May be empty on a user message that only carries photos. */
  text: string;
  /** Photos on a user message, in the order they were sent. */
  attachments: AgentAttachment[];
  /** Scanned products on a user message, in the order they were added. */
  products: AgentProduct[];
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
  | { type: "tool"; name: string; status: AgentToolUse["status"]; result?: AgentToolResult }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };

/**
 * JSON `{ text, barcodes? }`, or multipart/form-data with a `text` field, up to
 * `MAX_AGENT_ATTACHMENTS` `image` files (JPEG, PNG or HEIC) and up to
 * `MAX_AGENT_PRODUCTS` `barcode` fields. With photos or products the text may be empty.
 */
export type SendAgentMessage = { text: string; barcodes?: string[] };

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
