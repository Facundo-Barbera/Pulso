import { expect, test } from "bun:test";
import type { AgentMessage, AgentStreamEvent } from "@pulso/contract";
import { applyEvent, readEvents } from "./stream";
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
