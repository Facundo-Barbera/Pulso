import { afterAll, beforeAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { TOOLS } from "../agent/registry";
import { addScan, scanInputSchema } from "../body/store";
import { addMedication, logDose } from "../medication/store";
import { logMeal } from "../nutrition/store";
import { night } from "../sleep/fixtures";
import { upsertSleepSegments } from "../sleep/store";
import type { Program } from "@pulso/contract";
import { createProgram, saveSession } from "../training/store";
import { upsertHealthKitWorkouts } from "../workouts";
import { plannedView, planTrainingWeek, replan, updatePlannedSession } from "./schedule";
import { addBusyBlock, addHealthEvent, deleteBusyBlock, setMealTimesFor, setPreferences, syncAppleCalendar, updateHealthEvent } from "./store";
import { timeline } from "./timeline";
import { calendarTools } from "./tools";

// One database per test process, so these run as one story in order, in a week nobody else uses.
// 2031-03-03 is a Monday; "now" is 08:00 that day, local.
const MON = "2031-03-03";
const NOW = new Date(2031, 2, 3, 8, 0);
const ms = (date: string, time: string) => new Date(`${date}T${time}:00`).getTime();

// This file writes into other features' tables (sleep, scans, meals), whose tests read "the latest" data:
// it gets a database of its own and hands the shared one back afterwards.
const g = globalThis as Record<string, unknown>;
const shared = { db: g.__pulso_db__, dir: process.env.PULSO_DATA_DIR };
const own = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-calendar-test-"));
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

let program: Program;
beforeAll(() => {
  program = createProgram({
  name: "Torso/Pierna",
  goal: "Fuerza",
  weeks: 8,
  days: [
    { name: "Torso", exercises: [{ exerciseId: "press-banca", sets: 3, repMin: 6, repMax: 8, restSeconds: 120 }] },
    { name: "Pierna", exercises: [{ exerciseId: "sentadilla-goblet", sets: 3, repMin: 8, repMax: 10, restSeconds: 120 }] },
    { name: "Full", exercises: [{ exerciseId: "press-banca", sets: 2, repMin: 8, repMax: 10, restSeconds: 90 }] },
  ],
  });
});
const day = (name: string) => program.days.find((d) => d.name === name)!;

test("plan_training_week places the active program around preferences", () => {
  setPreferences({ trainingTimes: ["18:00"], sessionMinutes: 60, restDays: [7] });
  const plan = planTrainingWeek({ from: MON, reason: "Semana tipo" }, NOW);
  expect(plan.sessions.map((s) => [s.name, s.date, s.time, s.status])).toEqual([
    ["Torso", "2031-03-03", "18:00", "planned"],
    ["Pierna", "2031-03-05", "18:00", "planned"],
    ["Full", "2031-03-07", "18:00", "planned"],
  ]);
  expect(plan.sessions[0]!.reason).toBe("Semana tipo");
});

test("a new busy block moves the clashing session to the nearest free slot", () => {
  const block = addBusyBlock({ title: "Viaje a Madrid", date: "2031-03-05", endDate: "2031-03-06", allDay: true, source: "coach" });
  const result = replan(NOW);
  expect(result.moved).toEqual([{ id: expect.any(String), name: "Pierna", from: "2031-03-05", to: "2031-03-04", time: "18:00" }]);
  const moved = plannedView(MON, "2031-03-09", "2031-03-03").find((s) => s.name === "Pierna")!;
  expect(moved).toMatchObject({ status: "moved", movedFrom: "2031-03-05", conflict: null, reason: "Movida: Ocupado todo el día: Viaje a Madrid" });

  // Deleting the block leaves the moved session where it is.
  deleteBusyBlock(block.id);
  expect(replan(NOW)).toEqual({ moved: [], unresolved: [] });
});

test("a severe injury flags sessions that load it instead of moving them", () => {
  const knee = addHealthEvent({ kind: "lesion", title: "Esguince de rodilla", bodyArea: "knee", severity: 4, startDate: "2031-03-01" }, MON);
  expect(knee.status).toBe("activa");
  const result = replan(NOW);
  expect(result.moved).toEqual([]);
  expect(result.unresolved).toEqual([{ id: expect.any(String), name: "Pierna", date: "2031-03-04", conflict: "Esguince de rodilla (rodilla, 4/5) afecta Sentadilla goblet" }]);

  // A fresh plan keeps that day off and says why.
  const plan = planTrainingWeek({ from: MON }, NOW);
  expect(plan.sessions.map((s) => s.name)).toEqual(["Torso", "Full"]);
  expect(plan.unplaced).toEqual([{ dayId: day("Pierna").id, name: "Pierna", reason: expect.stringContaining("rodilla, 4/5") }]);

  // Healing turns it into a warning; resolving it without an end date ends it today.
  updateHealthEvent(knee.id, { severity: 2, status: "recuperandose" }, MON);
  expect(planTrainingWeek({ from: MON }, NOW).warnings[0]).toMatchObject({ name: "Pierna" });
  expect(updateHealthEvent(knee.id, { status: "resuelta" }, "2031-03-03").endDate).toBe("2031-03-03");
});

test("logging the session marks the plan done; skipping and moving go through update", () => {
  const plan = planTrainingWeek({ from: MON }, NOW);
  saveSession({ id: "s-torso", programId: program.id, dayId: day("Torso").id, name: "Torso", startedAt: ms(MON, "18:05"), endedAt: ms(MON, "19:00"), sets: [] });
  const view = plannedView(MON, "2031-03-09", "2031-03-04");
  expect(view.find((s) => s.name === "Torso")).toMatchObject({ status: "done", sessionId: "s-torso" });

  const full = plan.sessions.find((s) => s.name === "Full")!;
  expect(updatePlannedSession(full.id, { date: "2031-03-08", time: "10:00" }, NOW)).toMatchObject({ status: "moved", movedFrom: full.date, time: "10:00" });
  expect(updatePlannedSession(full.id, { status: "skipped", reason: "Cansado" }, NOW)).toMatchObject({ status: "skipped", reason: "Cansado" });
});

test("the timeline merges every feature into one list", () => {
  const day = "2031-03-10";
  logMeal({ slot: "desayuno", name: "Avena", quantity: 60, unit: "g", kcal: 230, protein: 8, carbs: 40, fat: 4, fiber: 6, eatenAt: ms(day, "08:10") });
  logMeal({ slot: "desayuno", name: "Leche", quantity: 200, unit: "g", kcal: 120, protein: 6, carbs: 10, fat: 6, fiber: 0, eatenAt: ms(day, "08:12") });
  const med = addMedication({ name: "Vitamina D", kind: "suplemento", dose: 1000, unit: "UI", schedule: { asNeeded: false, times: ["09:00"], days: [] }, startDate: day }, day);
  logDose({ medicationId: med.id, date: day, scheduledTime: "09:00", status: "tomada", takenAt: ms(day, "09:20") });
  upsertSleepSegments(night(day));
  addScan(scanInputSchema.parse({ source: "inbody", measuredAt: ms(day, "11:00"), weight: 80, percentBodyFat: 15 }));
  saveSession({ id: "s-extra", name: "Brazos", startedAt: ms(day, "18:00"), endedAt: ms(day, "18:45"), sets: [] });
  upsertHealthKitWorkouts([
    { externalId: "hk-copy", activity: "strength", startedAt: ms(day, "18:00"), endedAt: ms(day, "18:45"), energy: 200, distance: null },
    { externalId: "hk-run", activity: "running", startedAt: ms(day, "07:00"), endedAt: ms(day, "07:30"), energy: 300, distance: 5000 },
  ]);
  addBusyBlock({ title: "Dentista", date: day, start: "12:00", end: "13:00" });
  addHealthEvent({ kind: "enfermedad", title: "Resfriado", bodyArea: "general", severity: 2, startDate: day, endDate: "2031-03-11" }, "2031-03-20");
  setMealTimesFor([day], [{ slot: "desayuno", time: "08:00" }, { slot: "cena", time: "21:00" }]);

  const { items } = timeline(day, day, new Date(2031, 2, 10, 7, 0));
  const byKind = (kind: string) => items.filter((i) => i.kind === kind);
  expect(byKind("meal")).toEqual([expect.objectContaining({ title: "Desayuno", subtitle: "2 alimentos · 350 kcal", start: `${day}T08:10`, link: { tab: "dieta", id: null } })]);
  // Breakfast is logged, so only dinner shows as a planned time.
  expect(byKind("meal_time").map((i) => [i.title, i.start])).toEqual([["Cena", `${day}T21:00`]]);
  expect(byKind("dose")).toEqual([expect.objectContaining({ title: "Vitamina D", subtitle: "Tomada · 1000 UI", start: `${day}T09:20`, status: "tomada" })]);
  expect(byKind("sleep")).toHaveLength(1);
  expect(byKind("body_scan")[0]).toMatchObject({ title: "InBody", subtitle: "80 kg · 15 % grasa", link: { tab: "cuerpo" } });
  expect(byKind("training")[0]).toMatchObject({ title: "Brazos", status: "done", subtitle: "45 min" });
  // The Health copy of the Pulso session is dropped; the run stays.
  expect(byKind("workout").map((i) => i.title)).toEqual(["Carrera"]);
  expect(byKind("busy")[0]).toMatchObject({ title: "Dentista", start: `${day}T12:00`, end: `${day}T13:00`, link: { tab: "calendario" } });
  expect(byKind("health")[0]).toMatchObject({ title: "Resfriado", allDay: true, subtitle: "Enfermedad · general · 2/5" });
  // All-day first, then by start time.
  expect(items[0]!.allDay).toBe(true);
  const starts = items.filter((i) => !i.allDay).map((i) => i.start!);
  expect(starts).toEqual([...starts].sort());
});

test("Apple Calendar sync replaces its own blocks and leaves the rest", () => {
  const sync = (titles: string[]) =>
    syncAppleCalendar({
      from: "2031-04-01",
      to: "2031-04-07",
      events: titles.map((title, i) => ({ externalId: `ek-${title}`, title, allDay: false, date: `2031-04-0${i + 1}`, start: "10:00", end: "11:00" })),
    });
  addBusyBlock({ title: "Mío", date: "2031-04-02", allDay: true });
  expect(sync(["Uno", "Dos"])).toBe(2);
  expect(sync(["Uno"])).toBe(1);
  const busy = timeline("2031-04-01", "2031-04-07").items.filter((i) => i.kind === "busy");
  expect(busy.map((i) => [i.title, i.status])).toEqual([["Uno", "apple_calendar"], ["Mío", "manual"]]);
});

// ── Tools ────────────────────────────────────────────────────────────────────

const call = async (name: string, args: Record<string, unknown>) => {
  const t = calendarTools.find((t) => t.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  const result = await t.handler(z.object(t.inputSchema).parse(args) as never, undefined);
  const text = (result.content[0] as { text: string }).text;
  return { isError: result.isError === true, text, data: result.isError ? undefined : JSON.parse(text) };
};

test("every calendar tool is registered with the agent", () => {
  const names = TOOLS.map((t) => t.name);
  for (const t of calendarTools) expect(names).toContain(t.name);
  expect(calendarTools.map((t) => t.name).sort()).toEqual(
    ["add_busy_block", "add_health_event", "get_calendar", "list_health_events", "plan_training_week", "remove_busy_block", "set_availability", "set_meal_times", "update_busy_block", "update_health_event", "update_planned_session"].sort(),
  );
});

test("tools record availability and health, and read them back", async () => {
  const added = await call("add_busy_block", { title: "Turno", date: "2031-05-05", weekdays: [1, 2], start: "08:00", end: "16:00" });
  expect(added.data.block).toMatchObject({ source: "coach", weekdays: [1, 2], allDay: false });
  expect(added.data.replan).toEqual({ moved: expect.any(Array), unresolved: expect.any(Array) });

  const calendar = await call("get_calendar", { from: "2031-05-05", to: "2031-05-11" });
  expect(calendar.data.items.filter((i: { kind: string }) => i.kind === "busy").map((i: { date: string }) => i.date)).toEqual(["2031-05-05", "2031-05-06"]);
  expect(calendar.data.busyBlocks.map((b: { id: string }) => b.id)).toContain(added.data.block.id);

  const flu = await call("add_health_event", { kind: "enfermedad", title: "Gripe", bodyArea: "general", severity: 3, startDate: "2025-05-01", endDate: "2025-05-04" });
  // An end date already past means it is over.
  expect(flu.data.event.status).toBe("resuelta");
  const history = await call("list_health_events", { from: "2025-05-03", to: "2025-05-03" });
  expect(history.data.map((e: { title: string }) => e.title)).toEqual(["Gripe"]);

  const prefs = await call("set_availability", { wakeTime: "06:30", trainingTimes: ["07:00", "19:00"] });
  expect(prefs.data.preferences).toMatchObject({ wakeTime: "06:30", trainingTimes: ["07:00", "19:00"], restDays: [7] });

  const meals = await call("set_meal_times", { mealTimes: [{ slot: "comida", time: "14:00" }] });
  expect(meals.data.preferences.mealTimes).toEqual([{ slot: "comida", time: "14:00" }]);

  expect((await call("add_busy_block", { title: "Mal", date: "2031-05-05", start: "10:00" })).text).toContain("needs start and end");
  expect((await call("update_planned_session", { id: "nope", status: "skipped" })).text).toContain("no planned session");
  expect((await call("remove_busy_block", { id: added.data.block.id })).data.removed.id).toBe(added.data.block.id);
});
