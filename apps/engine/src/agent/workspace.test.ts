import { expect, test } from "bun:test";
import { PERSONA } from "./workspace";

test("the persona writes for a phone screen", () => {
  expect(PERSONA).toContain("iPhone");
  expect(PERSONA).toContain("Never use multi-column tables");
  expect(PERSONA).toContain("at most 3 short columns");
  expect(PERSONA).toContain("**Press banca** — 3×6–8 · 3 min");
  expect(PERSONA).toContain("**Bold** the key numbers");
  expect(PERSONA).toContain("Always reply in Spanish");
});

test("the persona summarizes what a tool created instead of repeating it", () => {
  expect(PERSONA).toContain("Do NOT repeat it as text");
  expect(PERSONA).toContain("2–4 line summary");
  expect(PERSONA).toContain("Ya está en Entreno");
});

test("the persona logs reported meals at their time, looks values up and adapts the day", () => {
  expect(PERSONA).toContain("at the time they said");
  expect(PERSONA).toContain("search the web for its nutritional values BEFORE logging, without asking");
  expect(PERSONA).toContain("USDA FoodData Central, then Open Food Facts");
  expect(PERSONA).toContain("Cite where the numbers came from in one short line");
  expect(PERSONA).toContain("call adjust_day_plan right after logging");
  expect(PERSONA).toContain("Never compensate with extreme cuts");
  expect(PERSONA).toContain("log_water in the unit they used");
});
