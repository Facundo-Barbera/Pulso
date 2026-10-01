import { expect, test } from "bun:test";
import type { BodyImport, BodyScan, InBodyParse, Profile } from "@pulso/contract";
import { PUT as goalsPUT } from "@/app/api/web/cuerpo/goals/route";
import { POST as importPOST } from "@/app/api/web/cuerpo/import/route";
import { POST as inbodyPOST } from "@/app/api/web/cuerpo/inbody/route";
import { PATCH as profilePATCH } from "@/app/api/web/cuerpo/profile/route";
import { DELETE as scanDELETE } from "@/app/api/web/cuerpo/scans/[id]/route";
import { POST as scanPOST } from "@/app/api/web/cuerpo/scans/route";
import { bodyChanges, bodyOverview } from "./cuerpo";

const BASE = "http://127.0.0.1:3281/api/web/cuerpo";
const DAY = 86_400_000;
const send = (method: string, body: unknown) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Invented values. */
const CSV = "Date,Weight(kg),Skeletal Muscle Mass(kg),Body Fat Mass(kg),Percent Body Fat(%)\n20250301080000,84.0,33.5,21.0,25.0\n20250315080000,83.1,33.8,20.0,24.1\nnot-a-date,80,30,20,25\n";

test("changes compare with the newest earlier scan that has each metric", () => {
  const scan = (measuredAt: number, values: Partial<BodyScan>) => ({ measuredAt, weight: null, skeletalMuscleMass: null, bodyFatMass: null, percentBodyFat: null, ...values }) as BodyScan;
  const changes = bodyChanges([
    scan(3 * DAY, { weight: 80, percentBodyFat: 20 }),
    scan(2 * DAY, { weight: 81 }),
    scan(1 * DAY, { weight: 82, percentBodyFat: 21.5 }),
  ]);
  expect(changes.weight).toEqual({ delta: -1, since: 2 * DAY });
  expect(changes.percentBodyFat).toEqual({ delta: -1.5, since: DAY });
  expect(changes.skeletalMuscleMass).toBeNull();
  expect(bodyChanges([]).weight).toBeNull();
});

test("a CSV import lands in the overview, newest first, without raw payloads; re-importing does not duplicate", async () => {
  const response = await importPOST(new Request(`${BASE}/import`, { method: "POST", body: CSV }));
  const result: BodyImport = await response.json();
  expect(response.status).toBe(200);
  expect(result.imported).toBe(2);
  expect(result.skipped).toEqual([{ line: 4, reason: "Sin fecha legible." }]);
  await importPOST(new Request(`${BASE}/import`, { method: "POST", body: CSV }));

  const overview = bodyOverview();
  const imported = overview.scans.filter((s) => s.externalId?.startsWith("inbody:"));
  expect(imported).toHaveLength(2);
  expect(overview.scans.every((s) => s.raw === null)).toBe(true);
  expect(overview.projections.map((p) => p.metric)).toEqual(["weight", "bodyFatMass", "skeletalMuscleMass", "percentBodyFat"]);
});

test("an unreadable CSV is a 422 and an empty body a 400", async () => {
  expect((await importPOST(new Request(`${BASE}/import`, { method: "POST", body: "a,b\n1,2\n" }))).status).toBe(422);
  expect((await importPOST(new Request(`${BASE}/import`, { method: "POST", body: " " }))).status).toBe(400);
});

test("a QR payload is parsed without saving; an unknown one is a 422 with its kept id", async () => {
  const before = bodyOverview().scans.length;
  const ok: InBodyParse = await (await inbodyPOST(new Request(`${BASE}/inbody`, send("POST", { payload: "WT=79.5&SMM=35.2&PBF=18.4&DATE=20250320073000" })))).json();
  expect(ok.ok && ok.scan).toMatchObject({ weight: 79.5, skeletalMuscleMass: 35.2, percentBodyFat: 18.4, source: "inbody" });
  expect(bodyOverview().scans.length).toBe(before);

  const bad = await inbodyPOST(new Request(`${BASE}/inbody`, send("POST", { payload: "hola" })));
  expect(bad.status).toBe(422);
  expect(((await bad.json()) as InBodyParse & { ok: false }).payloadId).toBeString();
  expect((await inbodyPOST(new Request(`${BASE}/inbody`, send("POST", {})))).status).toBe(400);
});

test("a manual scan is saved, shows as latest, and can be deleted", async () => {
  const created = await scanPOST(new Request(`${BASE}/scans`, send("POST", { measuredAt: Date.now(), weight: 78.2, percentBodyFat: 17.9 })));
  expect(created.status).toBe(201);
  const { scan } = (await created.json()) as { scan: BodyScan };
  expect(scan.bodyFatMass).toBe(14); // completed from weight × %
  expect(bodyOverview().latest?.id).toBe(scan.id);

  expect((await scanPOST(new Request(`${BASE}/scans`, send("POST", { skeletalMuscleMass: 30 })))).status).toBe(400);
  const params = { params: Promise.resolve({ id: scan.id }) };
  expect((await scanDELETE(new Request(`${BASE}/scans/${scan.id}`, { method: "DELETE" }), params)).status).toBe(200);
  expect((await scanDELETE(new Request(`${BASE}/scans/${scan.id}`, { method: "DELETE" }), params)).status).toBe(404);
});

test("goals set and clear, and come back with the metric's projection", async () => {
  const set = await (await goalsPUT(new Request(`${BASE}/goals`, send("PUT", { metric: "weight", target: 76 })))).json();
  expect(set.goal).toMatchObject({ metric: "weight", target: 76 });
  expect(set.projection.metric).toBe("weight");
  expect(bodyOverview().goals.map((g) => g.metric)).toContain("weight");
  await goalsPUT(new Request(`${BASE}/goals`, send("PUT", { metric: "weight", target: null })));
  expect(bodyOverview().goals.map((g) => g.metric)).not.toContain("weight");
  expect((await goalsPUT(new Request(`${BASE}/goals`, send("PUT", { metric: "height", target: 1 })))).status).toBe(400);
});

test("the profile patch merges, clears with null, and refuses fields Cuerpo does not edit", async () => {
  const first: Profile = await (await profilePATCH(new Request(`${BASE}/profile`, send("PATCH", { age: 34, sex: "male", heightCm: 178, goals: "Bajar a 15 % de grasa" })))).json();
  expect(first).toMatchObject({ age: 34, sex: "male", heightCm: 178, goals: "Bajar a 15 % de grasa" });
  const second: Profile = await (await profilePATCH(new Request(`${BASE}/profile`, send("PATCH", { goals: null, heightCm: 179 })))).json();
  expect(second.goals).toBeUndefined();
  expect(second.heightCm).toBe(179);
  expect(bodyOverview().profile.age).toBe(34);
  expect((await profilePATCH(new Request(`${BASE}/profile`, send("PATCH", { notes: "x" })))).status).toBe(400);
  expect((await profilePATCH(new Request(`${BASE}/profile`, send("PATCH", { heightCm: 20 })))).status).toBe(400);
});
