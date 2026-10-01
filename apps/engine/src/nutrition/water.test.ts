import { expect, test } from "bun:test";
import { deleteWater, getWaterSettings, logWater, setWaterSettings, toMl, waterDay, waterGoal, waterTotals } from "./water";

// The DB is shared across tests in this process, so each test uses its own dates.

test("water adds up per day, oldest first, and undo removes one entry", () => {
  const first = logWater({ amountMl: 250, date: "2033-01-01", loggedAt: 2 });
  logWater({ amountMl: 500, date: "2033-01-01", loggedAt: 1 });
  logWater({ amountMl: 330, date: "2033-01-02", loggedAt: 3 });
  const day = waterDay("2033-01-01");
  expect(day.totalMl).toBe(750);
  expect(day.entries.map((e) => e.amountMl)).toEqual([500, 250]);
  expect(day.entries[0]?.source).toBe("manual");
  expect(deleteWater(first.id)).toBe(true);
  expect(deleteWater(first.id)).toBe(false);
  expect(waterDay("2033-01-01").totalMl).toBe(500);
  expect(waterTotals("2033-01-01", "2033-01-03")).toEqual({ "2033-01-01": 500, "2033-01-02": 330 });
});

test("logWater takes the day from the time when no date is given", () => {
  const entry = logWater({ amountMl: 200, loggedAt: new Date(2033, 1, 3, 23, 50).getTime() });
  expect(entry.date).toBe("2033-02-03");
});

test("the goal is the person's own, else 35 ml/kg rounded to 50 ml, else 2 L", () => {
  const auto = { goalMl: null, unit: "ml" as const, glassMl: 250, bottleMl: 500 };
  expect(waterGoal({ ...auto, goalMl: 3000 }, 80)).toEqual({ goalMl: 3000, goalSource: "custom" });
  expect(waterGoal(auto, 78.4)).toEqual({ goalMl: 2750, goalSource: "weight" });
  expect(waterGoal(auto, null)).toEqual({ goalMl: 2000, goalSource: "default" });
});

test("settings merge, and a null goal goes back to automatic", () => {
  expect(getWaterSettings()).toMatchObject({ unit: "vaso", glassMl: 250, bottleMl: 500, goalMl: null });
  setWaterSettings({ glassMl: 300, goalMl: 2500 });
  expect(setWaterSettings({ unit: "botella" })).toEqual({ goalMl: 2500, unit: "botella", glassMl: 300, bottleMl: 500 });
  expect(waterDay("2033-03-01")).toMatchObject({ goalMl: 2500, goalSource: "custom" });
  expect(setWaterSettings({ goalMl: null }).goalMl).toBeNull();
  expect(waterDay("2033-03-01").goalSource).not.toBe("custom");
  setWaterSettings({ unit: "vaso", glassMl: 250 });
});

test("units convert with the person's glass and bottle sizes", () => {
  const settings = { goalMl: null, unit: "vaso" as const, glassMl: 300, bottleMl: 750 };
  expect(toMl(2, "vaso", settings)).toBe(600);
  expect(toMl(1, "botella", settings)).toBe(750);
  expect(toMl(1.5, "l", settings)).toBe(1500);
  expect(toMl(330, "ml", settings)).toBe(330);
});
