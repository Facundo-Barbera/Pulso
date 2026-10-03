import { expect, test } from "bun:test";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { withCard } from "./card";
import { newTurnState, translate } from "./events";
import { forModel, lean, takeCardData, withoutCard } from "./model-results";

const text = (r: { content: { type: string; text?: string }[] }) => r.content.map((c) => c.text ?? "").join("");
const extra = (id: string) => ({ _meta: { "claudecode/toolUseId": id } });

test("lean drops null fields, empty lists and objects, and rounds numbers; positions in a list stay", () => {
  expect(lean({ a: null, b: [], c: {}, d: { e: null }, f: false, g: 0, h: 1.23456, i: [null, 2], j: "" })).toEqual({ f: false, g: 0, h: 1.23, i: [null, 2], j: "" });
});

test("the model reads the lean result; a write tool's card keeps the full one", async () => {
  const full = { program: { name: "Torso/Pierna", notes: null, days: [] }, nextDayId: null };
  const write = forModel(tool("update_profile", "", {}, async () => ({ content: [{ type: "text", text: JSON.stringify(full) }] })));
  const result = await write.handler({}, extra("tu_1"));
  expect(JSON.parse(text(result))).toEqual({ program: { name: "Torso/Pierna" } });
  expect(takeCardData("tu_1")).toEqual(full);
  expect(takeCardData("tu_1")).toBeUndefined();
});

test("withCard: the model reads one value, the card gets another, and neither leaks to MCP clients", async () => {
  const write = forModel(tool("update_profile", "", {}, async () => withCard({ changed: 1 }, { whole: "program" })));
  const result = await write.handler({}, extra("tu_2"));
  expect(JSON.parse(text(result))).toEqual({ changed: 1 });
  expect(result._meta).toBeUndefined();
  expect(takeCardData("tu_2")).toEqual({ whole: "program" });
  expect(withoutCard(withCard(1, 2))).toEqual({ content: [{ type: "text", text: "1" }] });
});

test("reads keep no card; errors and plain text pass through", async () => {
  const read = forModel(tool("get_profile", "", {}, async () => ({ content: [{ type: "text", text: '{"a":null}' }] })));
  expect(text(await read.handler({}, extra("tu_3")))).toBe("{}");
  expect(takeCardData("tu_3")).toBeUndefined();
  const failing = forModel(tool("update_profile", "", {}, async () => ({ content: [{ type: "text", text: "Unknown id" }], isError: true })));
  expect(text(await failing.handler({}, extra("tu_4")))).toBe("Unknown id");
  expect(takeCardData("tu_4")).toBeUndefined();
});

test("the action card is built from the kept value, not the slim text the model read", async () => {
  const saved = { age: 38, goals: "Bajar grasa" };
  const write = forModel(tool("update_profile", "", {}, async () => withCard({ saved: ["goals"] }, saved)));
  const result = await write.handler({}, extra("tu_5"));
  const state = newTurnState();
  translate({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu_5", name: "mcp__pulso__update_profile", input: { goals: "Bajar grasa" } }] } } as never, state);
  const [event] = translate({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu_5", content: result.content }] } } as never, state);
  expect(event).toMatchObject({ type: "tool", status: "done", result: { title: "Perfil actualizado", lines: [{ label: "Objetivo", value: "Bajar grasa" }] } });
});
