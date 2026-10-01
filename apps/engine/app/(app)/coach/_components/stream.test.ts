import { expect, test } from "bun:test";
import type { AgentMessage, AgentStreamEvent } from "@pulso/contract";
import { applyEvent, readEvents } from "./stream";
import { toolLook } from "./tools";

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
  const start: AgentMessage = { id: "a", threadId: "t", role: "assistant", text: "", tools: [], status: "streaming", error: null, createdAt: 0 };
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
