import { beforeEach, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { DELETE as mobileDelete } from "@/app/api/mobile/sleep/manual/[id]/route";
import { POST as mobilePost } from "@/app/api/mobile/sleep/manual/route";
import { DELETE as webDelete, PATCH as webPatch } from "@/app/api/web/sueno/noches/[id]/route";
import { POST as webPost } from "@/app/api/web/sueno/noches/route";
import { summarizeAction } from "../agent/actions";
import { newTurnState, rememberBefore, translate } from "../agent/events";
import { addMessage, createThread, updateMessage } from "../agent/threads";
import { undoToolAction } from "../agent/undo";
import { dueBriefs } from "../coach/periods";
import { addDays, localDate } from "../daily/dates";
import { listDailyMetrics, readinessFor, upsertDailyMetrics } from "../daily/store";
import { db } from "../db";
import { accessOf } from "../mcp/access";
import { ownDatabase } from "../web/test-db";
import { todayOverview } from "../web/today";
import { atLocal, lastBefore, resolveNight, wakeAt } from "./clock";
import { addManualNight, deleteManualNight, getManualNight, listManualNights, manualNightOn, restoreManualNight, SleepError, updateManualNight } from "./manual";
import { latestNight, listSleepNights, sleepSummary, upsertSleepSegments } from "./store";
import { sleepTools } from "./tools";

ownDatabase("sleep-manual");

beforeEach(() => {
  db().exec("DELETE FROM sleep_manual; DELETE FROM sleep_segments; DELETE FROM daily_metrics; DELETE FROM agent_threads;");
});

/** A night that went to bed at `bed` on the day before `wake`, both local HH:MM. */
const span = (wakeDate: string, bed: string, wake: string) => ({ start: atLocal(addDays(wakeDate, -1), bed), end: atLocal(wakeDate, wake) });
const NOW = atLocal("2026-03-10", "12:00");
const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof SleepError ? error.code : String(error);
  }
  return "ok";
};
const tz = (ms: number) => -new Date(ms).getTimezoneOffset();

test("a night is named after the morning of waking, like Health's", () => {
  const n = addManualNight({ ...span("2026-03-10", "23:30", "07:00"), note: "  sin   reloj " }, NOW);
  expect(n.night).toBe("2026-03-10");
  expect(n.note).toBe("sin reloj");
  expect(n.hidden).toBe(false);
  // Falling asleep after midnight is still that same night.
  expect(addManualNight({ start: atLocal("2026-03-09", "01:15"), end: atLocal("2026-03-09", "08:00") }, NOW).night).toBe("2026-03-09");
});

test("validation: end after start, 1–16 h, not in the future, one per night", () => {
  const ok = span("2026-03-10", "23:30", "07:00");
  expect(code(() => addManualNight({ start: ok.end, end: ok.start }, NOW))).toBe("invalid");
  expect(code(() => addManualNight({ start: ok.end - 50 * 60_000, end: ok.end }, NOW))).toBe("invalid");
  expect(code(() => addManualNight({ start: ok.end - 17 * 3_600_000, end: ok.end }, NOW))).toBe("invalid");
  expect(code(() => addManualNight(ok, ok.end - 3_600_000))).toBe("invalid");
  // A couple of minutes ahead of the clock is "just now".
  expect(code(() => addManualNight(ok, ok.end - 2 * 60_000))).toBe("ok");
  expect(code(() => addManualNight(span("2026-03-10", "22:00", "06:00"), NOW))).toBe("taken");
});

test("a manual night counts as a night: Sueño, summary, latest night, no efficiency factor", () => {
  const n = addManualNight(span("2026-03-10", "23:30", "07:00"), NOW);
  const [night] = listSleepNights("2026-03-10", "2026-03-10");
  expect(night).toMatchObject({ night: "2026-03-10", sourceKind: "manual", source: "Registrada a mano", manual: { id: n.id, note: null }, stagePct: null });
  expect(night!.minutes.asleep).toBe(450);
  expect(night!.bedtimeMin).toBe(-30);
  expect(night!.score.factors.map((f) => f.key)).not.toContain("efficiency");
  expect(latestNight()).toBe("2026-03-10");
  expect(sleepSummary(7)).toMatchObject({ nights: 1, avgAsleepMin: 450, avgEfficiency: null });
});

test("measured wins: no manual night over a measured one, and one that arrives later hides it", () => {
  const measured = span("2026-03-08", "23:00", "07:00");
  const segment = (s: { start: number; end: number }) => ({ ...s, stage: "core" as const, source: "Apple Watch", sourceKind: "watch" as const, tzOffsetMin: tz(s.start) });
  upsertSleepSegments([segment(measured)]);
  expect(code(() => addManualNight(span("2026-03-08", "22:00", "06:00"), NOW))).toBe("measured");

  // Logged by hand first, then the watch's night syncs late.
  const manual = addManualNight(span("2026-03-10", "23:30", "07:00"), NOW);
  upsertSleepSegments([segment({ start: atLocal("2026-03-10", "00:10"), end: atLocal("2026-03-10", "06:40") })]);
  const [night] = listSleepNights("2026-03-10", "2026-03-10");
  expect(night!.sourceKind).toBe("watch");
  expect(night!.manual).toBeUndefined();
  expect(getManualNight(manual.id).hidden).toBe(true);
  expect(listDailyMetrics("2026-03-10", "2026-03-10")).toEqual([]);
  // It can't be kept on a measured night, but it can be deleted.
  expect(code(() => updateManualNight(manual.id, { note: "x" }, NOW))).toBe("measured");
  deleteManualNight(manual.id);
  expect(listManualNights("2026-03-01", "2026-03-31")).toEqual([]);
});

test("edit, delete and restore a manual night", () => {
  const n = addManualNight(span("2026-03-10", "23:30", "07:00"), NOW);
  const moved = updateManualNight(n.id, { end: atLocal("2026-03-10", "08:15"), note: "me quedé dormido" }, NOW);
  expect(moved).toMatchObject({ night: "2026-03-10", start: n.start, note: "me quedé dormido" });
  expect(updateManualNight(n.id, { note: null }, NOW).note).toBeNull();
  const gone = deleteManualNight(n.id);
  expect(manualNightOn("2026-03-10")).toBeUndefined();
  expect(code(() => getManualNight(n.id))).toBe("not_found");
  expect(restoreManualNight(gone).id).toBe(n.id);
});

test("readiness, the daily rows, Hoy and the morning brief count a manual night", () => {
  const today = localDate();
  const end = Date.now() - 60_000;
  addManualNight({ start: end - 6 * 3_600_000, end });
  // No daily row yet for today: one appears, flagged.
  const [day] = listDailyMetrics(today, today);
  expect(day).toMatchObject({ date: today, sleepMinutes: 360, sleepManual: true, steps: null });
  const sleep = readinessFor(today).factors.find((f) => f.key === "sleep")!;
  expect(sleep.value).toBe(360);
  expect(sleep.score).toBe(60);
  // A synced day without sleep keeps its numbers and gets the night.
  const blank = { steps: null, activeEnergy: null, exerciseMinutes: null, restingHeartRate: null, hrv: null, sleepMinutes: null, sleepDeep: null, sleepCore: null, sleepRem: null, sleepAwake: null, vo2max: null, respiratoryRate: null, restingHeartRateEstimated: false, exerciseMinutesEstimated: false };
  upsertDailyMetrics([{ ...blank, date: today, steps: 4000 }]);
  expect(listDailyMetrics(today, today)[0]).toMatchObject({ steps: 4000, sleepMinutes: 360, sleepManual: true });
  // Health's own sum for the day wins over the manual night.
  upsertDailyMetrics([{ ...blank, date: today, sleepMinutes: 400 }]);
  expect(listDailyMetrics(today, today)[0]!.sleepManual).toBeUndefined();
  db().exec("DELETE FROM daily_metrics");

  const overview = todayOverview();
  expect(overview.lastNight?.sourceKind).toBe("manual");
  expect(overview.trend.at(-1)!.sleepMin).toBe(360);
  // The morning brief stops waiting once last night is in.
  expect(latestNight()).toBe(today);
  const eight = new Date();
  eight.setHours(8, 0, 0, 0);
  expect(dueBriefs(eight, { sleptToday: latestNight() === localDate(eight) }).map((d) => d.kind)).toContain("daily");
});

test("clock times resolve to the right days", () => {
  const morning = atLocal("2026-03-10", "07:40");
  // Bedtime later on the clock than waking: the day before.
  expect(resolveNight({ asleepTime: "23:30", wakeTime: "07:10" }, morning)).toEqual({ start: atLocal("2026-03-09", "23:30"), end: atLocal("2026-03-10", "07:10") });
  // Fell asleep after midnight: the same day.
  expect(lastBefore(atLocal("2026-03-10", "07:10"), "00:45")).toBe(atLocal("2026-03-10", "00:45"));
  // No wake time: now.
  expect(resolveNight({ asleepTime: "23:30" }, morning)).toEqual({ start: atLocal("2026-03-09", "23:30"), end: morning });
  // A wake time later than now today means yesterday, unless it's a rounded "now".
  expect(wakeAt("09:00", undefined, morning)).toBe(atLocal("2026-03-09", "09:00"));
  expect(wakeAt("07:43", undefined, morning)).toBe(atLocal("2026-03-10", "07:43"));
  expect(wakeAt("06:30", "2026-03-05", morning)).toBe(atLocal("2026-03-05", "06:30"));
  expect(() => wakeAt(undefined, "2026-03-05", morning)).toThrow();
});

const call = async (name: string, args: Record<string, unknown>) => {
  const t = sleepTools.find((t) => t.name === name)!;
  const result = await t.handler(z.object(t.inputSchema).parse(args) as never, undefined);
  const text = (result.content[0] as { text: string }).text;
  return result.isError ? { error: text } : JSON.parse(text);
};
const clockAgo = (ms: number) => {
  const d = new Date(Date.now() - ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

test("log_sleep: \"me acabo de levantar\" logs up to now; update and delete by night", async () => {
  const logged = await call("log_sleep", { asleepTime: clockAgo(7 * 3_600_000), note: "sin reloj" });
  expect(Math.abs(logged.end - Date.now())).toBeLessThan(5_000);
  expect(Math.abs(logged.durationMin - 420)).toBeLessThanOrEqual(1);

  const again = await call("log_sleep", { asleepTime: clockAgo(6 * 3_600_000) });
  expect(again.error).toContain("edítala");

  const fixed = await call("update_sleep_night", { night: logged.night, asleepTime: clockAgo(8 * 3_600_000) });
  expect(Math.abs(fixed.durationMin - 480)).toBeLessThanOrEqual(1);
  expect(fixed.note).toBe("sin reloj");
  expect((await call("update_sleep_night", { night: "2020-01-01", note: "x" })).error).toContain("No night logged by hand");

  expect((await call("delete_sleep_night", { id: logged.id })).id).toBe(logged.id);
  expect(listManualNights("2000-01-01", "2100-01-01")).toEqual([]);
});

test("the tools are write tools, with action cards and Deshacer", () => {
  for (const name of ["log_sleep", "update_sleep_night", "delete_sleep_night"]) expect(accessOf(name)).toBe("write");

  const m = (message: object) => ({ session_id: "s", parent_tool_use_id: null, ...message }) as unknown as SDKMessage;
  const run = (name: string, input: Record<string, unknown>, act: () => unknown) => {
    const state = newTurnState();
    rememberBefore("t1", `mcp__pulso__${name}`, input);
    translate(m({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: `mcp__pulso__${name}`, input }] } }), state);
    translate(m({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: JSON.stringify(act()) }], is_error: false }] } }), state);
    const thread = createThread();
    const message = addMessage(thread.id, "assistant", "Listo.", "done");
    updateMessage(message.id, { text: "Listo.", tools: state.tools, status: "done" });
    return { card: state.tools[0]!.result!, undo: () => undoToolAction(thread.id, message.id, 0) };
  };

  const added = run("log_sleep", {}, () => addManualNight(span("2026-03-10", "23:30", "07:00"), NOW));
  expect(added.card).toMatchObject({ title: "Noche registrada", tab: "hoy", undo: "available" });
  expect(added.card.lines![0]!.value).toMatch(/^Noche del 10 mar · \d\d:\d\d → \d\d:\d\d · 7 h 30 min$/);
  added.undo();
  expect(manualNightOn("2026-03-10")).toBeUndefined();

  const n = addManualNight(span("2026-03-10", "23:30", "07:00"), NOW);
  const edited = run("update_sleep_night", { id: n.id }, () => updateManualNight(n.id, { end: n.end + 30 * 60_000 }, NOW));
  expect(edited.card.lines![0]!.before).toContain("7 h 30 min");
  expect(edited.card.lines![0]!.value).toContain("8 h");
  edited.undo();
  expect(getManualNight(n.id).end).toBe(n.end);

  const deleted = run("delete_sleep_night", {}, () => deleteManualNight(n.id));
  expect(deleted.card.title).toBe("Noche borrada");
  deleted.undo();
  expect(getManualNight(n.id).start).toBe(n.start);
  // A failed call leaves no undo behind.
  expect(summarizeAction("log_sleep", {}, "Error: x")?.card.undo).toBeUndefined();
});

const req = (method: string, body?: unknown) =>
  new Request("http://pulso.test/x", { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

test("routes: the phone needs its bearer; the web adds, edits and deletes", async () => {
  expect((await mobilePost(req("POST", span("2026-03-10", "23:30", "07:00")))).status).toBe(401);
  expect((await mobileDelete(req("DELETE"), params("x"))).status).toBe(401);

  expect((await webPost(req("POST", { start: "ayer" }))).status).toBe(400);
  const created = await webPost(req("POST", { ...span("2026-03-10", "23:30", "07:00"), note: "sin reloj" }));
  expect(created.status).toBe(201);
  const night = (await created.json()) as { id: string; night: string };
  expect(night.night).toBe("2026-03-10");
  const dup = await webPost(req("POST", span("2026-03-10", "22:00", "06:30")));
  expect(dup.status).toBe(409);
  expect(((await dup.json()) as { message: string }).message).toContain("Ya registraste");

  const short = await webPatch(req("PATCH", { end: span("2026-03-10", "23:30", "07:00").start + 30 * 60_000 }), params(night.id));
  expect(short.status).toBe(400);
  const patched = await webPatch(req("PATCH", { note: null }), params(night.id));
  expect(((await patched.json()) as { note: string | null }).note).toBeNull();
  expect((await webDelete(req("DELETE"), params(night.id))).status).toBe(200);
  expect((await webDelete(req("DELETE"), params(night.id))).status).toBe(404);
});
