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

/** A screen inside a tab that an action card opens: Medicación (from Hoy) or the profile (in Cuerpo). */
export type AgentResultPlace = "medicacion" | "perfil";

/** One line of an action card, e.g. label "Objetivo", before "Bajar de peso", value "Bajar 10 kg de grasa". */
export type AgentActionLine = {
  label: string | null;
  /** What it was, when the change replaced a value. */
  before: string | null;
  value: string;
};

/**
 * The action card for a tool that changed the person's data: what changed, in
 * Spanish, where it lives and whether it can be undone.
 */
export type AgentToolResult = {
  /** e.g. "Perfil actualizado". */
  title: string;
  /** The lines in one string, for clients that predate `lines`. */
  detail: string | null;
  /** The tab it opens. */
  tab: AgentResultTab;
  /** A screen inside `tab` to open instead, when there is one. */
  place?: AgentResultPlace;
  /** 1–5 lines saying what changed, before → after where it applies. */
  lines?: AgentActionLine[];
  /**
   * `available`: Deshacer works (POST `…/threads/:id/messages/:messageId/tools/:index/undo`,
   * or `…/conversation/messages/:messageId/tools/:index/undo` in the conversation;
   * `index` into the message's `tools`); `done`: it was undone. Absent: it can't be.
   */
  undo?: "available" | "done";
};

export type AgentToolUse = {
  /** Tool name without the `mcp__pulso__` prefix, e.g. `list_workouts`, `WebSearch`. */
  name: string;
  status: "running" | "done" | "error";
  /** `write` when the tool changes the person's data (an action card), `read` for lookups (a quiet chip). Missing on older messages. */
  access?: "read" | "write";
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

/** A message the Coach didn't write in a turn but that the app put in the conversation: a brief or a training review the person answers. */
export type AgentMessageSource = { kind: "brief" | "adjustment"; title: string };

export type AgentMessage = {
  id: string;
  threadId: string;
  /** In the perpetual conversation, the context (SDK session) the message belongs to; null elsewhere. */
  contextId?: string | null;
  /** Set on a brief or review quoted into the conversation. */
  source?: AgentMessageSource | null;
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

/** POST `…/messages/:messageId/tools/:index/undo`: the message again, that tool's card now `undo: "done"`. */
export type AgentUndoResponse = { message: AgentMessage };

/**
 * One line of the NDJSON stream for a turn. `start` comes first and names the
 * assistant message being written, so a client that drops can re-read it from
 * the thread later. The stream always ends with `done` or `error`.
 */
export type AgentStreamEvent =
  | { type: "start"; messageId: string; userMessageId: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; status: AgentToolUse["status"]; access?: AgentToolUse["access"]; result?: AgentToolResult }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string }
  /** The SDK is summarizing the context to make room (`compacting`), or stopped (`null`). */
  | { type: "status"; status: "compacting" | null }
  /** The context was summarized: re-read the feed for its marker once the turn ends. */
  | { type: "compacted" };

/**
 * One context of the perpetual conversation: one SDK session. «Contexto nuevo»
 * starts another; going back makes an old one active again.
 */
export type AgentContext = {
  id: string;
  startedAt: number;
  /** Latest message in it, or null when it has none yet. */
  lastMessageAt: number | null;
  messageCount: number;
  active: boolean;
};

/**
 * A quiet line in the feed: `context` a context started («Contexto nuevo · fecha»),
 * `switch` the person went back to one, `compacted` the Coach summarized what came
 * before to keep going, `distilled` the conversation started from a summary of
 * the old ones.
 */
export type AgentFeedMarker = { id: string; kind: "context" | "switch" | "compacted" | "distilled"; contextId: string; createdAt: number };

export type AgentFeedItem = { type: "message"; message: AgentMessage } | { type: "marker"; marker: AgentFeedMarker };

/**
 * GET `…/conversation[?before=<cursor>&limit=]`: the latest page of the one
 * conversation, oldest first. `before` is the cursor for the page before this
 * one (null when there is nothing older).
 */
export type AgentConversation = {
  threadId: string;
  activeContextId: string;
  /** Newest first. */
  contexts: AgentContext[];
  items: AgentFeedItem[];
  before: string | null;
  /** A turn is in flight: re-attach with GET `…/conversation/turn`. */
  running: boolean;
  /** The hourly summary is running; sending waits for it. */
  compacting: boolean;
};

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
