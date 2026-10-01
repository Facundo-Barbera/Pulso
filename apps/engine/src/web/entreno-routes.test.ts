import { afterEach, expect, test } from "bun:test";
import type { SessionSaved } from "@pulso/contract";
import { GET as overviewGET } from "@/app/api/web/entreno/route";
import { GET as exerciseGET } from "@/app/api/web/entreno/exercises/[id]/route";
import { PUT as notesPUT } from "@/app/api/web/entreno/exercises/[id]/notes/route";
import { GET as mediaGET } from "@/app/api/web/entreno/media/[...path]/route";
import { POST as sessionsPOST } from "@/app/api/web/entreno/sessions/route";
import { clearMediaCache, proposeMedia } from "../training/media";
import { getSession } from "../training/store";
import { gate } from "../tailnet-gate";
import type { EntrenoOverview, ExerciseView } from "./entreno";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  clearMediaCache();
});

const req = (init: RequestInit = {}) => new Request("http://pulso.test/x", { ...init, headers: { "content-type": "application/json" } });
const id = (value: string) => ({ params: Promise.resolve({ id: value }) });
const path = (...segments: string[]) => ({ params: Promise.resolve({ path: segments }) });

test("a paired browser reads Entreno with `view` and logs sessions or notes only with `edit`", () => {
  const viewer = { scopes: ["view" as const] };
  expect(gate({ method: "GET", pathname: "/api/web/entreno", device: viewer }).allow).toBe(true);
  expect(gate({ method: "GET", pathname: "/api/web/entreno/media/exercises/press-banca/thumbnail.gif", device: viewer }).allow).toBe(true);
  expect(gate({ method: "POST", pathname: "/api/web/entreno/sessions", device: viewer }).allow).toBe(false);
  expect(gate({ method: "PUT", pathname: "/api/web/entreno/exercises/press-banca/notes", device: viewer }).allow).toBe(false);
  expect(gate({ method: "POST", pathname: "/api/web/entreno/sessions", device: { scopes: ["view", "edit"] } }).allow).toBe(true);
});

test("a session posted from the web lands in the training store, upserted by id, with its records", async () => {
  const t = Date.now() - 86_400_000;
  const body = (weightKg: number, startedAt: number, sessionId: string) =>
    JSON.stringify({ id: sessionId, name: "Torso A", startedAt, endedAt: startedAt + 3_000_000, sets: [{ exerciseId: "press-militar", setIndex: 0, weightKg, reps: 5, rpe: 8, doneAt: startedAt + 60_000 }] });
  expect((await sessionsPOST(req({ method: "POST", body: body(40, t - 86_400_000, "web-old") }))).status).toBe(200);
  const first = (await (await sessionsPOST(req({ method: "POST", body: body(45, t, "web-new") }))).json()) as SessionSaved;
  expect(first.prs.map((p) => p.kind)).toContain("weight");
  await sessionsPOST(req({ method: "POST", body: body(47.5, t, "web-new") }));
  expect(getSession("web-new")?.sets.map((s) => s.weightKg)).toEqual([47.5]);

  const overview = (await overviewGET().json()) as EntrenoOverview;
  expect(overview.history.find((h) => h.id === "web-new")?.exercises[0]).toMatchObject({ name: "Press militar", record: true });

  expect((await sessionsPOST(req({ method: "POST", body: "{}" }))).status).toBe(400);
  expect((await sessionsPOST(req({ method: "POST", body: body(40, t, "web-bad").replace("press-militar", "nope") }))).status).toBe(400);
});

test("the exercise route returns its guide and records; notes are stored and cleared", async () => {
  const view = (await (await exerciseGET(req(), id("press-militar"))).json()) as ExerciseView;
  expect(view.detail.id).toBe("press-militar");
  expect(view.performance?.maxWeight?.kg).toBeGreaterThan(0);
  expect((await exerciseGET(req(), id("nope"))).status).toBe(404);

  const put = (notes: string | null, exercise = "press-militar") => notesPUT(req({ method: "PUT", body: JSON.stringify({ notes }) }), id(exercise));
  expect(await (await put("  Codos un poco delante  ")).json()).toEqual({ notes: "Codos un poco delante" });
  expect(await (await put("")).json()).toEqual({ notes: null });
  expect((await put("x", "nope")).status).toBe(404);
});

test("media streams through the web route and refuses anything that is not a mapped exercise", async () => {
  proposeMedia("press-banca", "EIeI8Vf", 1);
  const gif = Uint8Array.from([...Array.from("GIF89a", (c) => c.charCodeAt(0)), 1, 0, 1, 0, 0, 0, 0, 0x3b]);
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(gif);
  }) as unknown as typeof fetch;
  const response = await mediaGET(req(), path("exercises", "press-banca", "animation.gif"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
  expect((await mediaGET(req(), path("exercises", "..", "animation.gif"))).status).toBe(404);
  expect((await mediaGET(req(), path("exercises", "sentadilla-hack", "animation.gif"))).status).toBe(404);
  expect(calls).toBe(1);
});
