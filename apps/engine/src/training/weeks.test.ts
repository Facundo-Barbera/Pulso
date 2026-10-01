import { describe, expect, test } from "bun:test";
import type { ProgramInput, SessionInput } from "@pulso/contract";
import { db } from "../db";
import { ownDatabase } from "../web/test-db";
import { migrateTraining } from "./schema";
import { activeProgramView, createProgram, getProgram, nextDay, resumeBlock, saveSession, startNextWeek, suggestLoad, trainingBlocks, TrainingError } from "./store";
import { isDeload, mondayOf, programWeeks, weekBounds } from "./weeks";

ownDatabase("weeks");

// Local times: weeks follow the Mac's clock. 28 Sep 2026 is a Monday.
const at = (day: number, hour = 18) => new Date(2026, 8, 28 + day, hour).getTime();
const MON = at(0);
const THU = at(3);
const NEXT_MON = at(7);
const DAY = 86_400_000;

const ex = (exerciseId: string, sets: number) => ({ exerciseId, sets, repMin: 6, repMax: 10, restSeconds: 120 });
const input = (overrides: Partial<ProgramInput> = {}): ProgramInput => ({
  name: "Torso / Pierna",
  goal: "Hipertrofia",
  weeks: 6,
  notes: "Progresión doble. Semana 4 de descarga: mitad de series.",
  days: [
    { name: "Torso A", exercises: [ex("press-banca", 4), ex("remo-polea-baja", 4)] },
    { name: "Pierna A", exercises: [ex("sentadilla-hack", 4)] },
    { name: "Torso B", exercises: [ex("press-militar", 3)] },
    { name: "Pierna B", exercises: [ex("peso-muerto-rumano", 3)] },
  ],
  ...overrides,
});

let n = 0;
/** A session of `dayId` at `startedAt` with `count` sets of press-banca (or the day's first exercise). */
function trained(dayId: string, startedAt: number, count = 8, exerciseId = "press-banca"): SessionInput {
  const session: SessionInput = {
    id: `w-${++n}`,
    dayId,
    name: "Sesión",
    startedAt,
    endedAt: startedAt + 41 * 60_000,
    sets: Array.from({ length: count }, (_, i) => ({ exerciseId, setIndex: i, weightKg: 60, reps: 8, rpe: null, doneAt: startedAt + i })),
  };
  saveSession(session);
  return session;
}

describe("weekBounds", () => {
  test("weeks are calendar weeks from the anchor's Monday", () => {
    const [w1, w2] = weekBounds(6, THU);
    expect(w1!.startsAt).toBe(mondayOf(THU));
    expect(new Date(w1!.startsAt).getDay()).toBe(1);
    expect(w1!.endsAt).toBe(w2!.startsAt);
    expect(new Date(w2!.startsAt).getDate()).toBe(5);
  });

  test("a week begun early runs to the end of the next calendar week, then Mondays again", () => {
    const early = at(3, 20);
    const [w1, w2, w3] = weekBounds(6, MON, new Map([[2, early]]));
    expect(w1!.endsAt).toBe(early);
    expect(w2).toMatchObject({ startsAt: early, startedEarly: true });
    expect(w2!.endsAt).toBe(mondayOf(at(14)));
    expect(w3!.startsAt).toBe(mondayOf(at(14)));
    expect(w3!.startedEarly).toBe(false);
  });
});

describe("programWeeks", () => {
  test("a day done this week is done and locked; the next one is Siguiente", () => {
    const p = createProgram(input(), true, MON - DAY);
    const [a, b] = p.days;
    trained(a!.id, THU);
    const block = programWeeks(p, THU + 3_600_000);
    expect(block.currentWeek).toBe(1);
    expect(block.weeks).toHaveLength(6);
    const week = block.weeks[0]!;
    expect(week.state).toBe("current");
    expect(week.done).toBe(1);
    expect(week.days.map((d) => d.status)).toEqual(["done", "planned", "planned", "planned"]);
    expect(week.days[0]!.sessions[0]).toMatchObject({ sets: 8, endedAt: THU + 41 * 60_000 });
    expect(nextDay(p, THU + 3_600_000)?.id).toBe(b!.id);
    expect(block.weeks[1]!.state).toBe("future");
    expect(block.weeks[3]).toMatchObject({ deload: true, note: "Semana 4 de descarga: mitad de series." });
  });

  test("week 1 is the week of the first session, not of the day the program was written", () => {
    const p = createProgram(input(), true, at(-1, 21)); // Sunday night
    trained(p.days[0]!.id, MON);
    const block = programWeeks(p, MON + DAY);
    expect(block.currentWeek).toBe(1);
    expect(block.weeks[0]!.startsAt).toBe(mondayOf(MON));
  });

  test("past weeks show missed days, and a session with under ¾ of the sets as partial", () => {
    const p = createProgram(input(), true, MON);
    const [a, b] = p.days;
    trained(a!.id, MON, 8);
    trained(b!.id, THU, 2); // 2 of 4 sets
    const block = programWeeks(p, NEXT_MON + 3_600_000);
    expect(block.currentWeek).toBe(2);
    expect(block.weeks[0]!.days.map((d) => d.status)).toEqual(["done", "partial", "missed", "missed"]);
    expect(block.weeks[1]!.days.every((d) => d.status === "planned")).toBe(true);
  });

  test("a new week starts again from the first day", () => {
    const p = createProgram(input(), true, MON);
    const [a, b] = p.days;
    trained(a!.id, MON);
    trained(b!.id, THU);
    expect(nextDay(p, THU + 3_600_000)?.name).toBe("Torso B");
    expect(nextDay(p, NEXT_MON + 3_600_000)?.id).toBe(a!.id);
  });

  test("repeating a day keeps it done and doesn't move the next day", () => {
    const p = createProgram(input(), true, MON);
    const [a] = p.days;
    trained(a!.id, MON);
    trained(a!.id, THU);
    const week = programWeeks(p, THU + 3_600_000).weeks[0]!;
    expect(week.days[0]!.sessions).toHaveLength(2);
    expect(week.done).toBe(1);
    expect(nextDay(p, THU + 3_600_000)?.name).toBe("Pierna A");
  });

  test("a complete week has no next day until it starts the next week early", () => {
    const p = createProgram(input(), true, MON);
    p.days.forEach((d, i) => trained(d.id, at(i)));
    const now = at(3, 21);
    const view = activeProgramView(now);
    const block = view.blocks!.at(-1)!;
    expect(block).toMatchObject({ weekComplete: true, canStartNextWeek: true, currentWeek: 1 });
    expect(view.nextDayId).toBeNull();

    const started = startNextWeek(now).blocks!.at(-1)!;
    expect(started.currentWeek).toBe(2);
    expect(started.weekComplete).toBe(false);
    expect(started.weeks[0]!.endsAt).toBe(now);
    expect(started.weeks[1]).toMatchObject({ startsAt: now, startedEarly: true, state: "current" });
    expect(started.weeks[1]!.endsAt).toBe(mondayOf(at(14)));
    expect(started.weeks[0]!.done).toBe(4);
    expect(activeProgramView(now + 1000).nextDayId).toBe(p.days[0]!.id);
  });

  test("the next week can't start early with days left, nor past the last week", () => {
    const p = createProgram(input({ weeks: 1 }), true, MON);
    trained(p.days[0]!.id, MON);
    expect(() => startNextWeek(THU)).toThrow(TrainingError);
    p.days.slice(1).forEach((d, i) => trained(d.id, at(i + 1)));
    const block = programWeeks(p, THU + 3_600_000);
    expect(block).toMatchObject({ weekComplete: true, canStartNextWeek: false });
    expect(() => startNextWeek(THU + 3_600_000)).toThrow("last week");
  });

  test("past the last week the program is finished and rotates as before", () => {
    const p = createProgram(input({ weeks: 1 }), true, MON);
    trained(p.days[0]!.id, MON);
    const block = programWeeks(p, NEXT_MON + DAY);
    expect(block).toMatchObject({ finished: true, currentWeek: 1, weekComplete: false });
    expect(block.weeks[0]!.state).toBe("past");
    expect(nextDay(p, NEXT_MON + DAY)?.name).toBe("Pierna A");
  });
});

/** Blocks are ordered by creation; the tests above wrote programs with made-up dates. */
const fresh = () => db().run("DELETE FROM programs; DELETE FROM training_sessions;");

describe("blocks", () => {
  test("switching program ends the block, keeps its weeks and this week's sessions, and history carries over", () => {
    fresh();
    const first = createProgram(input(), true, MON - DAY);
    trained(first.days[0]!.id, MON, 8);
    const second = createProgram(
      input({ name: "CrossFit", reason: "Cambio a CrossFit", days: [{ name: "WOD", exercises: [ex("press-banca", 3), ex("sentadilla-hack", 3)] }] }),
      true,
      at(2),
    );
    const blocks = trainingBlocks(THU);
    const [old, current] = blocks.slice(-2);
    expect(old).toMatchObject({ programId: first.id, active: false, endedAt: at(2), endReason: "Cambio a CrossFit" });
    expect(old!.weeks).toHaveLength(1);
    expect(old!.weeks[0]!.days[0]!.status).toBe("done");
    expect(current).toMatchObject({ programId: second.id, active: true, number: old!.number + 1, currentWeek: 1 });
    // Monday's Torso A still counts this week.
    expect(current!.weeks[0]!.other.map((s) => s.dayId)).toEqual([first.days[0]!.id]);
    // Suggestions are per exercise: press-banca goes on from Monday's sets.
    expect(suggestLoad("press-banca", { sets: 3, repMin: 6, repMax: 10 }).lastSessionAt).toBe(MON);
    expect(getProgram(first.id)?.days).toHaveLength(4);
  });

  test("Retomar starts a new block from an earlier one's days", () => {
    fresh();
    const first = createProgram(input({ name: "Fuerza" }), true, MON);
    createProgram(input({ name: "Otro" }), true, at(1));
    const view = resumeBlock(first.id, at(2));
    const last = view.blocks!.at(-1)!;
    expect(last).toMatchObject({ name: "Fuerza", resumedFrom: first.id, active: true, currentWeek: 1 });
    expect(view.blocks!.at(-2)).toMatchObject({ name: "Otro", endReason: "Retomas Fuerza" });
    expect(view.program?.days.map((d) => d.name)).toEqual(first.days.map((d) => d.name));
    expect(() => resumeBlock(view.program!.id, at(2))).toThrow(TrainingError);
  });

  test("the migration makes a program replaced before blocks an ended block, once", () => {
    const old = createProgram(input({ name: "Antiguo" }), true, at(-30));
    trained(old.days[0]!.id, at(-29));
    const next = createProgram(input({ name: "Nuevo" }), true, at(-20));
    db().run("UPDATE programs SET ended_at = NULL, end_reason = NULL WHERE id = ?", [old.id]);
    migrateTraining(db());
    migrateTraining(db());
    const row = db().query<{ ended_at: number }, [string]>("SELECT ended_at FROM programs WHERE id = ?").get(old.id);
    expect(row?.ended_at).toBe(next.createdAt);
  });
});

test("isDeload reads the notes", () => {
  expect(isDeload(4, 8, "Descarga cada 4 semanas.")).toBe(true);
  expect(isDeload(3, 8, "Descarga cada 4 semanas.")).toBe(false);
  expect(isDeload(6, 6, "Progresión doble. Última semana: descarga")).toBe(true);
  expect(isDeload(6, 8, null)).toBe(false);
});
