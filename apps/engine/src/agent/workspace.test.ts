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
