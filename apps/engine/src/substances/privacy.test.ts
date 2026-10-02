import { expect, test } from "bun:test";
import { TOOLS } from "../agent/registry";
import { briefOptions } from "../coach/generate";
import { briefPrompt } from "../coach/prompts";
import { describeFor, isSensitive, toolInfos, visibleTools } from "../mcp/access";
import { substanceTools } from "./tools";

const NAMES = substanceTools.map((t) => t.name);

test("every Sustancias tool is registered, sensitive and marked personal; nothing else is sensitive", () => {
  expect(NAMES.every((name) => TOOLS.some((t) => t.name === name))).toBe(true);
  expect(toolInfos().filter((t) => t.sensitive).map((t) => t.name).sort()).toEqual([...NAMES].sort());
  for (const t of substanceTools) expect(describeFor(t)).toContain("private health data");
});

test("external clients never see them without the grant, whatever their scope", () => {
  for (const scope of ["read", "read+write"] as const) {
    expect(visibleTools(scope).filter((t) => isSensitive(t.name))).toEqual([]);
  }
  expect(visibleTools("read+write", true).map((t) => t.name)).toEqual(expect.arrayContaining(NAMES));
});

test("the briefs can neither read nor write them", () => {
  const options = briefOptions("/tmp", "", new AbortController());
  for (const name of NAMES) expect(options.disallowedTools).toContain(`mcp__pulso__${name}`);
  for (const kind of ["daily", "weekly"] as const) expect(briefPrompt(kind, "2026-09-27")).not.toMatch(/substance|sustancia|consumo|cannabis/i);
});
