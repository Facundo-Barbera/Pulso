import { expect, test } from "bun:test";
import { TOOLS } from "../agent/registry";
import { accessOf, classified, describeFor, toolInfos, visibleTools } from "./access";
import { isMcpPath } from "./paths";

test("every Coach tool is classified as read or write", () => {
  const missing = TOOLS.map((t) => t.name).filter((name) => !classified(name));
  // A new tool must be added to ACCESS in access.ts before other agents can see it.
  expect(missing).toEqual([]);
});

test("an unclassified tool counts as write", () => {
  expect(accessOf("brand_new_tool")).toBe("write");
});

test("read-only clients see no write tool; read+write see everything but the sensitive ones", () => {
  const readOnly = visibleTools("read").map((t) => t.name);
  expect(readOnly).toContain("get_profile");
  expect(readOnly).not.toContain("update_profile");
  expect(readOnly.every((name) => accessOf(name) === "read")).toBe(true);
  const sensitive = toolInfos().filter((t) => t.sensitive).length;
  expect(sensitive).toBeGreaterThan(0);
  expect(visibleTools("read+write")).toHaveLength(TOOLS.length - sensitive);
  expect(visibleTools("read+write", true)).toHaveLength(TOOLS.length);
  expect(toolInfos().filter((t) => t.access === "write" && !t.sensitive).length).toBe(TOOLS.length - sensitive - readOnly.length);
});

test("profile and medication tools warn that the data is personal", () => {
  const byName = new Map(TOOLS.map((t) => [t.name, t]));
  expect(describeFor(byName.get("get_profile")!)).toContain("private health data");
  expect(describeFor(byName.get("log_dose")!)).toContain("private health data");
  expect(describeFor(byName.get("list_workouts")!)).toBe(byName.get("list_workouts")!.description);
});

test("only the MCP endpoint itself is open to the tailnet, not its admin", () => {
  expect(isMcpPath("/api/mcp")).toBe(true);
  expect(isMcpPath("/api/mcp/")).toBe(true);
  expect(isMcpPath("/api/mcp-admin/clients")).toBe(false);
  expect(isMcpPath("/api/mcpx")).toBe(false);
  expect(isMcpPath("/api/mcp/anything")).toBe(false);
});
