import { expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { newTurnState, translate } from "./events";
import { summarizeResult } from "./results";

const m = (message: object) => ({ session_id: "s", parent_tool_use_id: null, ...message }) as unknown as SDKMessage;
const toolUse = (id: string, name: string) => m({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name, input: {} } } });
const toolResult = (id: string, content: unknown, is_error = false) => m({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error }] } });
const blocks = (value: unknown) => [{ type: "text", text: JSON.stringify(value) }];

const PROGRAM = { id: "p1", name: "Torso/Pierna", goal: "fuerza", weeks: 8, notes: null, active: true, createdAt: 0, days: [{}, {}, {}, {}] };

test("a tool that created something streams a result card and keeps it on the tool", () => {
  const state = newTurnState();
  translate(toolUse("t1", "mcp__pulso__create_program"), state);
  const events = translate(toolResult("t1", blocks(PROGRAM)), state);
  const result = { title: "Programa creado", detail: "Torso/Pierna · 4 días", tab: "entreno" } as const;
  expect(events).toEqual([{ type: "tool", name: "create_program", status: "done", result }]);
  expect(state.tools).toEqual([{ name: "create_program", status: "done", result }]);
});

test("reads and failed writes stream the old tool event, without a result", () => {
  const state = newTurnState();
  translate(toolUse("t1", "mcp__pulso__get_active_program"), state);
  translate(toolUse("t2", "mcp__pulso__create_program"), state);
  expect(translate(toolResult("t1", blocks(PROGRAM)), state)).toEqual([{ type: "tool", name: "get_active_program", status: "done" }]);
  expect(translate(toolResult("t2", "Unknown exercise ids: x", true), state)).toEqual([{ type: "tool", name: "create_program", status: "error" }]);
  expect(state.tools.every((t) => !("result" in t))).toBe(true);
});

test("summaries for the other creating tools, in Spanish", () => {
  expect(summarizeResult("create_diet_plan", blocks({ name: "Definición", days: [{}] }))).toEqual({ title: "Plan de comidas creado", detail: "Definición · 1 día", tab: "dieta" });
  expect(summarizeResult("set_targets", JSON.stringify({ kcal: 2350.4, protein: 160, carbs: 250, fat: 70, fiber: 30 }))).toEqual({
    title: "Objetivos de comida actualizados",
    detail: "2350 kcal · 160 g proteína",
    tab: "dieta",
  });
  expect(summarizeResult("log_meal", blocks([{ name: "Avena", kcal: 230 }, { name: "Leche", kcal: 120 }]))?.detail).toBe("2 alimentos · 350 kcal");
  expect(summarizeResult("log_meal", blocks([{ name: "Big Mac", kcal: 590, offPlan: true, note: "Big Mac y papas", eatenAt: new Date(2030, 0, 1, 14, 5).getTime() }]))).toEqual({
    title: "Comida registrada",
    detail: "Big Mac y papas · 590 kcal · 14:05",
    tab: "dieta",
  });
  expect(summarizeResult("adjust_day_plan", blocks({ stored: true, summary: "Cena al 60 %. Cierras el día en 2000 de 2000 kcal y 150 de 150 g de proteína." }))).toEqual({
    title: "Plan de hoy ajustado",
    detail: "Cena al 60 %. Cierras el día en 2000 de 2000 kcal y 150 de 150 g de proteína.",
    tab: "dieta",
  });
  expect(summarizeResult("log_water", blocks({ entry: { amountMl: 500 }, totalMl: 1750, goalMl: 2500 }))?.detail).toBe("+500 ml · 1,75 de 2,5 L hoy");
  expect(summarizeResult("add_medication", blocks({ name: "Creatina", kind: "suplemento", dose: 5, unit: "g" }))).toEqual({ title: "Suplemento añadido", detail: "Creatina · 5 g", tab: "hoy" });
  expect(summarizeResult("set_body_goal", blocks({ goal: { metric: "percentBodyFat", target: 15, setAt: 0 } }))).toEqual({ title: "Meta guardada", detail: "Grasa: 15 %", tab: "cuerpo" });
  expect(summarizeResult("set_body_goal", blocks({ cleared: "weight" }))).toEqual({ title: "Meta borrada", detail: "Peso", tab: "cuerpo" });
  expect(summarizeResult("log_session", blocks({ session: { name: "Pierna" }, prs: [{}, {}] }))?.detail).toBe("Pierna · 2 récords");
});

test("no card for tools that only read, or for results it cannot parse", () => {
  expect(summarizeResult("list_workouts", blocks([]))).toBeNull();
  expect(summarizeResult("create_program", "not json")).toBeNull();
  expect(summarizeResult("create_program", blocks({}))).toBeNull();
  expect(summarizeResult("create_program", undefined)).toBeNull();
});
