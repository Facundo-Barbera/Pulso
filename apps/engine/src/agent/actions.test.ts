import { beforeEach, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { db } from "../db";
import { addMedication, dosesBetween, logDose } from "../medication/store";
import { listMeals, logMeals } from "../nutrition/store";
import { ownDatabase } from "../web/test-db";
import { summarizeAction } from "./actions";
import { newTurnState, rememberBefore, translate } from "./events";
import { getProfile, updateProfile } from "./profile";
import { addMessage, createThread, listMessages, updateMessage } from "./threads";
import { undoToolAction, UndoError } from "./undo";

ownDatabase("actions");

beforeEach(() => {
  db().exec("DELETE FROM agent_threads; DELETE FROM agent_profile; DELETE FROM meal_entries; DELETE FROM medication_doses; DELETE FROM medications;");
});

const blocks = (value: unknown) => [{ type: "text", text: JSON.stringify(value) }];
const m = (message: object) => ({ session_id: "s", parent_tool_use_id: null, ...message }) as unknown as SDKMessage;
const card = (name: string, result: unknown, input: unknown = {}, before?: unknown) => summarizeAction(name, input, blocks(result), before)?.card;

/** Runs one tool call through the turn translation the way the runner does: snapshot, run, result. */
function runTool(name: string, input: Record<string, unknown>, run: () => unknown) {
  const state = newTurnState();
  rememberBefore("t1", `mcp__pulso__${name}`, input);
  translate(m({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: `mcp__pulso__${name}`, input }] } }), state);
  translate(m({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: blocks(run()), is_error: false }] } }), state);
  const thread = createThread();
  const message = addMessage(thread.id, "assistant", "Listo.", "done");
  updateMessage(message.id, { text: "Listo.", tools: state.tools, status: "done" });
  return { state, threadId: thread.id, messageId: message.id };
}

test("a profile update shows before → after and Deshacer puts the old values back", () => {
  updateProfile({ goals: "Bajar de peso" });
  const input = { goals: "Bajar 10 kg de grasa", injuries: "Hombro derecho" };
  const { state, threadId, messageId } = runTool("update_profile", input, () => updateProfile(input));
  expect(state.tools[0]!.result).toEqual({
    title: "Perfil actualizado",
    detail: "Objetivo: Bajar de peso → Bajar 10 kg de grasa · Lesiones: Hombro derecho",
    tab: "cuerpo",
    place: "perfil",
    lines: [
      { label: "Objetivo", before: "Bajar de peso", value: "Bajar 10 kg de grasa" },
      { label: "Lesiones", before: null, value: "Hombro derecho" },
    ],
    undo: "available",
  });

  // Clients never see how to undo.
  expect(JSON.stringify(listMessages(threadId))).not.toContain("revert");

  const undone = undoToolAction(threadId, messageId, 0);
  expect(undone.tools[0]!.result!.undo).toBe("done");
  expect(getProfile()).toEqual({ goals: "Bajar de peso" });
  // Twice is a no-op, not a second revert.
  updateProfile({ goals: "Otra cosa" });
  undoToolAction(threadId, messageId, 0);
  expect(getProfile().goals).toBe("Otra cosa");
});

test("a logged meal says what, how much and when, and Deshacer deletes it", () => {
  const eatenAt = new Date(2030, 0, 1, 17, 30).getTime();
  const { state, threadId, messageId } = runTool("log_meal", {}, () =>
    logMeals([{ name: "Batido de proteína", quantity: 1, unit: "serving", slot: "merienda", eatenAt, kcal: 347, protein: 32, carbs: 30, fat: 9, fiber: 2 }], "agent"),
  );
  expect(state.tools[0]!.result!.lines!.map((l) => l.value)).toEqual(["Batido de proteína", "347 kcal · 32 g proteína", "Merienda · 17:30"]);
  expect(state.tools[0]!.result!.undo).toBe("available");
  undoToolAction(threadId, messageId, 0);
  expect(listMeals("2030-01-01")).toEqual([]);
});

test("a dose names the medication and its moment; Deshacer only when it didn't overwrite one", () => {
  const med = addMedication({
    name: "Creatina",
    kind: "suplemento",
    dose: 5,
    unit: "g",
    schedule: { asNeeded: false, times: [], days: [], training: { withinMinutes: 120, restDayTime: null } },
    startDate: "2026-01-01",
  });
  const input = { medicationId: med.id, date: "2026-10-02", scheduledTime: "entreno", status: "tomada" as const };
  const first = runTool("log_dose", input, () => logDose({ ...input, takenAt: new Date(2026, 9, 2, 19, 5).getTime() }));
  expect(first.state.tools[0]!.result).toMatchObject({ title: "Toma registrada", place: "medicacion", undo: "available" });
  expect(first.state.tools[0]!.result!.lines!.map((l) => l.value)).toEqual(["Creatina · 5 g", "Después de entrenar · tomada a las 19:05"]);

  const again = runTool("log_dose", { ...input, status: "omitida" }, () => logDose({ ...input, status: "omitida" }));
  expect(again.state.tools[0]!.result!.undo).toBeUndefined();

  undoToolAction(first.threadId, first.messageId, 0);
  expect(dosesBetween("2026-10-02", "2026-10-02", med.id)).toEqual([]);
});

test("a plan change reads as before → after and undoes its revision", () => {
  const change = { summary: "Cena del martes: tortitas en vez de quesadillas (−120 kcal). Repartí 120 kcal en 2 días.", revision: { id: "r1" }, slots: [] };
  const action = summarizeAction("replace_slot", {}, blocks(change));
  expect(action?.card.lines).toEqual([
    { label: "Cena del martes", before: "Quesadillas", value: "Tortitas (−120 kcal)" },
    { label: null, before: null, value: "Repartí 120 kcal en 2 días" },
  ]);
  expect(action?.revert).toEqual({ kind: "plan", revisionId: "r1" });
  // An ingredient preview changes nothing: no card.
  expect(summarizeAction("ingredient_unavailable", {}, blocks({ preview: true, ingredient: "salmón", summary: "…", affected: [] }))).toBeNull();
});

test("cards for the other write tools, in Spanish", () => {
  expect(card("create_diet_plan", { name: "Definición", days: [{}] })).toMatchObject({ title: "Plan de comidas creado", detail: "Definición · 1 día", tab: "dieta" });
  expect(card("set_targets", { kcal: 2000, protein: 160, carbs: 250, fat: 70 }, {}, { kcal: 2200, protein: 160, carbs: 250, fat: 70 })?.lines).toEqual([
    { label: "Calorías", before: "2200 kcal", value: "2000 kcal" },
  ]);
  expect(card("log_water", { entry: { id: "w1", amountMl: 500 }, totalMl: 1750, goalMl: 2500 })).toMatchObject({ detail: "+500 ml · 1,75 de 2,5 L hoy", undo: "available" });
  expect(
    card("add_medication", {
      id: "m1",
      name: "Creatina",
      kind: "suplemento",
      dose: 5,
      unit: "g",
      instructions: null,
      schedule: { asNeeded: false, times: [], days: [], training: { withinMinutes: 120, restDayTime: null }, meals: [], bedtime: false },
    }),
  ).toMatchObject({ title: "Suplemento añadido", detail: "Creatina · 5 g · Después de entrenar", place: "medicacion" });
  expect(card("set_body_goal", { goal: { metric: "percentBodyFat", target: 15, setAt: 0 } })).toMatchObject({ title: "Meta guardada", detail: "Grasa: 15 %", tab: "cuerpo" });
  expect(card("log_session", { session: { name: "Pierna" }, prs: [{}, {}] })?.detail).toBe("Pierna · 2 récords");
});

test("write tools without a formatter get a plain card; reads get none", () => {
  expect(card("add_busy_block", { summary: "Ocupado el martes de 10:00 a 12:00" })).toEqual({
    title: "Añadido al calendario",
    detail: "Ocupado el martes de 10:00 a 12:00",
    tab: "hoy",
    lines: [{ label: null, before: null, value: "Ocupado el martes de 10:00 a 12:00" }],
  });
  expect(card("plan_training_week", "ok")).toMatchObject({ title: "Semana de entreno planificada", tab: "entreno", detail: null });
  expect(card("list_meals", [])).toBeUndefined();
  expect(card("WebSearch", "results")).toBeUndefined();
});

test("a long change shows at most five lines", () => {
  const input = { age: 34, sex: "male", heightCm: 178, goals: "Fuerza", equipment: "Gimnasio", schedule: "L-M-V", notes: "Madruga" };
  const lines = card("update_profile", { ...input }, input, {})!.lines!;
  expect(lines).toHaveLength(5);
  expect(lines.at(-1)!.value).toBe("y 3 cambios más");
});

test("Deshacer refuses what it can't undo", () => {
  const { threadId, messageId } = runTool("create_program", {}, () => ({ name: "Torso/Pierna", days: [{}] }));
  expect(() => undoToolAction(threadId, messageId, 0)).toThrow(UndoError);
  expect(() => undoToolAction(threadId, "nope", 0)).toThrow("No encontré ese cambio.");
});
