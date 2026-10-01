import { expect, test } from "bun:test";
import { addDays, night } from "../sleep/fixtures";
import { setSleepTargetMin, upsertSleepSegments } from "../sleep/store";
import { sleepPage, TREND_NIGHTS } from "./sleep";
import { ownDatabase } from "./test-db";

ownDatabase("web-sleep");

const first = "2032-05-01";

test("with no sleep the page has no night and an empty trend", () => {
  const page = sleepPage();
  expect(page.night).toBeNull();
  expect(page.trend).toEqual([]);
  expect(page.summary.nights).toBe(0);
});

test("the newest night is shown by default, with a dense trend that leaves gaps as null", () => {
  // Five nights, skipping the third.
  const nights = [0, 1, 3, 4, 5].map((i) => addDays(first, i));
  upsertSleepSegments(nights.flatMap((d) => night(d)));
  setSleepTargetMin(450);

  const page = sleepPage();
  expect(page.night?.night).toBe(addDays(first, 5));
  expect(page.newer).toBeNull();
  expect(page.older).toBe(addDays(first, 4));
  expect(page.targetMin).toBe(450);
  expect(page.trend).toHaveLength(TREND_NIGHTS);
  expect(page.trend.at(-1)).toMatchObject({ night: addDays(first, 5), asleepMin: 270 + 80 + 110 });
  expect(page.trend.find((p) => p.night === addDays(first, 2))).toEqual({ night: addDays(first, 2), asleepMin: null, score: null });
});

test("asking for a night shows it, with its neighbours; an unknown one falls back to the newest", () => {
  const page = sleepPage(addDays(first, 3));
  expect(page.night?.night).toBe(addDays(first, 3));
  expect(page.newer).toBe(addDays(first, 4));
  expect(page.older).toBe(addDays(first, 1));
  expect(sleepPage("1999-01-01").night?.night).toBe(addDays(first, 5));
});
