import { afterEach, beforeAll, expect, test } from "bun:test";
import type { ActiveProgramResponse, Exercise, ExerciseDetail, ExercisePerformance, LiveSession, SimilarExercise } from "@pulso/contract";
import { GET as detailGET } from "@/app/api/mobile/training/exercises/[id]/route";
import { PUT as notesPUT } from "@/app/api/mobile/training/exercises/[id]/notes/route";
import { GET as performanceGET } from "@/app/api/mobile/training/exercises/[id]/performance/route";
import { GET as listGET } from "@/app/api/mobile/training/exercises/route";
import { GET as mediaGET } from "@/app/api/mobile/training/media/[...path]/route";
import { GET as similarGET } from "@/app/api/mobile/training/exercises/[id]/similar/route";
import { POST as liveCoachPOST } from "@/app/api/mobile/training/live/coach/route";
import { DELETE as liveDELETE, GET as liveGET, PUT as livePUT } from "@/app/api/mobile/training/live/route";
import { DELETE as dayDELETE, PUT as dayPUT } from "@/app/api/mobile/training/program/days/[dayId]/route";
import { GET as programGET } from "@/app/api/mobile/training/program/route";
import { GET as settingsGET, PUT as settingsPUT } from "@/app/api/mobile/training/settings/route";
import { createPairingCode, redeemPairing } from "../devices";
import { EDB_ATTRIBUTION } from "./exercisedb";
import { editLive } from "./live";
import { clearMediaCache, proposeMedia, reviewMedia } from "./media";
import { createProgram, saveSession } from "./store";

let token = "";
beforeAll(() => {
  token = redeemPairing({ code: createPairingCode().code, name: "Test" }).token;
  proposeMedia("press-banca", "EIeI8Vf", 1);
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  clearMediaCache();
});

const req = (init: RequestInit = {}, auth = true) =>
  new Request("http://pulso.test/x", { ...init, headers: { ...(auth ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" } });
const id = (value: string) => ({ params: Promise.resolve({ id: value }) });
const day = (value: string) => ({ params: Promise.resolve({ dayId: value }) });
const at = (url: string, init: RequestInit = {}) =>
  new Request(`http://pulso.test${url}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
const path = (...segments: string[]) => ({ params: Promise.resolve({ path: segments }) });

test("every route wants a paired phone", async () => {
  expect((await detailGET(req({}, false), id("press-banca"))).status).toBe(401);
  expect((await notesPUT(req({ method: "PUT", body: "{}" }, false), id("press-banca"))).status).toBe(401);
  expect((await performanceGET(req({}, false), id("press-banca"))).status).toBe(401);
  expect((await mediaGET(req({}, false), path("exercises", "press-banca", "animation.gif"))).status).toBe(401);
  expect((await similarGET(req({}, false), id("press-banca"))).status).toBe(401);
  expect((await dayPUT(req({ method: "PUT", body: "{}" }, false), day("d"))).status).toBe(401);
  expect((await dayDELETE(req({ method: "DELETE" }, false), day("d"))).status).toBe(401);
  expect(settingsGET(req({}, false)).status).toBe(401);
  expect((await settingsPUT(req({ method: "PUT", body: "{}" }, false))).status).toBe(401);
  expect(liveGET(req({}, false)).status).toBe(401);
  expect((await livePUT(req({ method: "PUT", body: "{}" }, false))).status).toBe(401);
  expect(liveDELETE(req({ method: "DELETE" }, false)).status).toBe(401);
  expect(liveCoachPOST(req({ method: "POST" }, false)).status).toBe(401);
});

test("settings, alternatives and day edits over HTTP", async () => {
  const saved = await settingsPUT(req({ method: "PUT", body: JSON.stringify({ preferredEquipment: ["machine", "cable"] }) }));
  expect(await saved.json()).toEqual({ preferredEquipment: ["machine", "cable"] });
  expect((await settingsPUT(req({ method: "PUT", body: JSON.stringify({ preferredEquipment: ["spaceship"] }) }))).status).toBe(400);

  const similar = (await (await similarGET(at("/api/mobile/training/exercises/press-banca/similar?equipment=machine,cable&limit=3"), id("press-banca"))).json()) as { exercises: SimilarExercise[] };
  expect(similar.exercises.length).toBe(3);
  expect(similar.exercises[0]).toMatchObject({ id: "press-pecho-maquina", preferred: true, thumbnail: null });
  expect(similar.exercises.every((e) => e.equipment === "machine" || e.equipment === "cable")).toBe(true);
  expect((await similarGET(at("/api/mobile/training/exercises/nope/similar"), id("nope"))).status).toBe(404);

  const program = createProgram({ name: "HTTP", goal: "x", weeks: 4, days: [{ name: "A", exercises: [{ exerciseId: "press-banca", sets: 3, repMin: 6, repMax: 8, restSeconds: 120 }] }] });
  const dayId = program.days[0]!.id;
  const bench = program.days[0]!.exercises[0]!;
  const today = await dayPUT(req({ method: "PUT", body: JSON.stringify({ scope: "today", exercises: [{ ...bench, exerciseId: "press-pecho-maquina" }] }) }), day(dayId));
  const view = (await today.json()) as ActiveProgramResponse;
  expect(view.program!.days[0]).toMatchObject({ overridden: true, exercises: [{ id: bench.id, exerciseId: "press-pecho-maquina" }] });
  expect(view.settings).toEqual({ preferredEquipment: ["machine", "cable"] });
  const reset = (await (await dayDELETE(req({ method: "DELETE" }), day(dayId))).json()) as ActiveProgramResponse;
  expect(reset.program!.days[0]!.exercises[0]!.exerciseId).toBe("press-banca");
  expect((await dayPUT(req({ method: "PUT", body: JSON.stringify({ scope: "always", exercises: [{ exerciseId: "press-banca" }] }) }), day(dayId))).status).toBe(400);
  expect((await dayPUT(req({ method: "PUT", body: JSON.stringify({ scope: "forever", exercises: [] }) }), day(dayId))).status).toBe(400);
  expect((await dayDELETE(req({ method: "DELETE" }), day("nope"))).status).toBe(404);
  await settingsPUT(req({ method: "PUT", body: JSON.stringify({ preferredEquipment: [] }) }));
});

test("day edits over HTTP carry superset ids, normalized", async () => {
  const program = createProgram({
    name: "HTTP superseries",
    goal: "x",
    weeks: 4,
    days: [{ name: "A", exercises: [{ exerciseId: "curl-maquina", sets: 3, repMin: 10, repMax: 12, restSeconds: 60 }, { exerciseId: "press-pecho-maquina", sets: 3, repMin: 10, repMax: 12, restSeconds: 60 }] }],
  });
  const [curl, press] = program.days[0]!.exercises;
  const put = (scope: string, exercises: unknown[]) => dayPUT(req({ method: "PUT", body: JSON.stringify({ scope, exercises }) }), day(program.days[0]!.id));
  const paired = (await (await put("always", [{ ...curl, supersetId: "a" }, { ...press, supersetId: "a" }, { exerciseId: "eliptica", supersetId: "a" }])).json()) as ActiveProgramResponse;
  expect(paired.program!.days[0]!.exercises.map((e) => e.supersetId)).toEqual(["a", "a", null]);
  expect((await put("today", [{ ...curl, supersetId: "x".repeat(33) }])).status).toBe(400);
});

test("the live session syncs both ways and binds a Coach thread", async () => {
  liveDELETE(req({ method: "DELETE" }));
  expect(await liveGET(req()).json()).toEqual({ session: null });
  expect(liveCoachPOST(req({ method: "POST" })).status).toBe(404);

  const live = {
    id: "http-live",
    name: "Torso",
    startedAt: 1_000,
    exercises: [
      { id: "x", exerciseId: "press-banca", name: "Press de banca", equipment: "barbell", kind: "compound", repMin: 6, repMax: 8, restSeconds: 120, sets: [{ id: "s1", weightKg: 60, reps: 8, doneAt: 2_000 }] },
      { id: "y", exerciseId: "eliptica", name: "Elíptica", equipment: "machine", kind: "cardio", repMin: 1, repMax: 1, restSeconds: 0, sets: [], cardio: { durationMinutes: 20, zone: 2 } },
    ],
    focus: 0,
  };
  const put = await livePUT(req({ method: "PUT", body: JSON.stringify({ session: live, baseVersion: 0 }) }));
  const stored = ((await put.json()) as { session: LiveSession }).session;
  expect(stored).toMatchObject({ id: "http-live", version: 1, threadId: null, exercises: [{ skipped: false, sets: [{ rpe: null }] }, { cardioLog: null }] });
  expect((await livePUT(req({ method: "PUT", body: JSON.stringify({ session: { id: "x" }, baseVersion: 0 }) }))).status).toBe(400);

  const { threadId } = (await liveCoachPOST(req({ method: "POST" })).json()) as { threadId: string };
  expect(threadId).toBeTruthy();
  editLive([{ op: "skip", exercise: 2 }]);

  const conflict = await livePUT(req({ method: "PUT", body: JSON.stringify({ session: live, baseVersion: 1 }) }));
  expect(conflict.status).toBe(409);
  const body = (await conflict.json()) as { code: string; session: LiveSession };
  expect(body.code).toBe("conflict");
  expect(body.session).toMatchObject({ version: 2, threadId, exercises: [{}, { skipped: true }] });

  expect(((await liveGET(req()).json()) as { session: LiveSession }).session.version).toBe(2);
  expect(liveDELETE(req({ method: "DELETE" })).status).toBe(200);
  expect(await liveGET(req()).json()).toEqual({ session: null });
});

test("GET exercises/:id returns the full ExerciseDetail", async () => {
  const response = await detailGET(req(), id("press-banca"));
  const detail = (await response.json()) as ExerciseDetail;
  expect(detail).toMatchObject({
    id: "press-banca",
    name: "Press de banca",
    nameEn: "Barbell bench press",
    primaryMuscles: ["chest"],
    media: {
      animation: "/api/mobile/training/media/exercises/press-banca/animation.gif",
      thumbnail: "/api/mobile/training/media/exercises/press-banca/thumbnail.gif",
      source: "exercisedb",
      attribution: EDB_ATTRIBUTION,
    },
    notes: null,
  });
  expect(detail.instructions.length).toBeGreaterThanOrEqual(3);
  expect(detail.videos.length).toBeGreaterThan(0);

  const bare = (await (await detailGET(req(), id("curl-martillo"))).json()) as ExerciseDetail;
  expect(bare.media).toEqual({ animation: null, thumbnail: null, source: null, attribution: null });
  expect((await detailGET(req(), id("nope"))).status).toBe(404);
});

test("PUT notes stores, trims and clears the person's notes", async () => {
  const put = (notes: unknown, exercise = "sentadilla") => notesPUT(req({ method: "PUT", body: JSON.stringify({ notes }) }), id(exercise));
  expect(await (await put("  Cinturón desde 120 kg  ")).json()).toEqual({ notes: "Cinturón desde 120 kg" });
  expect(((await (await detailGET(req(), id("sentadilla"))).json()) as ExerciseDetail).notes).toBe("Cinturón desde 120 kg");
  expect(await (await put("   ")).json()).toEqual({ notes: null });
  expect(((await (await detailGET(req(), id("sentadilla"))).json()) as ExerciseDetail).notes).toBeNull();
  expect((await put(42)).status).toBe(400);
  expect((await put("x", "nope")).status).toBe(404);
});

test("GET exercises/:id/performance comes from logged sessions", async () => {
  const day = Date.parse("2026-09-01T18:00:00Z");
  const sets = (at: number, work: [number, number][]) => work.map(([weightKg, reps], i) => ({ exerciseId: "remo-barra", setIndex: i, weightKg, reps, rpe: null, doneAt: at + i }));
  saveSession({ id: "perf-1", name: "Torso", startedAt: day, endedAt: day + 3_600_000, sets: sets(day, [[60, 10], [60, 10]]) });
  saveSession({ id: "perf-2", name: "Torso", startedAt: day + 86_400_000, endedAt: day + 90_000_000, sets: sets(day + 86_400_000, [[70, 6]]) });
  const result = (await (await performanceGET(req(), id("remo-barra"))).json()) as ExercisePerformance;
  expect(result.maxWeight).toEqual({ kg: 70, reps: 6, at: day + 86_400_000 });
  expect(result.bestE1rm).toEqual({ kg: 84, at: day + 86_400_000 });
  expect(result.maxVolume).toEqual({ kg: 1200, at: day });
  expect(result.history.map((p) => p.at)).toEqual([day, day + 86_400_000]);
  expect((await performanceGET(req(), id("nope"))).status).toBe(404);
});

const GIF = Uint8Array.from([..."GIF89a"].map((c) => c.charCodeAt(0)).concat([1, 0, 1, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0, 0x3b]));

test("media streams the GIF from ExerciseDB with an hour-long private cache", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    return new Response(GIF);
  }) as typeof fetch;
  const response = await mediaGET(req(), path("exercises", "press-banca", "animation.gif"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/gif");
  expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(GIF);
  const thumb = await mediaGET(req(), path("exercises", "press-banca", "thumbnail.gif"));
  expect(thumb.status).toBe(200);
  expect(urls).toEqual(["https://static.exercisedb.dev/media/EIeI8Vf.gif"]);
});

test("media refuses unsafe paths and exercises without media, without touching the network", async () => {
  globalThis.fetch = (async () => {
    throw new Error("no network for bad paths");
  }) as unknown as typeof fetch;
  for (const segments of [["..", "..", "pulso.sqlite"], ["exercises", "..", "animation.gif"], ["exercises", "curl-martillo", "animation.gif"], ["exercises", "press-banca", "x.gif"]]) {
    expect((await mediaGET(req(), path(...segments))).status).toBe(404);
  }
});

test("a rejected match takes the media away", async () => {
  proposeMedia("prensa", "10Z2DXU", 1);
  reviewMedia("prensa", "reject");
  expect(((await (await detailGET(req(), id("prensa"))).json()) as ExerciseDetail).media.animation).toBeNull();
  // Re-running the import does not undo the review.
  expect(proposeMedia("prensa", "10Z2DXU", 1)).toBe(false);
});

test("the list and the active program carry thumbnail URLs", async () => {
  const { exercises } = (await (await listGET(req())).json()) as { exercises: Exercise[] };
  expect(exercises.find((e) => e.id === "press-banca")?.thumbnail).toBe("/api/mobile/training/media/exercises/press-banca/thumbnail.gif");
  expect(exercises.find((e) => e.id === "curl-martillo")?.thumbnail).toBeNull();

  createProgram({ name: "P", goal: "G", weeks: 4, days: [{ name: "D", exercises: [{ exerciseId: "press-banca", sets: 3, repMin: 5, repMax: 8, restSeconds: 120 }] }] });
  const view = (await (await programGET(req())).json()) as ActiveProgramResponse;
  expect(view.program?.days[0]?.exercises[0]?.animation).toBe("/api/mobile/training/media/exercises/press-banca/animation.gif");
});
