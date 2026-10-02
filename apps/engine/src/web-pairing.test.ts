/**
 * A browser on the tailnet, driven through `proxy.ts` and the real routes:
 * paired with a code minted on the Mac, carried as a cookie, refused when the
 * cookie names nobody, and its writes only from Pulso's own page.
 */
import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { DELETE as forgetSelf, GET as me } from "../app/api/web/me/route";
import { DELETE as revoke } from "../app/api/web/admin/devices/[id]/route";
import { GET as adminDevices } from "../app/api/web/admin/devices/route";
import { POST as mintCode } from "../app/api/web/admin/pair-code/route";
import { deviceOf } from "../app/api/mobile/auth";
import { POST as pair, GET as pairForm } from "../app/pair/route";
import proxy from "../proxy";
import { cookieToken, COOKIE, safeNext, sameOrigin } from "./device-auth";
import { createPairingCode, listDevices, PairingError, redeemPairing } from "./devices";

const HOST = "100.64.0.7:8090";
const ORIGIN = `http://${HOST}`;

function tailnet(pathname: string, init: { method?: string; cookie?: string; bearer?: string; origin?: string } = {}): NextRequest {
  const headers = new Headers({ "x-pulso-via": "tailnet", "x-pulso-host": HOST, host: "127.0.0.1:3230" });
  if (init.cookie) headers.set("cookie", `${COOKIE}=${init.cookie}`);
  if (init.bearer) headers.set("authorization", `Bearer ${init.bearer}`);
  if (init.origin) headers.set("origin", init.origin);
  return new NextRequest(`http://127.0.0.1:3230${pathname}`, { method: init.method ?? "GET", headers });
}

const passes = (response: Response) => response.headers.get("x-middleware-next") === "1";
const rewrittenTo = (response: Response) => {
  const target = response.headers.get("x-middleware-rewrite");
  return target ? new URL(target, "http://x").pathname + new URL(target, "http://x").search : null;
};

/** Pairs a browser the way `/pair` does and returns its cookie's token. */
async function pairBrowser(name = "Portátil", next?: string): Promise<{ token: string; location: string | null }> {
  const { code } = createPairingCode(Date.now(), "browser");
  const form = new FormData();
  form.set("code", code);
  form.set("name", name);
  if (next) form.set("next", next);
  const response = await pair(new Request("http://127.0.0.1:3230/pair", { method: "POST", body: form }));
  expect(response.status).toBe(303);
  const cookie = response.headers.get("set-cookie") ?? "";
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Lax");
  return { token: cookieToken(cookie.split(";")[0])!, location: response.headers.get("location") };
}

describe("pairing a browser", () => {
  test("the form pairs, sets the cookie and lands on the page it came from", async () => {
    const { token, location } = await pairBrowser("Portátil", "/entreno");
    expect(location).toBe("/entreno");
    expect(listDevices().find((d) => d.name === "Portátil")).toMatchObject({ kind: "browser", scopes: ["view", "edit"] });
    expect(token.length).toBeGreaterThan(20);
  });

  test("a phone's code does not pair a browser, nor the other way round", () => {
    const forPhone = createPairingCode(Date.now(), "phone");
    expect(() => redeemPairing({ code: forPhone.code, name: "x", kind: "browser" })).toThrow(PairingError);
    const forBrowser = createPairingCode(Date.now(), "browser");
    expect(() => redeemPairing({ code: forBrowser.code, name: "x", kind: "phone" })).toThrow(PairingError);
  });

  test("five wrong guesses burn the live code", () => {
    const { code } = createPairingCode(Date.now(), "browser");
    const wrong = code === "00000000" ? "11111111" : "00000000";
    for (let i = 0; i < 5; i++) expect(() => redeemPairing({ code: wrong, name: "x", kind: "browser" })).toThrow(PairingError);
    expect(() => redeemPairing({ code, name: "x", kind: "browser" })).toThrow(PairingError);
  });

  test("a wrong code re-shows the form with the error", async () => {
    const form = new FormData();
    form.set("code", "12");
    const response = await pair(new Request("http://127.0.0.1:3230/pair", { method: "POST", body: form }));
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("8 dígitos");
    expect((await pairForm(new Request("http://127.0.0.1:3230/pair"))).headers.get("content-type")).toContain("text/html");
  });

  test("next never leaves the site", () => {
    expect(safeNext("/dieta?d=1")).toBe("/dieta?d=1");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil", "/pair", 42, null]) expect(safeNext(bad)).toBe("/");
  });
});

describe("the cookie at the door", () => {
  test("without one, a page shows the pair form and the API says 401", () => {
    expect(rewrittenTo(proxy(tailnet("/")))).toBe("/pair");
    expect(rewrittenTo(proxy(tailnet("/sueno")))).toBe("/pair?next=%2Fsueno");
    expect(proxy(tailnet("/api/web/hoy")).status).toBe(401);
    expect(proxy(tailnet("/_next/static/chunks/app.js")).status).toBe(401);
    expect(passes(proxy(tailnet("/pair")))).toBe(true);
  });

  test("with one, the app and /api/web open", async () => {
    const { token } = await pairBrowser();
    expect(passes(proxy(tailnet("/", { cookie: token })))).toBe(true);
    expect(passes(proxy(tailnet("/_next/static/chunks/app.js", { cookie: token })))).toBe(true);
    expect(passes(proxy(tailnet("/api/web/hoy", { cookie: token })))).toBe(true);
  });

  test("admin is a 403 from the tailnet even when paired, and the routes refuse it too", async () => {
    const { token } = await pairBrowser();
    expect(proxy(tailnet("/api/web/admin/devices", { cookie: token })).status).toBe(403);
    expect(proxy(tailnet("/api/web/admin/pair-code", { method: "POST", cookie: token, origin: ORIGIN })).status).toBe(403);
    expect((await mintCode(tailnet("/api/web/admin/pair-code", { method: "POST" }))).status).toBe(403);
    expect(adminDevices(tailnet("/api/web/admin/devices")).status).toBe(403);
  });

  test("a write with the cookie must carry Pulso's own Origin", async () => {
    const { token } = await pairBrowser();
    expect(proxy(tailnet("/api/web/thing", { method: "POST", cookie: token })).status).toBe(403);
    expect(proxy(tailnet("/api/web/thing", { method: "POST", cookie: token, origin: "http://evil.example" })).status).toBe(403);
    expect(passes(proxy(tailnet("/api/web/thing", { method: "POST", cookie: token, origin: ORIGIN })))).toBe(true);
    expect(sameOrigin("GET", new Headers())).toBe(true);
  });

  test("a write through tailscale serve's https address is the same origin", () => {
    const headers = (origin: string) => new Headers({ "x-pulso-host": "mini.tail.ts.net:8443", origin });
    expect(sameOrigin("POST", headers("https://mini.tail.ts.net:8443"))).toBe(true);
    expect(sameOrigin("POST", headers("https://evil.ts.net:8443"))).toBe(false);
  });

  test("a revoked browser is refused and its cookie cleared", async () => {
    const { token } = await pairBrowser("Revocado");
    const id = listDevices().find((d) => d.name === "Revocado")!.id;
    const local = new Request(`http://127.0.0.1:3230/api/web/admin/devices/${id}`, { method: "DELETE" });
    expect((await revoke(local, { params: Promise.resolve({ id }) })).status).toBe(200);
    const response = proxy(tailnet("/", { cookie: token }));
    expect(rewrittenTo(response)).toBe("/pair");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("a browser can forget itself", async () => {
    const { token } = await pairBrowser("Prestado");
    const asked = tailnet("/api/web/me", { cookie: token });
    expect(((await me(asked).json()) as { device: { name: string } }).device.name).toBe("Prestado");
    const response = forgetSelf(tailnet("/api/web/me", { method: "DELETE", cookie: token, origin: ORIGIN }));
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(listDevices().some((d) => d.name === "Prestado")).toBe(false);
  });
});

describe("loopback and phones", () => {
  test("loopback passes untouched: the Electron window keeps full trust", () => {
    const local = new NextRequest("http://127.0.0.1:3230/api/web/admin/devices");
    expect(passes(proxy(local))).toBe(true);
    expect(adminDevices(local).status).toBe(200);
  });

  test("a phone's bearer still works on /api/mobile, a browser's token does not", async () => {
    const phone = redeemPairing({ code: createPairingCode(Date.now(), "phone").code, name: "iPhone", kind: "phone" });
    expect(deviceOf(new Request("http://x/api/mobile/status", { headers: { authorization: `Bearer ${phone.token}` } }))?.kind).toBe("phone");
    const { token } = await pairBrowser();
    expect(deviceOf(new Request("http://x/api/mobile/status", { headers: { authorization: `Bearer ${token}` } }))).toBeUndefined();
    expect(proxy(tailnet("/", { bearer: phone.token })).status).toBe(403);
  });
});
