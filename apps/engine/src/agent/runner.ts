import { createSdkMcpServer, query, type HookCallback, type Options, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentAttachment, AgentMessage, AgentProduct, AgentStreamEvent } from "@pulso/contract";
import { describeProduct } from "../nutrition/portion";
import { readImageBase64 } from "./attachments";
import { contextMessages, contextOfThread, recordCompaction, setContextSession } from "./conversation";
import { hasOutput, newTurnState, rememberBefore, translate, type TurnState } from "./events";
import { getProfile } from "./profile";
import { childEnv, claudeExecutable, providerEnv } from "./provider";
import { forModel } from "./model-results";
import { TOOLS } from "./registry";
import { addMessage, failStreamingMessages, listMessages, sdkSessionOf, setSdkSession, updateMessage } from "./threads";
import { sdkConfigDir, stripImages } from "./transcripts";
import { liveCoachMode } from "../training/live-coach";
import { claudeMd, insideWorkspace, PERSONA, prepareWorkspace } from "./workspace";

/** A thread with its own short prompt and tool subset (the in-workout Coach). */
export type TurnMode = { persona: string; context: string; tools: string[] };

export type QueryFn = typeof query;

type Prompt = Parameters<QueryFn>[0]["prompt"];
type ContentBlock = Exclude<SDKUserMessage["message"]["content"], string>[number];

/** A turn in flight. Events are kept so a late subscriber gets the whole turn. */
type Turn = {
  threadId: string;
  messageId: string;
  events: AgentStreamEvent[];
  listeners: Set<(event: AgentStreamEvent) => void>;
  abortController: AbortController;
  /** The person pressed stop, as opposed to the time limit. */
  stopped: boolean;
};

const TURN_LIMIT_MS = 15 * 60_000;
const SAVE_EVERY_MS = 750;
const RECAP_MESSAGES = 20;
const RECAP_CHARS = 1500;
const STOPPED = "Detuviste la respuesta.";
const BUILTIN_TOOLS = ["Read", "Write", "WebSearch", "WebFetch"];
/** The pulso tools as the Coach reads them: leaned results, full values kept for the cards. */
const COACH_TOOLS = TOOLS.map(forModel);
/** Tokens of context before the SDK summarizes it by itself (its autoCompactWindow; the model's own window caps it). */
export const AUTO_COMPACT_WINDOW = 200_000;

// Survives Next's dev reloads, like the db connection.
const g = globalThis as { __pulso_turns__?: Map<string, Turn> };
function turns(): Map<string, Turn> {
  if (!g.__pulso_turns__) {
    g.__pulso_turns__ = new Map();
    // A fresh process has no turns running: anything still streaming died with the last one.
    failStreamingMessages("La Mac se reinició antes de terminar esta respuesta.");
  }
  return g.__pulso_turns__;
}

export const activeTurn = (threadId: string): Turn | undefined => turns().get(threadId);

/** Replays the turn so far, then forwards live events. Returns the unsubscribe. */
export function subscribe(turn: Turn, listener: (event: AgentStreamEvent) => void): () => void {
  for (const event of turn.events) listener(event);
  turn.listeners.add(listener);
  return () => turn.listeners.delete(listener);
}

/** The person's stop: ends the turn in flight, keeping what it wrote so far. False when nothing is running. */
export function stopTurn(threadId: string): boolean {
  const turn = turns().get(threadId);
  if (!turn) return false;
  turn.stopped = true;
  turn.abortController.abort();
  return true;
}

function emit(turn: Turn, event: AgentStreamEvent): void {
  turn.events.push(event);
  for (const listener of turn.listeners) listener(event);
}

/** Read and Write are only for the thread's own scratch directory. */
const confineTo =
  (dir: string): HookCallback =>
  async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const file = (input.tool_input as { file_path?: unknown })?.file_path;
    if (typeof file === "string" && insideWorkspace(dir, file)) return {};
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Only files inside this conversation's directory are available." } };
  };

/** Reads what a pulso tool is about to change, for its action card's before → after. Never blocks the tool. */
const snapshot: HookCallback = async (input, toolUseID) => {
  if (input.hook_event_name === "PreToolUse") rememberBefore(toolUseID ?? input.tool_use_id, input.tool_name, input.tool_input);
  return {};
};
const SNAPSHOT_HOOK = { matcher: "mcp__pulso__.*", hooks: [snapshot] };

/**
 * A clean start: the agent knows only the conversation, the profile and the
 * pulso tools. No settings, hooks, plugins, skills, CLAUDE.md files or memory
 * from this Mac are loaded; the thread's own CLAUDE.md goes in the system prompt.
 * Transcripts live in Pulso's data dir (./transcripts.ts) and the context is
 * summarized by the SDK as it nears AUTO_COMPACT_WINDOW tokens.
 */
export function agentOptions(cwd: string, context: string, resume: string | undefined, abortController: AbortController, mode?: TurnMode): Options {
  // childEnv drops CLAUDE_*, but a DISABLE_*COMPACT left in the engine's env would still switch compaction off.
  const { DISABLE_AUTO_COMPACT: _auto, DISABLE_COMPACT: _compact, ...env } = childEnv(providerEnv());
  const base: Options = {
    cwd,
    resume,
    abortController,
    model: process.env.PULSO_AGENT_MODEL || undefined,
    systemPrompt: { type: "preset", preset: "claude_code", append: `${PERSONA}\n\n${context}` },
    settingSources: [],
    // The flag-settings layer applies even with no setting sources. Pulso prunes transcripts itself, so the CLI's sweep is pushed out of the way.
    settings: { autoCompactEnabled: true, autoCompactWindow: AUTO_COMPACT_WINDOW, cleanupPeriodDays: 3650 },
    skills: [],
    strictMcpConfig: true,
    mcpServers: { pulso: createSdkMcpServer({ name: "pulso", version: "1.0.0", tools: COACH_TOOLS }) },
    tools: BUILTIN_TOOLS,
    allowedTools: ["mcp__pulso", ...BUILTIN_TOOLS],
    // Nobody is at the Mac to approve anything: what is not allowed above is denied, never asked.
    permissionMode: "dontAsk",
    permissionPrompts: "none",
    hooks: { PreToolUse: [{ matcher: "Read|Write", hooks: [confineTo(cwd)] }, SNAPSHOT_HOOK] },
    includePartialMessages: true,
    maxTurns: 40,
    // Like Telar: the installed CLI and a clean env with the configured provider (./provider.ts).
    pathToClaudeCodeExecutable: claudeExecutable(),
    env: {
      ...env,
      CLAUDE_CONFIG_DIR: sdkConfigDir(),
      CLAUDE_AGENT_SDK_CLIENT_APP: "pulso-coach/0.0.0",
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    },
  };
  if (!mode) return base;
  // Fast turns: a short plain prompt instead of Claude Code's, only the tools it needs, no files or web.
  return {
    ...base,
    systemPrompt: `${mode.persona}\n\n${mode.context}`,
    mcpServers: { pulso: createSdkMcpServer({ name: "pulso", version: "1.0.0", tools: COACH_TOOLS.filter((t) => mode.tools.includes(t.name)) }) },
    tools: [],
    allowedTools: ["mcp__pulso"],
    hooks: { PreToolUse: [SNAPSHOT_HOOK] },
    maxTurns: 8,
  };
}

/**
 * The prompt for a fresh SDK session: the context's own messages when its old
 * session could not be resumed, and the digest of the old conversations when
 * the context starts from one.
 */
export function recapPrompt(history: AgentMessage[], text: string, seed?: string | null): string {
  const photos = (m: AgentMessage) => (m.attachments.length ? `[${m.attachments.length > 1 ? `${m.attachments.length} fotos` : "foto"}] ` : "");
  const scanned = (m: AgentMessage) => (m.products ?? []).map((p) => `[producto ${p.barcode}${p.product ? `: ${p.product.name}` : ""}] `).join("");
  const lines = history
    .filter((m) => m.text.trim() || m.attachments.length || m.products?.length)
    .slice(-RECAP_MESSAGES)
    .map((m) => `${m.role === "user" ? "Persona" : "Coach"}: ${photos(m)}${scanned(m)}${m.text.length > RECAP_CHARS ? `${m.text.slice(0, RECAP_CHARS)}…` : m.text}`);
  if (!lines.length && !seed) return text;
  return [
    ...(seed
      ? [
          "(Context: a summary of your earlier conversations with this person, from before the app kept a single conversation. Treat it as what you remember; do not mention it unless they ask.)",
          "<earlier_conversations>",
          seed,
          "</earlier_conversations>",
          "",
        ]
      : []),
    ...(lines.length
      ? [
          "(Context: this conversation continues from an earlier session whose memory was lost. These are its most recent messages, oldest first. Do not mention this recap.)",
          "<recap>",
          lines.join("\n\n"),
          "</recap>",
          "",
        ]
      : []),
    "The person's new message:",
    text,
  ].join("\n");
}

/**
 * A brief or review the app put in the conversation after the last turn is not
 * in the SDK session: it goes with the person's message, since they may be
 * answering it.
 */
export function withQuoted(history: AgentMessage[], text: string): string {
  const lastUser = history.findLastIndex((m) => m.role === "user");
  const quoted = history.slice(lastUser + 1).filter((m) => m.role === "assistant" && m.source && m.text.trim());
  if (!quoted.length) return text;
  return [
    "(Since your last reply, the app showed the person this from you; their message may answer it.)",
    ...quoted.map((m) => `<${m.source!.kind} title="${m.source!.title}">\n${m.text}\n</${m.source!.kind}>`),
    "",
    "The person's message:",
    text,
  ].join("\n");
}

/**
 * Scanned products go before the person's words as structured text, so the
 * model reads the label values instead of guessing them.
 */
export function withProducts(text: string, products: AgentProduct[]): string {
  if (!products.length) return text;
  const blocks = products.map((p) => `<scanned_product>\n${describeProduct(p.barcode, p.product)}\n</scanned_product>`);
  const said = text.trim() ? `The person's message:\n${text}` : "The person sent only the scan: ask what they want to do with it (e.g. how much they ate).";
  return [
    "(The person scanned this product with the app and attached it to the message. To log a part of it, use estimate_portion with its barcode and their words for the amount, then log_meal with the returned logItem.)",
    ...blocks,
    said,
  ].join("\n\n");
}

/**
 * The person's message for the SDK: the text alone, or — with photos — one user
 * message whose content is the photos as base64 image blocks, then the text.
 * The photos are read from disk here; they leave the Mac only in this model call.
 */
export function userPrompt(threadId: string, text: string, attachments: AgentAttachment[]): Prompt {
  if (!attachments.length) return text;
  const content: ContentBlock[] = attachments.map((a) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: readImageBase64(threadId, a.id) },
  }));
  if (text.trim()) content.push({ type: "text", text });
  const message: SDKUserMessage = { type: "user", message: { role: "user", content }, parent_tool_use_id: null };
  return (async function* () {
    yield message;
  })();
}

/**
 * Starts a turn and returns at once; the turn runs to the end and is saved
 * whether or not anyone is listening. Throws `busy` if the thread already has one.
 */
export function startTurn(
  threadId: string,
  text: string,
  run: QueryFn = query,
  attachments: AgentAttachment[] = [],
  products: AgentProduct[] = [],
): { turn: Turn; done: Promise<void> } {
  if (turns().has(threadId)) throw new Error("busy");
  // In the conversation a turn sees only its context: its session, and its messages for a recap.
  const context = contextOfThread(threadId);
  const history = context ? contextMessages(context.id) : listMessages(threadId);
  const user = addMessage(threadId, "user", text, "done", attachments, products);
  const assistant = addMessage(threadId, "assistant", "", "streaming");
  const turn: Turn = { threadId, messageId: assistant.id, events: [], listeners: new Set(), abortController: new AbortController(), stopped: false };
  turns().set(threadId, turn);
  emit(turn, { type: "start", messageId: assistant.id, userMessageId: user.id });
  const slot: SessionSlot = context
    ? { get: () => context.sdk_session_id, set: (id) => setContextSession(context.id, id), seed: context.seed, compacted: () => recordCompaction(context.id, Date.now(), user.createdAt) }
    : { get: () => sdkSessionOf(threadId), set: (id) => setSdkSession(threadId, id), seed: null, compacted: () => {} };
  const done = runTurn(turn, history, withProducts(text, products), attachments, run, slot, !!context).finally(() => turns().delete(threadId));
  return { turn, done };
}

/** Where a turn's SDK session lives: the conversation's active context, or the thread itself. */
type SessionSlot = { get: () => string | null; set: (id: string | null) => void; seed: string | null; compacted: () => void };

async function runTurn(turn: Turn, history: AgentMessage[], text: string, attachments: AgentAttachment[], run: QueryFn, slot: SessionSlot, shared: boolean): Promise<void> {
  let state = newTurnState();
  let lastSave = 0;
  const save = (force: boolean) => {
    if (!force && Date.now() - lastSave < SAVE_EVERY_MS) return;
    lastSave = Date.now();
    updateMessage(turn.messageId, { text: state.text, tools: state.tools, status: "streaming" });
  };

  const { abortController } = turn;
  const timer = setTimeout(() => abortController.abort(), TURN_LIMIT_MS);

  const attempt = async (promptText: string, resume: string | undefined) => {
    state = newTurnState();
    const mode = liveCoachMode(turn.threadId);
    const context = mode?.context ?? claudeMd(getProfile());
    const cwd = prepareWorkspace(shared ? null : turn.threadId, context);
    try {
      const prompt = userPrompt(turn.threadId, promptText, attachments);
      for await (const message of run({ prompt, options: agentOptions(cwd, context, resume, abortController, mode) })) {
        const known = state.sessionId;
        const events = translate(message, state);
        if (state.sessionId && state.sessionId !== known) slot.set(state.sessionId);
        if (events.some((e) => e.type === "compacted")) slot.compacted();
        for (const event of events) emit(turn, event);
        if (events.length) save(events.some((e) => e.type === "tool"));
      }
    } catch (error) {
      state.error ??= turn.stopped ? STOPPED : abortController.signal.aborted ? "La respuesta tardó demasiado y se cortó." : error instanceof Error ? error.message : String(error);
    }
  };

  try {
    const resume = slot.get() ?? undefined;
    // The photos of the last turn have been read: they leave the transcript before it goes to the model again.
    if (resume && history.findLast((m) => m.role === "user")?.attachments.length) stripImages(resume);
    await attempt(resume ? withQuoted(history, text) : recapPrompt(history, text, slot.seed), resume);
    // The SDK session is gone (or broken) and nothing reached the phone: start over from SQLite.
    if (resume && state.error && !hasOutput(state) && !abortController.signal.aborted) {
      console.warn(`[agent] resume of ${resume} failed (${state.error}); starting a fresh session`);
      slot.set(null);
      await attempt(recapPrompt(history, text, slot.seed), undefined);
    }
  } finally {
    clearTimeout(timer);
  }

  // A stop keeps what was written as the answer; with nothing written it reads as stopped, not failed.
  if (turn.stopped) state.error = state.text ? undefined : STOPPED;
  const failed = state.error !== undefined && !state.text;
  for (const tool of state.tools) if (tool.status === "running") tool.status = failed ? "error" : "done";
  updateMessage(turn.messageId, { text: state.text, tools: state.tools, status: failed ? "error" : "done", error: state.error ?? null });
  if (failed) {
    if (!turn.stopped) console.error(`[agent] turn ${turn.messageId} failed: ${state.error}`);
    emit(turn, { type: "error", message: turn.stopped ? STOPPED : "El Coach no pudo responder. Intenta de nuevo en un momento." });
  } else {
    emit(turn, { type: "done", messageId: turn.messageId });
  }
}
