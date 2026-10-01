import { createSdkMcpServer, query, type HookCallback, type Options } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage, AgentStreamEvent } from "@pulso/contract";
import { hasOutput, newTurnState, translate, type TurnState } from "./events";
import { getProfile } from "./profile";
import { childEnv, claudeExecutable, providerEnv } from "./provider";
import { TOOLS } from "./registry";
import { addMessage, failStreamingMessages, listMessages, sdkSessionOf, setSdkSession, updateMessage } from "./threads";
import { claudeMd, insideWorkspace, PERSONA, prepareWorkspace } from "./workspace";

export type QueryFn = typeof query;

/** A turn in flight. Events are kept so a late subscriber gets the whole turn. */
type Turn = { threadId: string; messageId: string; events: AgentStreamEvent[]; listeners: Set<(event: AgentStreamEvent) => void> };

const TURN_LIMIT_MS = 15 * 60_000;
const SAVE_EVERY_MS = 750;
const RECAP_MESSAGES = 20;
const RECAP_CHARS = 1500;
const BUILTIN_TOOLS = ["Read", "Write", "WebSearch", "WebFetch"];

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

/**
 * A clean start: the agent knows only the conversation, the profile and the
 * pulso tools. No settings, hooks, plugins, skills, CLAUDE.md files or memory
 * from this Mac are loaded; the thread's own CLAUDE.md goes in the system prompt.
 */
export function agentOptions(cwd: string, context: string, resume: string | undefined, abortController: AbortController): Options {
  return {
    cwd,
    resume,
    abortController,
    model: process.env.PULSO_AGENT_MODEL || undefined,
    systemPrompt: { type: "preset", preset: "claude_code", append: `${PERSONA}\n\n${context}` },
    settingSources: [],
    skills: [],
    strictMcpConfig: true,
    mcpServers: { pulso: createSdkMcpServer({ name: "pulso", version: "1.0.0", tools: TOOLS }) },
    tools: BUILTIN_TOOLS,
    allowedTools: ["mcp__pulso", ...BUILTIN_TOOLS],
    // Nobody is at the Mac to approve anything: what is not allowed above is denied, never asked.
    permissionMode: "dontAsk",
    permissionPrompts: "none",
    hooks: { PreToolUse: [{ matcher: "Read|Write", hooks: [confineTo(cwd)] }] },
    includePartialMessages: true,
    maxTurns: 40,
    // Like Telar: the installed CLI and a clean env with the configured provider (./provider.ts).
    pathToClaudeCodeExecutable: claudeExecutable(),
    env: {
      ...childEnv(providerEnv()),
      CLAUDE_AGENT_SDK_CLIENT_APP: "pulso-coach/0.0.0",
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    },
  };
}

/** The prompt for a fresh SDK session when the old one could not be resumed. */
export function recapPrompt(history: AgentMessage[], text: string): string {
  const lines = history
    .filter((m) => m.text.trim())
    .slice(-RECAP_MESSAGES)
    .map((m) => `${m.role === "user" ? "Persona" : "Coach"}: ${m.text.length > RECAP_CHARS ? `${m.text.slice(0, RECAP_CHARS)}…` : m.text}`);
  if (!lines.length) return text;
  return [
    "(Context: this conversation continues from an earlier session whose memory was lost. These are its most recent messages, oldest first. Do not mention this recap.)",
    "<recap>",
    lines.join("\n\n"),
    "</recap>",
    "",
    "The person's new message:",
    text,
  ].join("\n");
}

/**
 * Starts a turn and returns at once; the turn runs to the end and is saved
 * whether or not anyone is listening. Throws `busy` if the thread already has one.
 */
export function startTurn(threadId: string, text: string, run: QueryFn = query): { turn: Turn; done: Promise<void> } {
  if (turns().has(threadId)) throw new Error("busy");
  const history = listMessages(threadId);
  const user = addMessage(threadId, "user", text, "done");
  const assistant = addMessage(threadId, "assistant", "", "streaming");
  const turn: Turn = { threadId, messageId: assistant.id, events: [], listeners: new Set() };
  turns().set(threadId, turn);
  emit(turn, { type: "start", messageId: assistant.id, userMessageId: user.id });
  const done = runTurn(turn, history, text, run).finally(() => turns().delete(threadId));
  return { turn, done };
}

async function runTurn(turn: Turn, history: AgentMessage[], text: string, run: QueryFn): Promise<void> {
  let state = newTurnState();
  let lastSave = 0;
  const save = (force: boolean) => {
    if (!force && Date.now() - lastSave < SAVE_EVERY_MS) return;
    lastSave = Date.now();
    updateMessage(turn.messageId, { text: state.text, tools: state.tools, status: "streaming" });
  };

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), TURN_LIMIT_MS);

  const attempt = async (prompt: string, resume: string | undefined) => {
    state = newTurnState();
    const context = claudeMd(getProfile());
    const cwd = prepareWorkspace(turn.threadId, context);
    try {
      for await (const message of run({ prompt, options: agentOptions(cwd, context, resume, abortController) })) {
        const known = state.sessionId;
        const events = translate(message, state);
        if (state.sessionId && state.sessionId !== known) setSdkSession(turn.threadId, state.sessionId);
        for (const event of events) emit(turn, event);
        if (events.length) save(events.some((e) => e.type === "tool"));
      }
    } catch (error) {
      state.error ??= abortController.signal.aborted ? "La respuesta tardó demasiado y se cortó." : error instanceof Error ? error.message : String(error);
    }
  };

  try {
    const resume = sdkSessionOf(turn.threadId) ?? undefined;
    await attempt(resume ? text : recapPrompt(history, text), resume);
    // The SDK session is gone (or broken) and nothing reached the phone: start over from SQLite.
    if (resume && state.error && !hasOutput(state) && !abortController.signal.aborted) {
      console.warn(`[agent] resume of ${resume} failed (${state.error}); starting a fresh session`);
      setSdkSession(turn.threadId, null);
      await attempt(recapPrompt(history, text), undefined);
    }
  } finally {
    clearTimeout(timer);
  }

  const failed = state.error !== undefined && !state.text;
  for (const tool of state.tools) if (tool.status === "running") tool.status = failed ? "error" : "done";
  updateMessage(turn.messageId, { text: state.text, tools: state.tools, status: failed ? "error" : "done", error: state.error ?? null });
  if (failed) {
    console.error(`[agent] turn ${turn.messageId} failed: ${state.error}`);
    emit(turn, { type: "error", message: "El Coach no pudo responder. Intenta de nuevo en un momento." });
  } else {
    emit(turn, { type: "done", messageId: turn.messageId });
  }
}
