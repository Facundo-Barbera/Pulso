import { expect, test } from "bun:test";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentStreamEvent } from "@pulso/contract";
import { encodeEvent, eventStream } from "./ndjson";
import { recapPrompt, startTurn, subscribe, type QueryFn } from "./runner";
import { addMessage, createThread, getMessage, sdkSessionOf, setSdkSession } from "./threads";

const SESSION = "11111111-1111-1111-1111-111111111111";

// Just enough of each SDK message for the translator.
const m = (message: object) => ({ session_id: SESSION, parent_tool_use_id: null, ...message }) as unknown as SDKMessage;
const blockStart = (content_block: object) => m({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block } });
const textDelta = (text: string) => m({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
const toolResult = (id: string, is_error = false) => m({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "[]", is_error }] } });
const success = m({ type: "result", subtype: "success", is_error: false, result: "" });

const TURN: SDKMessage[] = [
  m({ type: "system", subtype: "init" }),
  blockStart({ type: "text", text: "" }),
  textDelta("Miro tus "),
  textDelta("entrenos."),
  blockStart({ type: "tool_use", id: "t1", name: "mcp__pulso__list_workouts", input: {} }),
  toolResult("t1"),
  blockStart({ type: "text", text: "" }),
  textDelta("Vas **bien**."),
  // A subagent's output never reaches the phone.
  m({ type: "stream_event", parent_tool_use_id: "t9", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ruido" } } }),
  success,
];

type Call = { prompt: string; options: Options };

function fakeQuery(scripts: SDKMessage[][], calls: Call[] = []): QueryFn {
  return (({ prompt, options }: { prompt: string; options: Options }) => {
    calls.push({ prompt, options });
    const script = scripts[calls.length - 1] ?? [];
    return (async function* () {
      for (const message of script) {
        await Bun.sleep(1);
        yield message;
      }
    })();
  }) as unknown as QueryFn;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<AgentStreamEvent[]> {
  const text = await new Response(stream).text();
  expect(text.endsWith("\n")).toBe(true);
  return text.trimEnd().split("\n").map((line) => JSON.parse(line) as AgentStreamEvent);
}

test("encodeEvent writes one JSON object per line", () => {
  expect(encodeEvent({ type: "text", delta: "a\nb" })).toBe('{"type":"text","delta":"a\\nb"}\n');
});

test("a turn streams text and tool activity as NDJSON and is saved", async () => {
  const thread = createThread();
  const calls: Call[] = [];
  const { turn, done } = startTurn(thread.id, "¿Cómo voy?", fakeQuery([TURN], calls));
  const events = await readAll(eventStream((emit) => subscribe(turn, emit)));
  await done;

  expect(events[0]).toMatchObject({ type: "start", messageId: turn.messageId });
  expect(events.slice(1)).toEqual([
    { type: "text", delta: "Miro tus " },
    { type: "text", delta: "entrenos." },
    { type: "tool", name: "list_workouts", status: "running" },
    { type: "tool", name: "list_workouts", status: "done" },
    { type: "text", delta: "\n\nVas **bien**." },
    { type: "done", messageId: turn.messageId },
  ]);
  expect(getMessage(turn.messageId)).toMatchObject({
    text: "Miro tus entrenos.\n\nVas **bien**.",
    status: "done",
    tools: [{ name: "list_workouts", status: "done" }],
  });
  expect(sdkSessionOf(thread.id)).toBe(SESSION);

  const { options } = calls[0]!;
  expect(options.resume).toBeUndefined();
  expect(options.tools).not.toContain("Bash");
  expect(options.permissionMode).toBe("dontAsk");
  expect(options.cwd).toContain(thread.id);
});

test("the turn finishes and is saved after the phone hangs up", async () => {
  const thread = createThread();
  const { turn, done } = startTurn(thread.id, "hola", fakeQuery([TURN]));
  const reader = eventStream((emit) => subscribe(turn, emit)).getReader();
  await reader.read();
  await reader.cancel();
  await done;
  expect(getMessage(turn.messageId)?.status).toBe("done");
  expect(getMessage(turn.messageId)?.text).toContain("Vas **bien**.");
});

test("a late subscriber gets the whole turn replayed", async () => {
  const thread = createThread();
  const { turn, done } = startTurn(thread.id, "hola", fakeQuery([TURN]));
  await done;
  const events = await readAll(eventStream((emit) => subscribe(turn, emit)));
  expect(events.at(-1)).toEqual({ type: "done", messageId: turn.messageId });
});

test("one turn at a time per thread", async () => {
  const thread = createThread();
  const { done } = startTurn(thread.id, "uno", fakeQuery([TURN]));
  expect(() => startTurn(thread.id, "dos", fakeQuery([TURN]))).toThrow("busy");
  await done;
});

test("when resume fails, a fresh session starts primed with a recap", async () => {
  const thread = createThread();
  addMessage(thread.id, "user", "Entreno lunes y jueves", "done");
  addMessage(thread.id, "assistant", "Anotado.", "done");
  setSdkSession(thread.id, "gone");
  const calls: Call[] = [];
  const failure = m({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["No conversation found"], session_id: "gone" });
  const { turn, done } = startTurn(thread.id, "¿Y el sábado?", fakeQuery([[failure], TURN], calls));
  await done;

  expect(calls).toHaveLength(2);
  expect(calls[0]).toMatchObject({ prompt: "¿Y el sábado?", options: { resume: "gone" } });
  expect(calls[1]!.options.resume).toBeUndefined();
  expect(calls[1]!.prompt).toContain("Persona: Entreno lunes y jueves");
  expect(calls[1]!.prompt).toContain("Coach: Anotado.");
  expect(calls[1]!.prompt.endsWith("¿Y el sábado?")).toBe(true);
  expect(sdkSessionOf(thread.id)).toBe(SESSION);
  expect(getMessage(turn.messageId)?.status).toBe("done");
});

test("a turn that fails without output ends with an error event and an error message", async () => {
  const thread = createThread();
  const { turn, done } = startTurn(thread.id, "hola", fakeQuery([[m({ type: "result", subtype: "error_max_turns", is_error: true, errors: [] })]]));
  await done;
  expect(turn.events.at(-1)?.type).toBe("error");
  expect(getMessage(turn.messageId)).toMatchObject({ status: "error", error: "error_max_turns" });
});

test("recapPrompt with no history is just the message", () => {
  expect(recapPrompt([], "hola")).toBe("hola");
});
