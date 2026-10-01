import { afterAll, beforeAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { insertPlanned, setMealTimesFor, setPreferences } from "../calendar/store";
import { db } from "../db";
import { saveSession } from "../training/store";
import { upsertHealthKitWorkouts } from "../workouts";
import { addMedication, adherence, getMedication, logDose, medicationDay, upcomingSlots } from "./store";
import { medicationTools } from "./tools";

// Training-linked slots read sessions, Health workouts and the calendar, which other tests
// read as "the latest": this file gets a database of its own. 2032-05-03 is a Monday.
const g = globalThis as Record<string, unknown>;
const shared = { db: g.__pulso_db__, dir: process.env.PULSO_DATA_DIR };
const own = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-medication-moments-"));
beforeAll(() => {
  delete g.__pulso_db__;
  process.env.PULSO_DATA_DIR = own;
});
afterAll(() => {
  (g.__pulso_db__ as { close(): void } | undefined)?.close();
  g.__pulso_db__ = shared.db;
  process.env.PULSO_DATA_DIR = shared.dir;
  fs.rmSync(own, { recursive: true, force: true });
});

const ms = (date: string, time: string) => new Date(`${date}T${time}:00`).getTime();
const creatina = () =>
  addMedication(
    { name: "Creatina", kind: "suplemento", dose: 5, unit: "g", schedule: { asNeeded: false, times: [], days: [], training: { withinMinutes: 45, restDayTime: "09:00" } } },
    "2032-05-03",
  );
const entreno = (date: string, time: string) => medicationDay(date, time).slots.find((s) => s.slot === "entreno");

test("old schedules read as fixed times, untouched", () => {
  db()
    .query(
      `INSERT INTO medications (id, name, kind, dose, unit, schedule, start_date, active, created_at, updated_at)
       VALUES ('old', 'Vitamina D', 'suplemento', 1000, 'UI', '{"asNeeded":false,"times":["08:00"],"days":[]}', '2032-01-01', 1, 0, 0)`,
    )
    .run();
  expect(getMedication("old").schedule).toEqual({ asNeeded: false, times: ["08:00"], days: [], training: null, meals: [], bedtime: false });
  expect(getMedication("old").schedule).toEqual(getMedication("old").schedule); // reading twice changes nothing
  expect(medicationDay("2032-05-03", "07:00").slots.map((s) => [s.slot, s.moment, s.time])).toEqual([["08:00", "hora", "08:00"]]);
  db().query("DELETE FROM medications WHERE id = 'old'").run();
});

test("a saved Pulso session makes it a training day, due when it ended", () => {
  const med = creatina();
  saveSession({ id: "s1", name: "Torso", startedAt: ms("2032-05-03", "18:00"), endedAt: ms("2032-05-03", "19:05"), sets: [] });
  expect(entreno("2032-05-03", "19:10")).toMatchObject({ medicationId: med.id, time: "19:05", status: "pendiente", training: { state: "trained", until: "19:50" } });
  logDose({ medicationId: med.id, date: "2032-05-03", scheduledTime: "entreno", status: "tomada" });
  expect(entreno("2032-05-03", "19:10")?.status).toBe("tomada");
});

test("a Health workout counts too; walks and duplicates don't", () => {
  upsertHealthKitWorkouts([{ externalId: "walk", activity: "walking", startedAt: ms("2032-05-04", "07:00"), endedAt: ms("2032-05-04", "08:00"), energy: null, distance: null }]);
  expect(entreno("2032-05-04", "12:00")?.training?.state).toBe("rest");
  upsertHealthKitWorkouts([{ externalId: "run", activity: "running", startedAt: ms("2032-05-04", "17:00"), endedAt: ms("2032-05-04", "17:40"), energy: 300, distance: 6000 }]);
  expect(entreno("2032-05-04", "18:00")).toMatchObject({ time: "17:40", training: { state: "trained" } });
});

test("a session planned later today waits; once its end passes without a workout, the rest-day rule fires", () => {
  insertPlanned({ programId: null, dayId: null, name: "Pierna", date: "2032-05-05", time: "18:00", durationMin: 60, reason: null });
  expect(entreno("2032-05-05", "08:00")).toMatchObject({ time: null, training: { state: "planned", plannedAt: "18:00", fallback: "19:00" } });
  expect(entreno("2032-05-05", "19:30")).toMatchObject({ time: "19:00", training: { state: "rest" } });
  // No workout and nothing planned: the rest-day time
  expect(entreno("2032-05-06", "08:00")).toMatchObject({ time: "09:00", training: { state: "rest" } });
});

test("meal-linked slots use the calendar's meal times; upcoming resolves a week", () => {
  setPreferences({ mealTimes: [{ slot: "comida", time: "14:30" }], sleepTime: "23:30" });
  setMealTimesFor(["2032-05-07"], [{ slot: "comida", time: "13:15" }]);
  addMedication({ name: "Omega 3", kind: "suplemento", dose: 1, unit: "cápsula", schedule: { asNeeded: false, times: [], days: [], meals: ["comida"], bedtime: true } }, "2032-05-03");
  const day = (date: string) => medicationDay(date, "08:00").slots.filter((s) => s.name === "Omega 3").map((s) => [s.slot, s.time]);
  expect(day("2032-05-07")).toEqual([["comida", "13:15"], ["dormir", "23:00"]]);
  expect(day("2032-05-08")).toEqual([["comida", "14:30"], ["dormir", "23:00"]]);

  const upcoming = upcomingSlots("2032-05-05", "08:00", 3);
  expect(upcoming.from).toBe("2032-05-05");
  expect(upcoming.slots.filter((s) => s.name === "Creatina").map((s) => [s.date, s.training?.state])).toEqual([
    ["2032-05-05", "planned"],
    ["2032-05-06", "rest"],
    ["2032-05-07", "rest"],
  ]);
});

test("adherence counts training days and rest days by their resolved slot", () => {
  // 05-03 trained + taken, 05-04 trained (run), 05-05 rest after the missed plan, 05-06 rest; as of 05-06 10:00
  const report = adherence("2032-05-06", "10:00");
  const cr = report.medications.find((m) => m.name === "Creatina")!;
  expect(cr.last7).toEqual({ due: 4, taken: 1, rate: 0.25 });
});

test("Coach tools take moments: 'creatina 5 g después de entrenar, y los días que no voy en la mañana'", async () => {
  const handler = (name: string) => medicationTools.find((t) => t.name === name)!.handler as (args: any, extra: unknown) => Promise<any>;
  const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0]!.text);
  const added = parse(
    await handler("add_medication")({ name: "Creatina", kind: "suplemento", dose: 5, unit: "g", schedule: { asNeeded: false, training: { restDayTime: "09:00" } } }, {}),
  );
  expect(added.schedule).toEqual({ asNeeded: false, times: [], days: [], training: { withinMinutes: 60, restDayTime: "09:00" }, meals: [], bedtime: false });

  const updated = parse(await handler("update_medication")({ id: added.id, schedule: { asNeeded: false, training: { withinMinutes: 30, restDayTime: null }, meals: ["desayuno"] } }, {}));
  expect(updated.schedule.training).toEqual({ withinMinutes: 30, restDayTime: null });
  expect(updated.schedule.meals).toEqual(["desayuno"]);

  const logged = parse(await handler("log_dose")({ medicationId: added.id, scheduledTime: "desayuno", status: "tomada" }, {}));
  expect(logged.scheduledTime).toBe("desayuno");
  const bad = await handler("log_dose")({ medicationId: added.id, scheduledTime: "merienda", status: "tomada" }, {});
  expect(bad.isError).toBe(true);
  const empty = await handler("add_medication")({ name: "X", dose: 1, unit: "g", schedule: { asNeeded: false } }, {});
  expect(empty.isError).toBe(true);
});
