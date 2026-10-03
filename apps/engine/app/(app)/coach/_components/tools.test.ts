import { expect, test } from "bun:test";
import type { AgentActionLine, AgentToolResult } from "@pulso/contract";
import { groupActions } from "./tools";

const line = (value: string, label: string | null = null): AgentActionLine => ({ label, before: null, value });
const card = (title: string, lines: AgentActionLine[], extra: Partial<AgentToolResult> = {}): AgentToolResult => ({
  title,
  detail: lines.map((l) => l.value).join(" · "),
  tab: "entreno",
  lines,
  ...extra,
});

/** The one card a run folds into. */
function folded(actions: { result: AgentToolResult; index: number }[]) {
  const views = groupActions(actions);
  expect(views).toHaveLength(1);
  return views[0]!;
}

test("cards without a group stand alone, untouched", () => {
  const meal = card("Comida registrada", [line("Avena")], { tab: "dieta", undo: "available" });
  const sleep = card("Noche registrada", [line("23:10 – 7:05")], { tab: "hoy" });
  const views = groupActions([
    { result: meal, index: 1 },
    { result: sleep, index: 3 },
  ]);
  expect(views).toEqual([
    { result: meal, indices: [1], undoOrder: [1] },
    { result: sleep, indices: [3], undoOrder: [] },
  ]);
  expect(views[0]?.result).toBe(meal);
});

test("a run of one group folds into one card: first title, lines de-duplicated, every index", () => {
  const program = "program:p1";
  const view = folded([
    { result: card("Programa actualizado", [line("Torso/Pierna")], { group: program, undo: "available" }), index: 0 },
    { result: card("Programa actualizado", [line("Torso/Pierna"), line("Día 2")], { group: program, undo: "available" }), index: 2 },
    { result: card("Programa actualizado", [line("Torso/Pierna")], { group: program, undo: "done" }), index: 3 },
  ]);
  expect(view.result.title).toBe("Programa actualizado");
  expect(view.result.group).toBe(program);
  expect(view.result.lines).toEqual([line("Torso/Pierna"), line("Día 2")]);
  expect(view.result.detail).toBe("Torso/Pierna · Día 2");
  expect(view.result.undo).toBe("available");
  expect(view.indices).toEqual([0, 2, 3]);
  expect(view.undoOrder).toEqual([2, 0]);
});

test("only consecutive cards of the same group fold", () => {
  const a = (index: number, group?: string) => ({ result: card("Programa actualizado", [line(`Día ${index}`)], { group }), index });
  const views = groupActions([a(0, "program:p1"), a(1, "program:p1"), a(2), a(3, "program:p1"), a(4, "program:p2"), a(5, ""), a(6, "")]);
  expect(views.map((v) => v.indices)).toEqual([[0, 1], [2], [3], [4], [5], [6]]);
});

test("merged lines are capped at five like the engine's", () => {
  const view = folded(Array.from({ length: 7 }, (_, i) => ({ result: card("Programa actualizado", [line(`Día ${i + 1}`, "Cambio")], { group: "program:p1" }), index: i })));
  const lines = view.result.lines ?? [];
  expect(lines).toHaveLength(5);
  expect(lines.slice(0, 4).map((l) => l.value)).toEqual(["Día 1", "Día 2", "Día 3", "Día 4"]);
  expect(lines[4]).toEqual({ label: null, before: null, value: "y 3 cambios más" });
});

test("a merged card's undo: done when every undoable member is, absent when none can", () => {
  const two = (first?: AgentToolResult["undo"], second?: AgentToolResult["undo"]) =>
    folded([
      { result: card("Programa actualizado", [line("A")], { group: "g", undo: first }), index: 0 },
      { result: card("Programa actualizado", [line("B")], { group: "g", undo: second }), index: 1 },
    ]);
  expect(two("done", "done").result.undo).toBe("done");
  expect(two("done", undefined).result.undo).toBe("done");
  expect(two("done", "done").undoOrder).toEqual([]);
  expect(two(undefined, undefined).result.undo).toBeUndefined();
  expect("undo" in two(undefined, undefined).result).toBe(false);
  expect(two("available", "available").undoOrder).toEqual([1, 0]);
});

test("old cards with only a detail merge by it", () => {
  const view = folded([
    { result: { title: "Programa actualizado", detail: "Torso/Pierna", tab: "entreno", group: "g" }, index: 0 },
    { result: { title: "Programa actualizado", detail: "Torso/Pierna", tab: "entreno", group: "g" }, index: 1 },
  ]);
  expect(view.result.lines).toEqual([line("Torso/Pierna")]);
});
