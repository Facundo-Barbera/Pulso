import { expect, test } from "bun:test";
import { type EdbExercise, matchExercise, muscleGaps, rankCandidates, similarity } from "./exercisedb";
import { LIBRARY } from "./library";

const edb = (exerciseId: string, name: string, equipment: string, target: string[] = []): EdbExercise => ({
  exerciseId,
  name,
  equipments: [equipment],
  targetMuscles: target,
  secondaryMuscles: [],
});

// A slice of the real catalog's shape, near-misses included.
const CATALOG = [
  edb("b1", "barbell bench press", "barbell", ["pectorals"]),
  edb("b2", "barbell incline bench press", "barbell", ["pectorals"]),
  edb("b3", "dumbbell bench press", "dumbbell", ["pectorals"]),
  edb("b4", "barbell close-grip bench press", "barbell", ["triceps"]),
  edb("k1", "cable kickback", "cable", ["triceps"]),
  edb("k2", "cable standing hip extension", "cable", ["glutes"]),
  edb("c2", "chin-up", "bodyweight", ["latissimus dorsi"]),
  edb("c1", "chin-up", "bodyweight", ["latissimus dorsi"]),
  edb("p1", "band horizontal pallof press", "resistance band", ["abdominals"]),
  edb("s1", "Barbell Full Squat", "barbell", ["glutes"]),
];
const byId = (id: string) => LIBRARY.find((e) => e.id === id)!;
const matched = (id: string) => matchExercise(byId(id), CATALOG).candidate?.exerciseId ?? null;

test("similarity ignores case, accents and punctuation", () => {
  expect(similarity("Barbell Full Squat", "barbell full squat")).toBe(1);
  expect(similarity("chin-up", "chin up")).toBe(1);
  expect(similarity("barbell bench press", "barbell incline bench press")).toBeLessThan(1);
  expect(similarity("press", "")).toBe(0);
});

test("Spanish library exercises find their English counterpart, equipment included", () => {
  expect(matched("press-banca")).toBe("b1");
  expect(matched("press-inclinado-barra")).toBe("b2");
  expect(matched("press-banca-mancuernas")).toBe("b3");
  expect(matched("press-banca-cerrado")).toBe("b4");
  expect(matched("sentadilla")).toBe("s1");
});

test("the curated alias beats a closer-looking name on another muscle", () => {
  // "Patada de glúteo en polea" must not land on the triceps kickback.
  expect(matched("patada-gluteo-polea")).toBe("k2");
});

test("other equipment is a fallback, not a veto", () => {
  expect(matched("press-pallof")).toBe("p1");
  expect(matchExercise(byId("press-pallof"), CATALOG).score).toBeLessThan(1);
});

test("duplicate names rank by id, so every run proposes the same", () => {
  expect(rankCandidates(byId("dominadas-supinas"), CATALOG).map((m) => m.candidate.exerciseId)).toEqual(["c1", "c2"]);
});

test("nothing close enough means no media rather than a wrong one", () => {
  expect(matched("curl-martillo")).toBeNull();
  expect(matchExercise({ id: "not-in-library", equipment: "barbell" }, CATALOG).candidate).toBeNull();
});

test("muscle cross-check flags ExerciseDB targets missing from the curated map", () => {
  expect(muscleGaps("patada-gluteo-polea", CATALOG[4]!)).toEqual(["triceps"]);
  expect(muscleGaps("patada-gluteo-polea", CATALOG[5]!)).toEqual([]);
  // ExerciseDB credits the squat to the glutes; the curated map has them as primary too.
  expect(muscleGaps("sentadilla", CATALOG[9]!)).toEqual([]);
});
