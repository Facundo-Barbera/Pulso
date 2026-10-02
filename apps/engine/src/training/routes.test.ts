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
import { POST as resumePOST } from "@/app/api/mobile/training/program/blocks/[id]/resume/route";
import { POST as weekNextPOST } from "@/app/api/mobile/training/program/weeks/next/route";
import { GET as sessionGET } from "@/app/api/mobile/training/sessions/[id]/route";
import { POST as sessionsPOST } from "@/app/api/mobile/training/sessions/route";
import { GET as settingsGET, PUT as settingsPUT } from "@/app/api/mobile/training/settings/route";
import { PUT as unitPUT } from "@/app/api/mobile/training/exercises/[id]/unit/route";
import { createPairingCode, redeemPairing } from "../devices";
import { EDB_ATTRIBUTION } from "./exercisedb";
import { editLive } from "./live";
import { clearMediaCache, proposeMedia, reviewMedia } from "./media";
import { createProgram, getSession, saveSession } from "./store";

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
  expect((await unitPUT(req({ method: "PUT", body: "{}" }, false), id("press-banca"))).status).toBe(401);
  expect((await settingsPUT(req({ method: "PUT", body: "{}" }, false))).status).toBe(401);
  expect(liveGET(req({}, false)).status).toBe(401);
  expect((await livePUT(req({ method: "PUT", body: "{}" }, false))).status).toBe(401);
  expect(liveDELETE(req({ method: "DELETE" }, false)).status).toBe(401);
  expect(liveCoachPOST(req({ method: "POST" }, false)).status).toBe(401);
});

test("settings, alternatives and day edits over HTTP", async () => {
  const saved = await settingsPUT(req({ method: "PUT", body: JSON.stringify({ preferredEquipment: ["machine", "cable"] }) }));
  expect(await saved.json()).toEqual({ preferredEquipment: ["machine", "cable"], defaultUnit: "kg", exerciseUnits: {} });
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
  expect(view.settings).toEqual({ preferredEquipment: ["machine", "cable"], defaultUnit: "kg", exerciseUnits: {} });
  const reset = (await (await dayDELETE(req({ method: "DELETE" }), day(dayId))).json()) as ActiveProgramResponse;
  expect(reset.program!.days[0]!.exercises[0]!.exerciseId).toBe("press-banca");
  expect((await dayPUT(req({ method: "PUT", body: JSON.stringify({ scope: "always", exercises: [{ exerciseId: "press-banca" }] }) }), day(dayId))).status).toBe(400);
  expect((await dayPUT(req({ method: "PUT", body: JSON.stringify({ scope: "forever", exercises: [] }) }), day(dayId))).status).toBe(400);
  expect((await dayDELETE(req({ method: "DELETE" }), day("nope"))).status).toBe(404);
  await settingsPUT(req({ method: "PUT", body: JSON.stringify({ preferredEquipment: [] }) }));
});

test("units: the default and one exercise's own, over HTTP", async () => {
  const put = (unit: unknown, exercise = "remo-maquina") => unitPUT(req({ method: "PUT", body: JSON.stringify({ unit }) }), id(exercise));
  expect(await (await put("lb")).json()).toMatchObject({ defaultUnit: "kg", exerciseUnits: { "remo-maquina": "lb" } });
  // Setting the default leaves the equipment and the exercise's own unit alone.
  await settingsPUT(req({ method: "PUT", body: JSON.stringify({ preferredEquipment: ["machine"] }) }));
  const both = await settingsPUT(req({ method: "PUT", body: JSON.stringify({ defaultUnit: "lb" }) }));
  expect(await both.json()).toEqual({ preferredEquipment: ["machine"], defaultUnit: "lb", exerciseUnits: { "remo-maquina": "lb" } });
  expect(await (await put(null)).json()).toMatchObject({ exerciseUnits: {} });
  expect((await put("stone")).status).toBe(400);
  expect((await put("kg", "nope")).status).toBe(404);
  expect((await settingsPUT(req({ method: "PUT", body: JSON.stringify({ defaultUnit: "st" }) }))).status).toBe(400);
  await settingsPUT(req({ method: "PUT", body: JSON.stringify({ preferredEquipment: [], defaultUnit: "kg" }) }));
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
  expect(stored).toMatchObject({ id: "http-live", version: 1, threadId: null, exercises: [{ skipped: false, supersetId: null, sets: [{ rpe: null }] }, { cardioLog: null, supersetId: null }] });
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

test("Terminar never loses a workout: ending the live session saves its done work when the phone's save never came", async () => {
  const at = (path: string, method: string, body?: unknown) => new Request(`http://pulso.test${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
  const live = (id: string) => ({
    id,
    name: "Torso A",
    startedAt: 5_000_000,
    focus: 1,
    exercises: [
      { id: "r", exerciseId: "remo-maquina", name: "Remo en máquina", equipment: "machine", kind: "compound", repMin: 8, repMax: 10, restSeconds: 150, sets: [{ id: "r1", weightKg: 31.75146590, reps: 10, rpe: 0, doneAt: 5_060_000 }, { id: "r2", weightKg: 31.75146590, reps: 9, doneAt: 5_200_000 }, { id: "r3", weightKg: 31.75146590, reps: 8, doneAt: null }] },
      { id: "c", exerciseId: "caminadora", name: "Cinta", equipment: "machine", kind: "cardio", repMin: 1, repMax: 1, restSeconds: 0, sets: [], cardio: { durationMinutes: 20 }, cutShort: { at: 6_000_000, reason: null }, cardioLog: { exerciseId: "caminadora", durationSeconds: 720.4, distanceKm: null, avgHr: 0, inclinePercent: 60, doneAt: 6_000_000 } },
      { id: "s", exerciseId: "press-banca", name: "Press de banca", equipment: "barbell", kind: "compound", repMin: 6, repMax: 8, restSeconds: 120, skipped: true, sets: [{ id: "s1", weightKg: 60, reps: 8, doneAt: null }] },
    ],
    cardioClock: { exerciseId: "c", runningSince: null, accumulatedSeconds: 720.4 },
  });

  // The phone's copy keeps the synced clock and the cut-short mark; an impossible reading is dropped, not refused.
  const put = (await (await livePUT(at("/api/mobile/training/live", "PUT", { session: live("end-1"), baseVersion: 0 }))).json()) as { session: LiveSession };
  expect(put.session.cardioClock).toEqual({ exerciseId: "c", runningSince: null, accumulatedSeconds: 720.4 });
  expect(put.session.exercises[1]).toMatchObject({ cutShort: { at: 6_000_000, reason: null }, cardioLog: { avgHr: null, inclinePercent: null } });
  expect(put.session.exercises[0]!.sets[0]!.rpe).toBeNull();

  const ended = (await liveDELETE(at("/api/mobile/training/live", "DELETE")).json()) as { saved: boolean };
  expect(ended.saved).toBe(true);
  expect(await liveGET(req()).json()).toEqual({ session: null });
  const saved = getSession("end-1")!;
  expect(saved.sets.map((s) => [s.exerciseId, s.setIndex, s.reps])).toEqual([["remo-maquina", 0, 10], ["remo-maquina", 1, 9]]);
  expect(saved.cardio).toMatchObject([{ exerciseId: "caminadora", durationSeconds: 720 }]);
  expect(saved.dayId).toBeNull();

  // The phone's own save arriving later replaces it (same id), not duplicates it.
  const post = await sessionsPOST(at("/api/mobile/training/sessions", "POST", { id: "end-1", name: "Torso A", startedAt: 5_000_000, endedAt: 7_000_000, sets: [{ exerciseId: "remo-maquina", setIndex: 0, weightKg: 31.75, reps: 10, rpe: 0, doneAt: 5_060_000 }], cardio: [{ exerciseId: "caminadora", durationSeconds: 720, avgHr: 0, doneAt: 6_000_000 }] }));
  expect(post.status).toBe(200);
  expect(getSession("end-1")!.sets).toHaveLength(1);

  // A discard forgets it; nothing is saved.
  await livePUT(at("/api/mobile/training/live", "PUT", { session: live("end-2"), baseVersion: 0 }));
  expect(((await liveDELETE(at("/api/mobile/training/live?discard=1", "DELETE")).json()) as { saved: boolean }).saved).toBe(false);
  expect(getSession("end-2")).toBeUndefined();
  expect(await liveGET(req()).json()).toEqual({ session: null });
});

test("the phone's live copy keeps its supersets, normalized", async () => {
  const strength = (id: string, exerciseId: string, supersetId: string | null) => ({ id, exerciseId, name: exerciseId, equipment: "machine", kind: "isolation", repMin: 10, repMax: 12, restSeconds: 60, sets: [], supersetId });
  const live = { id: "http-superset", name: "Brazos", startedAt: 1_000, focus: 0, exercises: [strength("x", "curl-maquina", "a"), strength("y", "extension-cuadriceps", "a"), strength("z", "remo-maquina", "b")] };
  const put = await livePUT(req({ method: "PUT", body: JSON.stringify({ session: live, baseVersion: 0 }) }));
  expect(((await put.json()) as { session: LiveSession }).session.exercises.map((e) => e.supersetId)).toEqual(["a", "a", null]);
  const tooLong = { ...live, exercises: [strength("x", "curl-maquina", "x".repeat(33))] };
  expect((await livePUT(req({ method: "PUT", body: JSON.stringify({ session: tooLong, baseVersion: 1 }) }))).status).toBe(400);
  liveDELETE(req({ method: "DELETE" }));
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

test("the program route carries the blocks; the next week starts early only once this one is complete", async () => {
  const p = createProgram({ name: "Semanas", goal: "x", weeks: 4, days: [{ name: "Único", exercises: [{ exerciseId: "press-banca", sets: 1, repMin: 5, repMax: 5, restSeconds: 60 }] }] });
  const early = await weekNextPOST(req({ method: "POST" }));
  expect(early.status).toBe(409);
  // Today, real time, with no sets: other files' hand-set loads read any later press-banca set as spent.
  const now = Date.now();
  await sessionsPOST(req({ method: "POST", body: JSON.stringify({ id: "weeks-route-1", programId: p.id, dayId: p.days[0]!.id, name: "Único", startedAt: now, endedAt: now + 1000, sets: [] }) }));
  const view = (await (await programGET(req())).json()) as ActiveProgramResponse;
  expect(view.blocks!.at(-1)).toMatchObject({ programId: p.id, weekComplete: true, canStartNextWeek: true });
  expect(view.nextDayId).toBeNull();
  const started = (await (await weekNextPOST(req({ method: "POST" }))).json()) as ActiveProgramResponse;
  expect(started.blocks!.at(-1)!.currentWeek).toBe(2);
  expect(started.nextDayId).toBe(p.days[0]!.id);
  const one = await sessionGET(req(), id("weeks-route-1"));
  expect(((await one.json()) as { id: string }).id).toBe("weeks-route-1");
  expect((await sessionGET(req(), id("nope"))).status).toBe(404);
  expect((await weekNextPOST(req({ method: "POST" }, false))).status).toBe(401);
});

test("Retomar a block over HTTP", async () => {
  const old = createProgram({ name: "Viejo", goal: "x", weeks: 4, days: [{ name: "Día", exercises: [{ exerciseId: "press-banca", sets: 3, repMin: 5, repMax: 8, restSeconds: 60 }] }] });
  createProgram({ name: "Nuevo", goal: "y", weeks: 4, days: [{ name: "Día", exercises: [{ exerciseId: "press-militar", sets: 3, repMin: 5, repMax: 8, restSeconds: 60 }] }] });
  const resumed = (await (await resumePOST(req({ method: "POST" }), id(old.id))).json()) as ActiveProgramResponse;
  expect(resumed.program).toMatchObject({ name: "Viejo" });
  expect(resumed.blocks!.at(-1)!.resumedFrom).toBe(old.id);
  expect((await resumePOST(req({ method: "POST" }), id("missing"))).status).toBe(400);
});

test("a set's segments travel through POST /sessions; an old client's set comes back as one", async () => {
  const at = new Date(2026, 4, 3, 18).getTime();
  const set = (weightKg: number, reps: number, segments?: { weightKg: number; reps: number }[]) => ({ exerciseId: "cruce-poleas", setIndex: 0, weightKg, reps, rpe: null, doneAt: at, ...(segments && { segments }) });
  const post = (id: string, s: ReturnType<typeof set>) =>
    sessionsPOST(req({ method: "POST", body: JSON.stringify({ id, name: "Pecho", startedAt: at, endedAt: at + 3_600_000, sets: [s] }) })).then((r) => r.json());
  const drop = await post("route-drop", set(25, 6, [{ weightKg: 25, reps: 6 }, { weightKg: 20, reps: 4 }]));
  expect(drop.session.sets[0].segments).toEqual([{ weightKg: 25, reps: 6 }, { weightKg: 20, reps: 4 }]);
  const plain = await post("route-plain", set(25, 8));
  expect(plain.session.sets[0].segments).toEqual([{ weightKg: 25, reps: 8 }]);
});
