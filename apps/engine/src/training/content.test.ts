import { expect, test } from "bun:test";
import { ANATOMY } from "./anatomy";
import { LIBRARY } from "./library";
import { TECHNIQUE } from "./technique";
import { VIDEOS } from "./videos";

const ids = new Set(LIBRARY.map((e) => e.id));

test("every library exercise has a muscle map with at least one primary", () => {
  for (const e of LIBRARY) {
    const anatomy = ANATOMY[e.id];
    expect(anatomy, e.id).toBeDefined();
    expect(anatomy!.primary.length, e.id).toBeGreaterThan(0);
    expect(anatomy!.secondary.filter((m) => anatomy!.primary.includes(m)), e.id).toEqual([]);
    expect(anatomy!.nameEn.trim(), e.id).not.toBe("");
  }
  expect(Object.keys(ANATOMY).filter((id) => !ids.has(id))).toEqual([]);
});

test("every library exercise has 3–6 Spanish steps and 2–4 tips", () => {
  for (const e of LIBRARY) {
    const t = TECHNIQUE[e.id];
    expect(t, e.id).toBeDefined();
    expect(t!.instructions.length, e.id).toBeGreaterThanOrEqual(3);
    expect(t!.instructions.length, e.id).toBeLessThanOrEqual(6);
    expect(t!.tips.length, e.id).toBeGreaterThanOrEqual(2);
    expect(t!.tips.length, e.id).toBeLessThanOrEqual(4);
  }
  expect(Object.keys(TECHNIQUE).filter((id) => !ids.has(id))).toEqual([]);
});

test("videos point at library ids with well-formed YouTube ids, one or two each", () => {
  for (const [id, videos] of Object.entries(VIDEOS)) {
    expect(ids.has(id), id).toBe(true);
    expect(videos.length, id).toBeGreaterThanOrEqual(1);
    expect(videos.length, id).toBeLessThanOrEqual(2);
    for (const v of videos) expect(v.youtubeId, id).toMatch(/^[A-Za-z0-9_-]{11}$/);
  }
  for (const lift of ["press-banca", "sentadilla", "peso-muerto", "press-militar", "remo-barra", "dominadas", "peso-muerto-rumano", "hip-thrust", "jalon-pecho", "prensa"]) {
    expect(VIDEOS[lift]?.length, lift).toBeGreaterThan(0);
  }
});
