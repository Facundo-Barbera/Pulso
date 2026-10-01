import { expect, test } from "bun:test";
import { parseTime } from "./dates";

test("parseTime reads clock times on a day and ISO date-times", () => {
  expect(parseTime("14:30", "2030-05-04")).toEqual({ at: new Date(2030, 4, 4, 14, 30).getTime(), date: "2030-05-04" });
  expect(parseTime("8.05", "2030-05-04")?.at).toBe(new Date(2030, 4, 4, 8, 5).getTime());
  expect(parseTime("21h15", "2030-05-04")?.at).toBe(new Date(2030, 4, 4, 21, 15).getTime());
  expect(parseTime("2030-05-04T23:10")).toEqual({ at: new Date(2030, 4, 4, 23, 10).getTime(), date: "2030-05-04" });
  expect(parseTime("2030-05-04T10:00:00Z")?.at).toBe(Date.UTC(2030, 4, 4, 10));
});

test("parseTime rejects what it can't read", () => {
  for (const bad of ["25:00", "12:75", "mediodía", "2030-05-04", ""]) expect(parseTime(bad)).toBeNull();
});
