import { describe, expect, test } from "bun:test";
import { formatBoth, formatWeight, fromUnit, KG_PER_LB, shown, snap, snapKg, stepDown, stepUp, toUnit } from "./units";

describe("conversion", () => {
  test("a pound entry is stored as its exact kg", () => {
    expect(fromUnit(45, "lb")).toBeCloseTo(20.41165665, 8);
    expect(fromUnit(45, "kg")).toBe(45);
    expect(toUnit(KG_PER_LB, "lb")).toBe(1);
  });

  test("round trip is stable: typed in one unit, it reads the same after any number of switches", () => {
    for (const lb of [2.5, 22.5, 45, 47.5, 70, 135, 225, 405]) {
      let kg = fromUnit(lb, "lb");
      for (let i = 0; i < 5; i++) kg = snapKg(snapKg(kg, "lb"), "lb");
      expect(snap(kg, "lb")).toBe(lb);
      expect(shown(kg, "lb")).toBe(lb);
    }
    for (const kg of [1, 9, 14, 20, 32.5, 61.25, 100]) {
      expect(snap(fromUnit(kg, "kg"), "kg")).toBe(kg);
      // Shown in pounds and back, nothing moves: the stored kg is never rewritten by a view.
      expect(shown(kg, "kg")).toBe(kg);
    }
  });
});

describe("snap to the equipment's steps", () => {
  test("kg from the other unit goes to 5 lb plates, 2.5 lb under 25 lb", () => {
    expect(snap(20, "lb")).toBe(45); // 44.09 lb
    expect(snap(100, "lb")).toBe(220); // 220.46 lb
    expect(snap(10, "lb")).toBe(22.5); // 22.05 lb
    expect(snap(31.75, "lb")).toBe(70); // 69.996 lb
  });

  test("lb from the other unit goes to 2.5 kg, 1 kg up to 10 kg", () => {
    expect(snap(fromUnit(45, "lb"), "kg")).toBe(20); // 20.41 kg
    expect(snap(fromUnit(70, "lb"), "kg")).toBe(32.5); // 31.75 kg
    expect(snap(fromUnit(15, "lb"), "kg")).toBe(7); // 6.80 kg
  });

  test("a weight already real in the unit stays, even off the coarse step", () => {
    expect(snap(14, "kg")).toBe(14);
    expect(snap(fromUnit(47.5, "lb"), "lb")).toBe(47.5);
    expect(snap(-1, "kg")).toBe(0);
  });
});

describe("steppers", () => {
  test("pounds: 5 lb, 2.5 lb at 25 lb and under", () => {
    expect(stepUp(45, "lb")).toBe(50);
    expect(stepUp(47, "lb")).toBe(50);
    expect(stepUp(22.5, "lb")).toBe(25);
    expect(stepUp(25, "lb")).toBe(30);
    expect(stepDown(30, "lb")).toBe(25);
    expect(stepDown(25, "lb")).toBe(22.5);
    expect(stepDown(27, "lb")).toBe(25);
    expect(stepDown(2.5, "lb")).toBe(0);
    expect(stepDown(0, "lb")).toBe(0);
  });

  test("kilos: 2.5 kg, 1 kg at 10 kg and under", () => {
    expect(stepUp(9, "kg")).toBe(10);
    expect(stepUp(10, "kg")).toBe(12.5);
    expect(stepUp(14, "kg")).toBe(15);
    expect(stepDown(12.5, "kg")).toBe(10);
    expect(stepDown(10, "kg")).toBe(9);
    expect(stepDown(11, "kg")).toBe(10);
  });

  test("float noise from a conversion doesn't skip a step", () => {
    expect(stepUp(toUnit(fromUnit(45, "lb"), "lb"), "lb")).toBe(50);
    expect(stepDown(toUnit(fromUnit(45, "lb"), "lb"), "lb")).toBe(40);
  });
});

test("formatting, in Spanish, with the other unit second", () => {
  expect(formatWeight(fromUnit(45, "lb"), "lb")).toBe("45 lb");
  expect(formatWeight(fromUnit(45, "lb"), "kg")).toBe("20,4 kg");
  expect(formatBoth(fromUnit(100, "lb"), "lb")).toBe("100 lb · 45,4 kg");
});
