import { expect, test } from "bun:test";
import { CARDIO, LIBRARY } from "./library";
import { similarExercises } from "./similar";
import { setTrainingSettings } from "./store";

const ids = (list: { id: string }[] | undefined) => (list ?? []).map((e) => e.id);

test("every alternative works the same target, and the exercise itself is never one", () => {
  for (const e of LIBRARY) {
    const alternatives = similarExercises(e.id, { limit: 100, preferred: [] })!;
    expect(ids(alternatives), e.id).not.toContain(e.id);
    for (const a of alternatives) expect(a.kind === "cardio", `${e.id} → ${a.id}`).toBe(e.kind === "cardio");
  }
});

test("same muscle and movement first; without a preference free weights compete on similarity", () => {
  const squat = similarExercises("sentadilla", { preferred: [] })!;
  expect(ids(squat.slice(0, 4)).sort()).toEqual(["prensa", "sentadilla-frontal", "sentadilla-goblet", "sentadilla-hack"]);
  expect(squat[0]!.reasons).toContain("Mismo músculo");
  expect(squat[0]!.reasons).toContain("Mismo movimiento");
  // Curls never come back for a squat, nor chest work for a curl.
  expect(ids(squat)).not.toContain("curl-barra");
  expect(similarExercises("curl-barra", { limit: 100, preferred: [] })!.every((e) => e.muscle !== "chest")).toBe(true);
});

test("preferred equipment ranks machines first among equally good matches", () => {
  const bench = similarExercises("press-banca", { preferred: ["machine", "cable"] })!;
  expect(bench[0]!.id).toBe("press-pecho-maquina");
  expect(bench[0]!.preferred).toBe(true);
  expect(bench[0]!.reasons).toContain("Máquina");

  const lateral = similarExercises("elevaciones-laterales", { preferred: ["machine", "cable"] })!;
  expect(ids(lateral.slice(0, 2))).toEqual(["elevaciones-laterales-maquina", "elevaciones-laterales-polea"]);

  // The stored setting is the default.
  setTrainingSettings({ preferredEquipment: ["machine"] });
  expect(similarExercises("sentadilla")![0]!.equipment).toBe("machine");
  setTrainingSettings({ preferredEquipment: [] });
});

test("an equipment filter keeps only that equipment", () => {
  const rows = similarExercises("remo-barra", { equipment: ["machine", "cable"], limit: 50, preferred: [] })!;
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((e) => e.equipment === "machine" || e.equipment === "cable")).toBe(true);
  expect(ids(rows)).toContain("remo-maquina");
  expect(similarExercises("remo-barra", { equipment: ["band"], preferred: [] })!.map((e) => e.id)).toContain("remo-banda");
});

test("cardio swaps for cardio of the same intensity and impact, machines first when preferred", () => {
  const run = similarExercises("correr", { preferred: [] })!;
  expect(run.every((e) => e.kind === "cardio")).toBe(true);
  // High intensity, high impact: rope and HIIT match best; a walk is last.
  expect(ids(run.slice(0, 2)).sort()).toEqual(["hiit", "saltar-cuerda"]);
  expect(run.at(-1)!.id).toBe("caminar");

  const machines = similarExercises("correr", { preferred: ["machine"] })!;
  expect(machines[0]!.equipment).toBe("machine");
  expect(similarExercises("eliptica", { preferred: [] })![0]!.reasons).toContain("Bajo impacto");
});

test("unknown ids return undefined and the limit is honoured", () => {
  expect(similarExercises("nope")).toBeUndefined();
  expect(similarExercises("press-banca", { limit: 3, preferred: [] })!.length).toBe(3);
});

test("every cardio exercise has its modality and every other one a movement pattern to compare", () => {
  for (const e of LIBRARY) {
    if (e.kind === "cardio") expect(CARDIO[e.id], e.id).toBeDefined();
  }
  expect(Object.keys(CARDIO).filter((id) => !LIBRARY.some((e) => e.id === id))).toEqual([]);
});
