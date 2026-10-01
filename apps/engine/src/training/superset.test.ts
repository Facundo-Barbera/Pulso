import { expect, test } from "bun:test";
import type { ExerciseKind } from "@pulso/contract";
import { supersetIds, withSupersets } from "./superset";

const list = (...ids: (string | null | undefined | ["cardio", string | null])[]) =>
  ids.map((id) => (Array.isArray(id) ? { kind: "cardio" as ExerciseKind, supersetId: id[1] } : { kind: "compound" as ExerciseKind, supersetId: id }));

test("consecutive members with the same id form a superset", () => {
  expect(supersetIds(list("a", "a", null, "b", "b", "b"))).toEqual(["a", "a", null, "b", "b", "b"]);
  expect(supersetIds(list(undefined, "x", "x"))).toEqual([null, "x", "x"]);
  expect(supersetIds([])).toEqual([]);
});

test("a lone member, a blank id and cardio are cleared", () => {
  expect(supersetIds(list("a", null, "b", "b"))).toEqual([null, null, "b", "b"]);
  expect(supersetIds(list("  ", "  "))).toEqual([null, null]);
  expect(supersetIds(list(" a ", "a"))).toEqual(["a", "a"]);
  // Cardio can't be in one; its partner is left alone, so it goes too.
  expect(supersetIds(list("a", ["cardio", "a"]))).toEqual([null, null]);
  expect(supersetIds(list("a", "a", ["cardio", "a"]))).toEqual(["a", "a", null]);
});

test("a group split apart keeps only its first adjacent run", () => {
  expect(supersetIds(list("a", null, "a"))).toEqual([null, null, null]);
  expect(supersetIds(list("a", "a", null, "a", "a"))).toEqual(["a", "a", null, null, null]);
  // The first run of two or more wins, even after a lone member.
  expect(supersetIds(list("a", null, "a", "a"))).toEqual([null, null, "a", "a"]);
});

test("withSupersets returns copies with the normalized ids", () => {
  const input = list("a", null);
  const out = withSupersets(input);
  expect(out.map((e) => e.supersetId)).toEqual([null, null]);
  expect(input[0]!.supersetId).toBe("a");
});
