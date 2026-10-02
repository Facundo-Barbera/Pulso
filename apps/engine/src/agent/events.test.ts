import { expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentToolResult } from "@pulso/contract";
import { newTurnState, translate } from "./events";

const m = (message: object) => ({ session_id: "s", parent_tool_use_id: null, ...message }) as unknown as SDKMessage;
const toolUse = (id: string, name: string) => m({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name, input: {} } } });
const toolResult = (id: string, content: unknown, is_error = false) => m({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error }] } });
const blocks = (value: unknown) => [{ type: "text", text: JSON.stringify(value) }];

const PROGRAM = { id: "p1", name: "Torso/Pierna", goal: "fuerza", weeks: 8, notes: null, active: true, createdAt: 0, days: [{}, {}, {}, {}] };

test("a write tool streams its action card and keeps it on the tool", () => {
  const state = newTurnState();
  expect(translate(toolUse("t1", "mcp__pulso__create_program"), state)).toEqual([{ type: "tool", name: "create_program", status: "running", access: "write" }]);
  const events = translate(toolResult("t1", blocks(PROGRAM)), state);
  const result: AgentToolResult = { title: "Programa creado", detail: "Torso/Pierna · 4 días", tab: "entreno", lines: [{ label: null, before: null, value: "Torso/Pierna · 4 días" }] };
  expect(events).toEqual([{ type: "tool", name: "create_program", status: "done", access: "write", result }]);
  expect(state.tools).toEqual([{ name: "create_program", status: "done", access: "write", result }]);
});

test("reads and failed writes stream without a card; reads and built-ins are marked read", () => {
  const state = newTurnState();
  expect(translate(toolUse("t1", "mcp__pulso__get_active_program"), state)).toEqual([{ type: "tool", name: "get_active_program", status: "running", access: "read" }]);
  translate(toolUse("t2", "mcp__pulso__create_program"), state);
  expect(translate(toolUse("t3", "WebSearch"), state)[0]).toMatchObject({ access: "read" });
  expect(translate(toolResult("t1", blocks(PROGRAM)), state)).toEqual([{ type: "tool", name: "get_active_program", status: "done", access: "read" }]);
  expect(translate(toolResult("t2", "Unknown exercise ids: x", true), state)).toEqual([{ type: "tool", name: "create_program", status: "error", access: "write" }]);
  expect(state.tools.every((t) => !("result" in t))).toBe(true);
});

test("the card is built from the tool's input in the complete assistant message", () => {
  const state = newTurnState();
  const assistant = m({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "t1", name: "mcp__pulso__log_meal", input: { items: [], addToDish: "d1" } }] },
  });
  translate(assistant, state);
  translate(toolResult("t1", blocks([{ id: "e1", name: "Fresas", kcal: 30, protein: 1, slot: "merienda" }])), state);
  // Adding to a logged dish: its own title, and no undo (it would take the earlier foods too).
  expect(state.tools[0]!.result).toMatchObject({ title: "Añadido al platillo" });
  expect(state.tools[0]!.result!.undo).toBeUndefined();
  expect(state.tools[0]!.revert).toBeUndefined();
});
