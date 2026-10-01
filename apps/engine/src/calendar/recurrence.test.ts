import { expect, test } from "bun:test";
import type { BusyBlock } from "@pulso/contract";
import { expand, occursOn } from "./recurrence";

const block = (over: Partial<BusyBlock>): BusyBlock => ({
  id: "b", title: "Trabajo", allDay: false, date: "2026-10-05", endDate: null, start: "09:00", end: "17:00", weekdays: [], until: null,
  source: "manual", notes: null, createdAt: 0, updatedAt: 0, ...over,
});

test("a one-off block happens on its date only", () => {
  expect(expand([block({})], "2026-10-01", "2026-10-31").map((o) => o.date)).toEqual(["2026-10-05"]);
  expect(expand([block({})], "2026-10-06", "2026-10-31")).toEqual([]);
});

test("a multi-day block covers every day of the trip, clipped to the range", () => {
  const trip = block({ allDay: true, start: null, end: null, date: "2026-10-08", endDate: "2026-10-12" });
  expect(expand([trip], "2026-10-10", "2026-10-31").map((o) => o.date)).toEqual(["2026-10-10", "2026-10-11", "2026-10-12"]);
});

test("weekly blocks repeat on their weekdays until `until`", () => {
  // Mondays and Wednesdays from 2026-10-05 to 2026-10-19.
  const weekly = block({ weekdays: [1, 3], until: "2026-10-19" });
  expect(expand([weekly], "2026-10-01", "2026-10-31").map((o) => o.date)).toEqual(["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14", "2026-10-19"]);
  expect(occursOn(weekly, "2026-10-21")).toBe(false);
  expect(occursOn(block({ weekdays: [7] }), "2027-03-07")).toBe(true);
});

test("occurrences are sorted by date then start", () => {
  const morning = block({ id: "m", start: "08:00", end: "09:00", weekdays: [1] });
  const allDay = block({ id: "a", allDay: true, start: null, end: null, date: "2026-10-05" });
  const out = expand([morning, allDay], "2026-10-05", "2026-10-12");
  expect(out.map((o) => `${o.blockId}@${o.date}`)).toEqual(["a@2026-10-05", "m@2026-10-05", "m@2026-10-12"]);
});
