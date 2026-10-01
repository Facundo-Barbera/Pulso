import { describe, expect, test } from "bun:test";
import type { Scope } from "@pulso/contract";
import { fromTailnet, gate, needOf } from "./tailnet-gate";

const phone = { scopes: ["mobile"] as Scope[] };
const browser = { scopes: ["view", "edit"] as Scope[] };
const viewer = { scopes: ["view"] as Scope[] };
const allows = (method: string, pathname: string, device?: { scopes: Scope[] }) => gate({ method, pathname, device }).allow;
const status = (method: string, pathname: string, device?: { scopes: Scope[] }) => {
  const verdict = gate({ method, pathname, device });
  return verdict.allow ? 200 : verdict.status;
};

describe("public and phone routes", () => {
  test("pairing answers anyone", () => {
    expect(allows("POST", "/api/mobile/pair")).toBe(true);
    expect(allows("GET", "/pair")).toBe(true);
    expect(allows("POST", "/pair")).toBe(true);
    expect(allows("DELETE", "/pair")).toBe(false);
  });

  test("/api/mobile/* passes to its own bearer check, unchanged", () => {
    expect(allows("GET", "/api/mobile/workouts/")).toBe(true);
    expect(allows("POST", "/api/mobile/daily")).toBe(true);
    expect(needOf("GET", "/api/mobilex")).toBe("admin");
  });

  test("the MCP endpoint checks its own client secret; its admin stays Mac-only", () => {
    expect(allows("POST", "/api/mcp")).toBe(true);
    expect(allows("GET", "/api/mcp/")).toBe(true);
    expect(needOf("GET", "/api/mcp-admin/clients")).toBe("admin");
  });
});

describe("the web app", () => {
  test("pages and chunks need a paired browser: none is a 401", () => {
    expect(status("GET", "/")).toBe(401);
    expect(status("GET", "/_next/static/chunks/main.js")).toBe(401);
    expect(status("GET", "/ajustes")).toBe(401);
    expect(allows("GET", "/", browser)).toBe(true);
    expect(allows("GET", "/icon.svg", browser)).toBe(true);
  });

  test("/api/web reads need view, writes need edit", () => {
    expect(allows("GET", "/api/web/hoy", viewer)).toBe(true);
    expect(status("POST", "/api/web/anything", viewer)).toBe(403);
    expect(allows("POST", "/api/web/anything", browser)).toBe(true);
    // A browser may always forget itself.
    expect(allows("DELETE", "/api/web/me", viewer)).toBe(true);
  });

  test("a phone's token does not open the web app", () => {
    expect(status("GET", "/", phone)).toBe(403);
    expect(status("GET", "/api/web/hoy", phone)).toBe(403);
  });
});

describe("admin", () => {
  test("is the Mac's alone, whatever the device", () => {
    for (const device of [undefined, phone, browser]) {
      expect(status("POST", "/api/web/admin/pair-code", device)).toBe(403);
      expect(status("GET", "/api/web/admin/devices", device)).toBe(403);
      expect(status("DELETE", "/api/web/admin/devices/x", device)).toBe(403);
      expect(status("GET", "/api/health", device)).toBe(403);
      expect(status("GET", "/api/anything-else", device)).toBe(403);
    }
  });
});

test("only the proxy's stamp marks a request as tailnet", () => {
  expect(fromTailnet(new Headers({ "x-pulso-via": "tailnet" }))).toBe(true);
  expect(fromTailnet(new Headers())).toBe(false);
});
