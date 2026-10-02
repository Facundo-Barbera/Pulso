import { beforeEach, expect, test } from "bun:test";
import { db } from "../db";
import { deleteUse, firstUseDate, getSettings, lastUse, listUses, logUse, MAC, setVisibleOn, SubstanceError, updateSettings, updateUse, visibleOn } from "./store";

beforeEach(() => {
  db().exec("DELETE FROM substance_entries; DELETE FROM substance_settings; DELETE FROM substance_visibility;");
});

test("a bare log is cannabis, smoked, normal, now", () => {
  const entry = logUse({}, new Date(2026, 9, 1, 22, 15));
  expect(entry).toMatchObject({ substance: "cannabis", form: "fumado", amount: "normal", date: "2026-10-01", time: "22:15", count: null, context: null, note: null });
});

test("form and THC only describe cannabis", () => {
  const beer = logUse({ substance: "alcohol", form: "comestible", thcMg: 10, amount: "poco", date: "2026-09-30", time: "20:00", note: "  dos cervezas " });
  expect(beer).toMatchObject({ substance: "alcohol", form: null, thcMg: null, note: "dos cervezas" });
  const edible = logUse({ form: "comestible", thcMg: 5, context: "dormir", date: "2026-09-30", time: "23:00" });
  expect(edible).toMatchObject({ form: "comestible", thcMg: 5, context: "dormir" });
  // Switching to nicotine drops the cannabis-only fields.
  expect(updateUse(edible.id, { substance: "nicotina" })).toMatchObject({ form: null, thcMg: null, context: "dormir" });
});

test("invalid input is refused", () => {
  expect(() => logUse({ substance: "cafe" })).toThrow();
  expect(() => logUse({ time: "25:00" })).toThrow();
  expect(() => logUse({ amount: "muchisimo" })).toThrow();
  expect(() => updateUse("nope", {})).toThrow(SubstanceError);
  expect(() => deleteUse("nope")).toThrow(SubstanceError);
});

test("update patches only given fields; delete removes", () => {
  const entry = logUse({ date: "2026-09-29", time: "21:00", count: 2 });
  const updated = updateUse(entry.id, { amount: "mucho", note: "cumpleaños" });
  expect(updated).toMatchObject({ amount: "mucho", note: "cumpleaños", count: 2, time: "21:00" });
  deleteUse(entry.id);
  expect(listUses("2026-09-01", "2026-10-31")).toEqual([]);
});

test("list is newest first and filters by substance; first and last use", () => {
  logUse({ date: "2026-09-20", time: "21:00" });
  logUse({ date: "2026-09-25", time: "08:00" });
  logUse({ date: "2026-09-25", time: "23:30" });
  logUse({ substance: "alcohol", date: "2026-09-26", time: "22:00" });
  expect(listUses("2026-09-01", "2026-09-30", "cannabis").map((e) => `${e.date} ${e.time}`)).toEqual(["2026-09-25 23:30", "2026-09-25 08:00", "2026-09-20 21:00"]);
  expect(listUses("2026-09-01", "2026-09-30")).toHaveLength(4);
  expect(firstUseDate("cannabis")).toBe("2026-09-20");
  expect(lastUse("cannabis")).toEqual({ date: "2026-09-25", time: "23:30" });
  expect(lastUse("nicotina")).toBeNull();
});

test("the weekly goal is the person's own and can be cleared", () => {
  expect(getSettings()).toEqual({ maxDaysPerWeek: null });
  expect(updateSettings({ maxDaysPerWeek: 2 })).toEqual({ maxDaysPerWeek: 2 });
  expect(updateSettings({ maxDaysPerWeek: null })).toEqual({ maxDaysPerWeek: null });
  expect(() => updateSettings({ maxDaysPerWeek: 8 })).toThrow();
});

test("on the web it shows on the Mac by default and on no other browser until turned on there", () => {
  expect(visibleOn(MAC)).toBe(true);
  expect(visibleOn("some-browser")).toBe(false);
  expect(setVisibleOn("some-browser", true)).toBe(true);
  expect(visibleOn("other-browser")).toBe(false);
  expect(setVisibleOn(MAC, false)).toBe(false);
});
