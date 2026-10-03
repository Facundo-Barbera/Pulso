import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentStreamEvent, AgentToolUse } from "@pulso/contract";
import { isWrite, snapshotBefore, summarizeAction, type Revert } from "./actions";
import { takeCardData } from "./model-results";

/** A tool as saved on its message: what clients see, plus how to undo it (stripped before it leaves the engine). */
export type StoredTool = AgentToolUse & { revert?: Revert };

/** What a turn has produced so far, built up from the SDK's messages. */
export type TurnState = {
  text: string;
  tools: StoredTool[];
  /** tool_use id → index in `tools`. */
  toolIndex: Map<string, number>;
  /** tool_use id → the tool's input, from the complete assistant message. */
  inputs: Map<string, unknown>;
  /** A new text block started after earlier text: separate it on its first delta. */
  pendingBreak: boolean;
  sessionId?: string;
  error?: string;
  /** The SDK summarized the context during this run. */
  compacted?: boolean;
};

export const newTurnState = (): TurnState => ({ text: "", tools: [], toolIndex: new Map(), inputs: new Map(), pendingBreak: false });

// tool_use id → what the tool was about to change, read just before it ran (the runner's PreToolUse hook).
const befores = new Map<string, unknown>();

/** Called right before a tool runs: keeps what it is about to change, for the card's before → after. */
export function rememberBefore(toolUseId: string, name: string, input: unknown): void {
  const before = snapshotBefore(toolName(name), input);
  if (before !== undefined) befores.set(toolUseId, before);
}

/** `mcp__pulso__list_workouts` → `list_workouts`; built-ins keep their name. */
export const toolName = (name: string) => name.replace(/^mcp__pulso__/, "");

/** True once the turn has shown the person something. */
export const hasOutput = (state: TurnState) => state.text.length > 0 || state.tools.length > 0;

function startTool(state: TurnState, id: string, name: string): AgentStreamEvent[] {
  if (state.toolIndex.has(id)) return [];
  const access = isWrite(toolName(name)) ? "write" : "read";
  state.toolIndex.set(id, state.tools.length);
  state.tools.push({ name: toolName(name), status: "running", access });
  return [{ type: "tool", name: toolName(name), status: "running", access }];
}

/**
 * Folds one SDK message into `state` and returns the stream events it means for
 * the phone. Only the main agent's output is shown (no subagent frames). Text
 * arrives through partial `stream_event`s, so complete assistant messages only
 * contribute tool calls the partials may have missed.
 */
export function translate(message: SDKMessage, state: TurnState): AgentStreamEvent[] {
  if ("session_id" in message && typeof message.session_id === "string" && message.session_id) state.sessionId = message.session_id;
  if ("parent_tool_use_id" in message && message.parent_tool_use_id) return [];

  switch (message.type) {
    case "stream_event": {
      const event = message.event;
      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "text") state.pendingBreak = state.text.length > 0;
        if (block.type === "tool_use" || block.type === "mcp_tool_use") return startTool(state, block.id, block.name);
        return [];
      }
      if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text) {
        const delta = (state.pendingBreak && !state.text.endsWith("\n\n") ? "\n\n" : "") + event.delta.text;
        state.pendingBreak = false;
        state.text += delta;
        return [{ type: "text", delta }];
      }
      return [];
    }
    case "assistant":
      return message.message.content.flatMap((block) => {
        if (block.type !== "tool_use" && block.type !== "mcp_tool_use") return [];
        state.inputs.set(block.id, block.input);
        return startTool(state, block.id, block.name);
      });
    case "user": {
      const content = message.message.content;
      if (typeof content === "string") return [];
      const events: AgentStreamEvent[] = [];
      for (const block of content) {
        if (block.type !== "tool_result") continue;
        const index = state.toolIndex.get(block.tool_use_id);
        const tool = index === undefined ? undefined : state.tools[index];
        if (!tool || tool.status !== "running") continue;
        tool.status = block.is_error ? "error" : "done";
        const before = befores.get(block.tool_use_id);
        befores.delete(block.tool_use_id);
        const card = takeCardData(block.tool_use_id);
        const action = block.is_error ? null : summarizeAction(tool.name, state.inputs.get(block.tool_use_id), block.content, before, card === undefined ? undefined : { value: card });
        if (action) {
          tool.result = action.card;
          if (action.revert) tool.revert = action.revert;
        }
        const event: AgentStreamEvent = { type: "tool", name: tool.name, status: tool.status, access: tool.access };
        events.push(action ? { ...event, result: action.card } : event);
      }
      return events;
    }
    case "system":
      // The SDK making room in the context: a status while it summarizes, a boundary once it has.
      if (message.subtype === "status") return [{ type: "status", status: message.status === "compacting" ? "compacting" : null }];
      if (message.subtype === "compact_boundary") {
        state.compacted = true;
        return [{ type: "compacted" }];
      }
      return [];
    case "result":
      if (message.subtype !== "success") state.error = message.errors.join("\n") || message.subtype;
      else if (message.is_error) state.error = message.result || "error";
      return [];
    default:
      return [];
  }
}
