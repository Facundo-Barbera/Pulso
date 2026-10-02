import { expect, test } from "bun:test";
import { briefPrompt } from "../coach/prompts";
import { LIVE_PERSONA } from "../training/live-coach";
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
  expect(PERSONA).toContain("do NOT repeat it as text");
  expect(PERSONA).toContain("Ya está en Entreno");
});

test("the persona answers briefly by default and lets the action card speak", () => {
  expect(PERSONA).toContain("## Brevity");
  expect(PERSONA).toContain("Lead with the answer in 1–3 sentences");
  expect(PERSONA).toContain("under about 80 words");
  expect(PERSONA).toContain("unless they ask for more or it is a plan or an explanation they asked for");
  expect(PERSONA).toContain("Bullets only when listing");
  expect(PERSONA).toContain("¿Te explico por qué?");
  expect(PERSONA).toContain("Never restate what the card shows");
  expect(PERSONA).toContain('"Listo." plus the card is enough');
  // Brevity is the general style: it comes before the feature sections.
  expect(PERSONA.indexOf("## Brevity")).toBeLessThan(PERSONA.indexOf("## How you coach"));
});

test("the in-workout Coach and the briefs stay short too", () => {
  expect(LIVE_PERSONA).toContain("ONE or TWO short lines");
  expect(briefPrompt("daily", "2026-10-02")).toContain("3 to 5 lines");
  expect(briefPrompt("weekly", "2026-10-04")).toContain("5 to 7 lines");
});

test("the persona logs reported meals at their time, looks values up and adapts the day", () => {
  expect(PERSONA).toContain("at the time they said");
  expect(PERSONA).toContain("search the web for its nutritional values BEFORE logging, without asking");
  expect(PERSONA).toContain("USDA FoodData Central, then Open Food Facts");
  expect(PERSONA).toContain("Cite where the numbers came from in one short line");
  expect(PERSONA).toContain("log_meal ties every meal to the plan by itself");
  expect(PERSONA).toContain("Never leave a main meal as a loose extra");
  expect(PERSONA).toContain("ate_out");
  expect(PERSONA).not.toContain("offPlan");
  expect(PERSONA).toContain("Compensate by magnitude");
  expect(PERSONA).toContain("never extreme days");
  expect(PERSONA).toContain("never regenerate it because of one meal");
  expect(PERSONA).toContain("log_water in the unit they used");
});
