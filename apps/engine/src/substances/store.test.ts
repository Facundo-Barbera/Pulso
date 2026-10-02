import { beforeEach, expect, test } from "bun:test";
import { db } from "../db";
import { migrateSubstances } from "./schema";
import {
  createSubstance,
  deleteUse,
  findSubstance,
  firstUseDate,
  lastUse,
  listSubstances,
  listUses,
  logUse,
  MAC,
  reorderSubstances,
  resolveSubstance,
  setVisibleOn,
  SubstanceError,
  updateSubstance,
  updateUse,
  visibleOn,
} from "./store";

beforeEach(() => {
  db().exec("DELETE FROM substance_entries; DELETE FROM substances; DELETE FROM substance_settings; DELETE FROM substance_visibility;");
  migrateSubstances(db());
});

test("Cannabis and Alcohol come built in, nothing else", () => {
  expect(listSubstances().map((s) => [s.id, s.name, s.unit, s.forms, s.builtin, s.archived])).toEqual([
    ["cannabis", "Cannabis", "sesiones", ["fumado", "vapeado", "comestible", "otro"], true, false],
    ["alcohol", "Alcohol", "tragos", [], true, false],
  ]);
});

test("a bare log is the first active substance, its first form, normal, now", () => {
  const entry = logUse({}, new Date(2026, 9, 1, 22, 15));
  expect(entry).toMatchObject({ substanceId: "cannabis", form: "fumado", amount: "normal", date: "2026-10-01", time: "22:15", quantity: null, context: null, note: null });
});

test("forms must be the substance's own; THC only describes cannabis edibles", () => {
  const beer = logUse({ substanceId: "alcohol", form: null, thcMg: 10, amount: "poco", date: "2026-09-30", time: "20:00", note: "  dos cervezas ", quantity: 2 });
  expect(beer).toMatchObject({ substanceId: "alcohol", form: null, thcMg: null, quantity: 2, note: "dos cervezas" });
  const edible = logUse({ form: "Comestible", thcMg: 5, context: "dormir", date: "2026-09-30", time: "23:00" });
  expect(edible).toMatchObject({ form: "comestible", thcMg: 5, context: "dormir" });
  expect(() => logUse({ form: "inyectado" })).toThrow(SubstanceError);
  expect(() => logUse({ substanceId: "nope" })).toThrow(SubstanceError);
  // Moving to alcohol drops the cannabis-only fields.
  expect(updateUse(edible.id, { substanceId: "alcohol" })).toMatchObject({ substanceId: "alcohol", form: null, thcMg: null, context: "dormir" });
});

test("invalid input is refused", () => {
  expect(() => logUse({ time: "25:00" })).toThrow();
  expect(() => logUse({ amount: "muchisimo" })).toThrow();
  expect(() => updateUse("nope", {})).toThrow(SubstanceError);
  expect(() => deleteUse("nope")).toThrow(SubstanceError);
});

test("update patches only given fields, keeping a form the substance no longer lists; delete removes", () => {
  const entry = logUse({ date: "2026-09-29", time: "21:00", quantity: 2, form: "otro" });
  updateSubstance("cannabis", { forms: ["fumado", "vapeado"] });
  expect(updateUse(entry.id, { amount: "mucho", note: "cumpleaños" })).toMatchObject({ amount: "mucho", note: "cumpleaños", quantity: 2, time: "21:00", form: "otro" });
  deleteUse(entry.id);
  expect(listUses("2026-09-01", "2026-10-31")).toEqual([]);
});

test("list is newest first and filters by substance; first and last use", () => {
  logUse({ date: "2026-09-20", time: "21:00" });
  logUse({ date: "2026-09-25", time: "08:00" });
  logUse({ date: "2026-09-25", time: "23:30" });
  logUse({ substanceId: "alcohol", date: "2026-09-26", time: "22:00" });
  expect(listUses("2026-09-01", "2026-09-30", ["cannabis"]).map((e) => `${e.date} ${e.time}`)).toEqual(["2026-09-25 23:30", "2026-09-25 08:00", "2026-09-20 21:00"]);
  expect(listUses("2026-09-01", "2026-09-30")).toHaveLength(4);
  expect(firstUseDate(["cannabis"])).toBe("2026-09-20");
  expect(lastUse(["cannabis"])).toEqual({ date: "2026-09-25", time: "23:30" });
  expect(lastUse(["cannabis", "alcohol"])).toEqual({ date: "2026-09-26", time: "22:00" });
  expect(lastUse([])).toBeNull();
});

test("custom substances: create, find by name, edit, goal, archive and back, reorder", () => {
  const tabaco = createSubstance({ name: "Tabaco", symbol: "🚬", unit: "cigarros", forms: ["fumado", "fumado", "vapeado"] });
  expect(tabaco).toMatchObject({ name: "Tabaco", symbol: "🚬", unit: "cigarros", forms: ["fumado", "vapeado"], builtin: false, archived: false, position: 2, maxDaysPerWeek: null });
  expect(createSubstance({ name: "Café" }).unit).toBe("veces");
  expect(() => createSubstance({ name: "tabaco" })).toThrow("Ya existe");
  expect(findSubstance("CANNABIS")?.id).toBe("cannabis");
  expect(resolveSubstance("cafe").name).toBe("Café");
  expect(() => resolveSubstance("kratom")).toThrow("Las que hay: Cannabis, Alcohol, Tabaco, Café");

  expect(updateSubstance(tabaco.id, { maxDaysPerWeek: 3, symbol: null })).toMatchObject({ maxDaysPerWeek: 3, symbol: null });
  expect(() => updateSubstance(tabaco.id, { name: "Alcohol" })).toThrow("Ya existe");
  expect(() => updateSubstance(tabaco.id, { maxDaysPerWeek: 8 })).toThrow();

  logUse({ substanceId: tabaco.id, date: "2026-09-30", time: "09:00" });
  updateSubstance(tabaco.id, { archived: true });
  expect(listSubstances({ includeArchived: false }).map((s) => s.name)).toEqual(["Cannabis", "Alcohol", "Café"]);
  expect(listSubstances().at(-1)).toMatchObject({ name: "Tabaco", archived: true });
  expect(listUses("2026-09-01", "2026-10-31", [tabaco.id])).toHaveLength(1);

  const cafe = findSubstance("Café")!;
  expect(reorderSubstances([cafe.id, "alcohol", "cannabis"]).map((s) => s.name)).toEqual(["Café", "Alcohol", "Cannabis", "Tabaco"]);
  expect(() => reorderSubstances(["cannabis"])).toThrow(SubstanceError);
  // Unarchiving puts it back at the end.
  updateSubstance(tabaco.id, { archived: false });
  expect(listSubstances().map((s) => s.name)).toEqual(["Café", "Alcohol", "Cannabis", "Tabaco"]);
  // With every substance archived there is nothing to log a bare use to.
  for (const s of listSubstances()) updateSubstance(s.id, { archived: true });
  expect(() => logUse({})).toThrow("ninguna sustancia activa");
});

test("on the web it shows on the Mac by default and on no other browser until turned on there", () => {
  expect(visibleOn(MAC)).toBe(true);
  expect(visibleOn("some-browser")).toBe(false);
  expect(setVisibleOn("some-browser", true)).toBe(true);
  expect(visibleOn("other-browser")).toBe(false);
  expect(setVisibleOn(MAC, false)).toBe(false);
});
