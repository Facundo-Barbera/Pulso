import { expect, test } from "bun:test";
import type { AgentFeedItem, AgentMessage, AgentStreamEvent } from "@pulso/contract";
import { applyEvent, mergeLatest, prependOlder, readEvents } from "./stream";
import { isAction, placeOf, toolLook } from "./tools";

function body(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

test("events split across chunks arrive whole, in order", async () => {
  const events: AgentStreamEvent[] = [];
  for await (const event of readEvents(body(['{"type":"text","de', 'lta":"Ho"}\n{"type":"text","delta":"la"}\n{"type":"done","messageId":"m"}']))) events.push(event);
  expect(events).toEqual([
    { type: "text", delta: "Ho" },
    { type: "text", delta: "la" },
    { type: "done", messageId: "m" },
  ]);
});

test("a turn's events build the reply", () => {
  const start: AgentMessage = { id: "a", threadId: "t", role: "assistant", text: "", attachments: [], products: [], tools: [], status: "streaming", error: null, createdAt: 0 };
  const result = { title: "Comida registrada", detail: "Avena · 350 kcal", tab: "dieta" as const };
  const events: AgentStreamEvent[] = [
    { type: "tool", name: "list_meals", status: "running" },
    { type: "tool", name: "log_meal", status: "running" },
    { type: "tool", name: "log_meal", status: "done", result },
    { type: "text", delta: "Listo." },
    { type: "done", messageId: "a" },
  ];
  const end = events.reduce(applyEvent, start);
  expect(end).toMatchObject({ text: "Listo.", status: "done", tools: [{ name: "list_meals", status: "done" }, { name: "log_meal", status: "done", result }] });
  expect(start.tools).toEqual([]);
});

test("tools read in the person's words", () => {
  expect(toolLook("get_daily_metrics").label).toBe("Revisando tus métricas del día");
  expect(toolLook("log_meal").label).toBe("Actualizando tu alimentación");
  expect(toolLook("get_sleep_summary").label).toBe("Revisando tu sueño");
  expect(toolLook("plan_training_week").label).toBe("Actualizando tu entrenamiento");
  expect(toolLook("WebSearch").label).toBe("Buscando en la web");
  expect(toolLook("something_new").label).toBe("Consultando tus datos");
});

const message = (id: string, role: AgentMessage["role"], text = ""): AgentMessage => ({
  id, threadId: "t", role, text, attachments: [], products: [], tools: [], status: "done", error: null, createdAt: 0,
});

const msg = (id: string, role: AgentMessage["role"] = "user"): AgentFeedItem => ({ type: "message", message: message(id, role) });
const mark = (id: string): AgentFeedItem => ({ type: "marker", marker: { id, kind: "compacted", contextId: "c", createdAt: 0 } });
const ids = (items: AgentFeedItem[]) => items.map((i) => (i.type === "message" ? i.message.id : `#${i.marker.id}`));

test("the latest page keeps local ids and the older rows above it", () => {
  const shown = [msg("m0"), mark("k1"), msg("m1"), msg("local-u"), msg("local-a", "assistant")];
  const page = [mark("k1"), msg("m1"), msg("s-u"), msg("s-a", "assistant"), mark("k2")];
  const { items, continuous } = mergeLatest(shown, page, new Map([["s-u", "local-u"], ["s-a", "local-a"]]));
  expect(continuous).toBe(true);
  expect(ids(items)).toEqual(["m0", "#k1", "m1", "local-u", "local-a", "#k2"]);
});

test("a page that doesn't reach what was shown replaces it; a send the Mac never saved goes", () => {
  expect(mergeLatest([msg("m0")], [msg("m5"), msg("m6")], new Map())).toEqual({ items: [msg("m5"), msg("m6")], continuous: false });
  expect(ids(mergeLatest([msg("m1"), msg("local-a", "assistant")], [msg("m1")], new Map()).items)).toEqual(["m1"]);
  expect(mergeLatest([], [mark("k")], new Map()).continuous).toBe(true);
});

test("an older page goes on top, a shared marker once", () => {
  expect(ids(prependOlder([mark("k"), msg("m3")], [msg("m1"), msg("m2"), mark("k")]))).toEqual(["m1", "m2", "#k", "m3"]);
});

test("tools keep whether they read or wrote, and the card's place wins over its tab", () => {
  const start: AgentMessage = { id: "a", threadId: "t", role: "assistant", text: "", attachments: [], products: [], tools: [], status: "streaming", error: null, createdAt: 0 };
  const result = { title: "Perfil actualizado", detail: null, tab: "cuerpo" as const, place: "perfil" as const, undo: "available" as const };
  const end = [
    { type: "tool", name: "get_profile", status: "running", access: "read" },
    { type: "tool", name: "get_profile", status: "done", access: "read" },
    { type: "tool", name: "update_profile", status: "running", access: "write" },
    { type: "tool", name: "update_profile", status: "done", access: "write", result },
  ].reduce((m, e) => applyEvent(m, e as AgentStreamEvent), start);
  expect(end.tools).toEqual([
    { name: "get_profile", status: "done", access: "read" },
    { name: "update_profile", status: "done", access: "write", result },
  ]);
  expect(end.tools.map(isAction)).toEqual([false, true]);
  // Older messages have no access: a card still means it changed something.
  expect(isAction({ name: "log_meal", status: "done", result })).toBe(true);
  expect(placeOf(result).href).toBe("/cuerpo#perfil");
});
