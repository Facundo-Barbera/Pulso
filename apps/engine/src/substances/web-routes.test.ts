import { beforeEach, expect, test } from "bun:test";
import { GET as overviewGET, POST as logPOST } from "@/app/api/web/sustancias/route";
import { PUT as visibilityPUT } from "@/app/api/web/sustancias/visibilidad/route";
import { db } from "../db";
import { COOKIE } from "../device-auth";
import { createPairingCode, redeemPairing } from "../devices";

const BASE = "http://127.0.0.1:3230/api/web/sustancias";

beforeEach(() => {
  db().exec("DELETE FROM substance_entries; DELETE FROM substance_visibility;");
});

function browser(): Record<string, string> {
  const { code } = createPairingCode(Date.now(), "browser");
  const { token } = redeemPairing({ code, name: "Portátil", kind: "browser" });
  return { "x-pulso-via": "tailnet", cookie: `${COOKIE}=${token}` };
}

const put = (headers: Record<string, string>, visible: unknown) =>
  visibilityPUT(new Request(`${BASE}/visibilidad`, { method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ visible }) }));

test("the Mac sees Sustancias by default and can log", async () => {
  const logged = await logPOST(new Request(BASE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: "2026-09-30", time: "22:00" }) }));
  expect(logged.status).toBe(200);
  const response = overviewGET(new Request(`${BASE}?s=cannabis`));
  expect(response.status).toBe(200);
  expect((await response.json()).summary.substanceId).toBe("cannabis");
});

test("a paired browser gets nothing until it turns Sustancias on for itself", async () => {
  const laptop = browser();
  const other = browser();
  expect(overviewGET(new Request(BASE, { headers: laptop })).status).toBe(404);
  expect((await logPOST(new Request(BASE, { method: "POST", headers: laptop, body: "{}" }))).status).toBe(404);

  expect((await put(laptop, "yes")).status).toBe(400);
  expect(await (await put(laptop, true)).json()).toEqual({ visible: true });
  expect(overviewGET(new Request(BASE, { headers: laptop })).status).toBe(200);
  // Each browser decides for itself.
  expect(overviewGET(new Request(BASE, { headers: other })).status).toBe(404);

  await put(laptop, false);
  expect(overviewGET(new Request(BASE, { headers: laptop })).status).toBe(404);
});

test("an unpaired tailnet request cannot switch it on", async () => {
  expect((await put({ "x-pulso-via": "tailnet" }, true)).status).toBe(401);
});
