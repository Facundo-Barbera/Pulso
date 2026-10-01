import { describe, expect, test } from "bun:test";
import type { HealthEvent } from "@pulso/contract";
import { conflictOf, dayBlock, findSlot, freeTime, injuryImpact, planWeek, type Context, type PlanDay } from "./planner";
import { expand, type Occurrence } from "./recurrence";
import { DEFAULT_PREFERENCES } from "./store";

// 2026-10-05 is a Monday.
const MON = "2026-10-05";

const ctx = (over: Partial<Context> = {}): Context => ({
  busy: [],
  health: [],
  prefs: { ...DEFAULT_PREFERENCES, trainingTimes: ["18:00"] },
  today: MON,
  now: "08:00",
  ...over,
});

const busy = (date: string, start: string | null, end: string | null, title = "Reunión"): Occurrence => ({
  blockId: `b-${date}-${start}`, title, date, allDay: start === null, start, end, source: "manual",
});

const health = (over: Partial<HealthEvent>): HealthEvent => ({
  id: "h1", kind: "lesion", title: "Esguince", bodyArea: "knee", severity: 2, startDate: "2026-10-01", endDate: null, status: "activa",
  notes: null, affectedTraining: null, createdAt: 0, updatedAt: 0, ...over,
});

const day = (id: string, muscles: PlanDay["exercises"][number]["muscles"] = ["chest"], weekday: number | null = null): PlanDay => ({
  id, name: `Día ${id}`, weekday, exercises: [{ name: muscles.includes("quads") ? "Sentadilla" : "Press banca", muscles }],
});

const SUN = "2026-10-11";

describe("planWeek", () => {
  test("spreads three days without back-to-back sessions, in program order", () => {
    const plan = planWeek({ from: MON, to: SUN, days: [day("A"), day("B"), day("C")], duration: 60, ctx: ctx() });
    expect(plan.placements.map((p) => [p.dayId, p.date, p.time])).toEqual([
      ["A", "2026-10-05", "18:00"],
      ["B", "2026-10-07", "18:00"],
      ["C", "2026-10-09", "18:00"],
    ]);
    expect(plan.unplaced).toEqual([]);
  });

  test("skips rest days and all-day busy blocks, and moves around timed ones", () => {
    const c = ctx({
      prefs: { ...DEFAULT_PREFERENCES, trainingTimes: ["18:00"], restDays: [1] },
      busy: [busy("2026-10-06", null, null, "Viaje"), busy("2026-10-07", "17:30", "19:00")],
    });
    const plan = planWeek({ from: MON, to: SUN, days: [day("A"), day("B")], duration: 60, ctx: c });
    expect(plan.placements[0]).toMatchObject({ dayId: "A", date: "2026-10-07" });
    // 18:00 clashes; the nearest free half hour after it is taken instead.
    expect(plan.placements[0]!.time).toBe("19:00");
    expect(plan.placements[1]).toMatchObject({ dayId: "B", date: "2026-10-09", time: "18:00" });
  });

  test("a pinned day stays on its weekday", () => {
    const plan = planWeek({ from: MON, to: SUN, days: [day("A", ["chest"], 3), day("B")], duration: 60, ctx: ctx() });
    expect(plan.placements.find((p) => p.dayId === "A")?.date).toBe("2026-10-07");
    expect(plan.placements.find((p) => p.dayId === "B")?.date).toBe("2026-10-05");
  });

  test("never plans in the past or before now today", () => {
    const plan = planWeek({ from: MON, to: SUN, days: [day("A")], duration: 60, ctx: ctx({ today: "2026-10-08", now: "18:30" }) });
    expect(plan.placements[0]).toMatchObject({ date: "2026-10-08", time: "18:30" });
  });

  test("an active illness takes days out; a severe injury keeps the days it loads off the plan", () => {
    const c = ctx({
      health: [
        health({ id: "flu", kind: "enfermedad", title: "Gripe", bodyArea: "general", severity: 3, startDate: "2026-10-04", endDate: "2026-10-07" }),
        health({ id: "knee", severity: 4 }),
      ],
    });
    const plan = planWeek({ from: MON, to: SUN, days: [day("Pierna", ["quads", "glutes"]), day("Torso")], duration: 60, ctx: c });
    expect(plan.placements).toEqual([{ dayId: "Torso", name: "Día Torso", date: "2026-10-08", time: "18:00" }]);
    expect(plan.unplaced).toEqual([{ dayId: "Pierna", name: "Día Pierna", reason: "Esguince (rodilla, 4/5) afecta Sentadilla" }]);
  });

  test("a mild injury places the day with a warning", () => {
    const plan = planWeek({ from: MON, to: SUN, days: [day("Pierna", ["quads"])], duration: 60, ctx: ctx({ health: [health({ severity: 2 })] }) });
    expect(plan.placements).toHaveLength(1);
    expect(plan.warnings[0]!.message).toContain("Sentadilla");
  });

  test("reports what does not fit", () => {
    const allBusy = expand([{ id: "x", title: "Viaje", allDay: true, date: MON, endDate: SUN, start: null, end: null, weekdays: [], until: null, source: "manual" }], MON, SUN);
    const plan = planWeek({ from: MON, to: SUN, days: [day("A")], duration: 60, ctx: ctx({ busy: allBusy }) });
    expect(plan.placements).toEqual([]);
    expect(plan.unplaced[0]!.reason).toContain("No queda un día libre");
  });
});

describe("slots and conflicts", () => {
  test("freeTime respects wake and sleep, staying close to the wanted time", () => {
    const c = ctx({ prefs: { ...DEFAULT_PREFERENCES, trainingTimes: ["22:30"], wakeTime: "06:00", sleepTime: "22:00" } });
    expect(freeTime("2026-10-06", 60, c)).toBe("21:00");
    expect(freeTime("2026-10-06", 60, ctx({ prefs: { ...DEFAULT_PREFERENCES, wakeTime: "06:00" } }))).toBe("06:30");
    expect(freeTime("2026-10-06", 60, c, "20:00")).toBe("20:00");
  });

  test("resolved and recovering events don't block", () => {
    const c = ctx({ health: [health({ kind: "enfermedad", bodyArea: "general", severity: 5, status: "recuperandose" })] });
    expect(dayBlock(MON, c)).toBeNull();
    expect(injuryImpact(day("A", ["chest"]), MON, [health({ status: "resuelta", endDate: "2026-10-02", severity: 5, bodyArea: "chest" })]).severe).toBeNull();
  });

  test("conflictOf names the clash and whether moving helps", () => {
    const c = ctx({ busy: [busy("2026-10-06", "18:30", "20:00", "Cena de trabajo")] });
    expect(conflictOf({ date: "2026-10-06", time: "18:00", durationMin: 60 }, undefined, c)).toEqual({ reason: "Choca con Cena de trabajo (18:30–20:00)", movable: true });
    expect(conflictOf({ date: "2026-10-06", time: "08:00", durationMin: 60 }, undefined, c)).toBeNull();
    const injured = ctx({ health: [health({ severity: 5 })] });
    expect(conflictOf({ date: "2026-10-06", time: "18:00", durationMin: 60 }, day("P", ["quads"]), injured)?.movable).toBe(false);
  });

  test("findSlot tries the same day first, then the nearest free day", () => {
    const sameDay = ctx({ busy: [busy("2026-10-06", "18:00", "19:00")] });
    expect(findSlot({ date: "2026-10-06", time: "18:00", durationMin: 60 }, sameDay, new Set())).toEqual({ date: "2026-10-06", time: "17:00" });

    const away = ctx({ busy: [busy("2026-10-06", null, null, "Viaje")] });
    expect(findSlot({ date: "2026-10-06", time: "18:00", durationMin: 60 }, away, new Set(["2026-10-07"]))).toEqual({ date: "2026-10-05", time: "18:00" });
  });
});
