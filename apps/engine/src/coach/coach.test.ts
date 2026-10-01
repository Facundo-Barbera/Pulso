import { expect, test } from "bun:test";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { QueryFn } from "../agent/runner";
import { listMessages } from "../agent/threads";
import { generateBrief } from "./generate";
import { dueBriefs, lastSunday, periodFor } from "./periods";
import { briefPrompt } from "./prompts";
import { threadFromBrief } from "./reply";
import { regenerateBrief, runDueBriefs, startCoachScheduler, stopCoachScheduler } from "./scheduler";
import { briefFor, claimBrief, completeBrief, failBrief, failRunningBriefs, getBrief, latestBrief, listBriefs, RETRY_MS, STALE_MS } from "./store";
import { coachTools } from "./tools";

const m = (message: object) => ({ session_id: "s", parent_tool_use_id: null, ...message }) as unknown as SDKMessage;
const text = (t: string) => m({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } } });
const ok = (result: string) => m({ type: "result", subtype: "success", is_error: false, result });

type Call = { prompt: string; options: Options };

/** Answers every call with `script`, pausing a tick per message like the SDK. */
function fakeQuery(script: SDKMessage[], calls: Call[] = []): QueryFn {
  return (({ prompt, options }: Call) => {
    calls.push({ prompt, options });
    return (async function* () {
      for (const message of script) {
        await Bun.sleep(1);
        yield message;
      }
    })();
  }) as unknown as QueryFn;
}

// Local times: periods and due-ness follow the Mac's clock.
const WED_11 = new Date(2026, 8, 30, 11, 0);
const SUN_7 = new Date(2026, 9, 4, 7, 0);

test("the morning brief waits for 6:00, and for last night's sleep until 10:00", () => {
  const wed = (h: number) => new Date(2026, 8, 30, h, 0);
  expect(dueBriefs(wed(5), { sleptToday: true })).toEqual([]);
  expect(dueBriefs(wed(7), { sleptToday: false })).toEqual([]);
  expect(dueBriefs(wed(7), { sleptToday: true })).toEqual([{ kind: "daily", period: "2026-09-30" }]);
  expect(dueBriefs(wed(10), { sleptToday: false })).toEqual([{ kind: "daily", period: "2026-09-30" }]);
});

test("the weekly check-in is due on Sunday, and still on Monday if it was missed", () => {
  expect(dueBriefs(SUN_7, { sleptToday: false })).toEqual([{ kind: "weekly", period: "2026-10-04" }]);
  expect(dueBriefs(new Date(2026, 9, 5, 3, 0), { sleptToday: false })).toEqual([{ kind: "weekly", period: "2026-10-04" }]);
  expect(dueBriefs(new Date(2026, 9, 6, 12, 0), { sleptToday: false }).map((d) => d.kind)).toEqual(["daily"]);
  expect(lastSunday(new Date(2026, 9, 3, 23, 0))).toBe("2026-09-27");
  expect(periodFor("weekly", SUN_7)).toBe("2026-10-04");
  expect(periodFor("daily", SUN_7)).toBe("2026-10-04");
});

test("a period is claimed once; a running claim blocks until it is stale", () => {
  const now = Date.now();
  const first = claimBrief("daily", "2020-01-01", { now });
  expect(first?.status).toBe("running");
  expect(claimBrief("daily", "2020-01-01", { now })).toBeUndefined();
  expect(claimBrief("daily", "2020-01-01", { now, force: true })).toBeUndefined();
  expect(claimBrief("daily", "2020-01-01", { now: now + STALE_MS })?.id).toBe(first!.id);
});

test("a done brief is only rewritten on force; a failed one is retried after RETRY_MS", () => {
  const now = Date.now();
  const done = claimBrief("daily", "2020-01-02", { now })!;
  completeBrief(done.id, "Hola", now);
  expect(claimBrief("daily", "2020-01-02", { now: now + 10 * RETRY_MS })).toBeUndefined();
  expect(claimBrief("daily", "2020-01-02", { now, force: true })?.text).toBe("Hola");

  const failed = claimBrief("weekly", "2020-01-05", { now })!;
  failBrief(failed.id, "boom", now);
  expect(getBrief(failed.id)).toMatchObject({ status: "error", error: "boom" });
  expect(claimBrief("weekly", "2020-01-05", { now: now + 1000 })).toBeUndefined();
  expect(claimBrief("weekly", "2020-01-05", { now: now + RETRY_MS })?.status).toBe("running");
});

test("a failed regenerate keeps the previous text; a restart clears stuck runs", () => {
  const brief = claimBrief("daily", "2020-01-03")!;
  completeBrief(brief.id, "Versión 1");
  claimBrief("daily", "2020-01-03", { force: true });
  failBrief(brief.id, "boom");
  expect(getBrief(brief.id)).toMatchObject({ status: "done", text: "Versión 1", error: "boom" });

  const stuck = claimBrief("daily", "2020-01-04")!;
  expect(failRunningBriefs("reinicio")).toBeGreaterThanOrEqual(1);
  expect(getBrief(stuck.id)).toMatchObject({ status: "error", error: "reinicio" });
});

test("a brief is the final result of a read-only SDK turn", async () => {
  const calls: Call[] = [];
  const claimed = claimBrief("daily", "2020-02-01")!;
  const brief = await generateBrief(claimed, fakeQuery([text("Voy a mirar tus datos."), ok("**Recuperación:** 82, alta.\n**Hoy:** Torso A.")], calls));

  expect(brief).toMatchObject({ status: "done", text: "**Recuperación:** 82, alta.\n**Hoy:** Torso A.", error: null });
  const { prompt, options } = calls[0]!;
  expect(prompt).toContain("2020-02-01");
  expect(options.tools).toEqual([]);
  expect(options.resume).toBeUndefined();
  expect(options.persistSession).toBe(false);
  expect(options.permissionMode).toBe("dontAsk");
  expect(options.disallowedTools).toContain("mcp__pulso__update_profile");
  expect(options.disallowedTools).toContain("mcp__pulso__log_meal");
  expect(options.disallowedTools).not.toContain("mcp__pulso__get_readiness");
});

test("a turn that errors leaves the brief in error", async () => {
  const claimed = claimBrief("daily", "2020-02-02")!;
  const failure = m({ type: "result", subtype: "error_max_turns", is_error: true, errors: [] });
  expect(await generateBrief(claimed, fakeQuery([failure]))).toMatchObject({ status: "error", error: "error_max_turns", text: "" });
});

test("due briefs are written once, however many ticks race", async () => {
  const calls: Call[] = [];
  const run = fakeQuery([ok("Domingo: buena semana.")], calls);
  const [a, b] = await Promise.all([runDueBriefs(SUN_7, run), runDueBriefs(SUN_7, run)]);
  expect(a.length + b.length).toBe(1);
  expect(await runDueBriefs(SUN_7, run)).toEqual([]);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.prompt).toContain("weekly check-in");
  expect(briefFor("weekly", "2026-10-04")).toMatchObject({ status: "done", text: "Domingo: buena semana." });

  await runDueBriefs(WED_11, run);
  expect(calls).toHaveLength(2);
  expect(latestBrief("daily")?.period).toBe("2026-09-30");
  expect(listBriefs(undefined, 100).filter((b) => b.period === "2026-10-04" || b.period === "2026-09-30")).toHaveLength(2);
});

test("regenerate rewrites the current period, once at a time", async () => {
  const calls: Call[] = [];
  const at = new Date(2026, 10, 2, 8, 0);
  const first = regenerateBrief("daily", fakeQuery([ok("Uno")], calls), at)!;
  expect(first.brief.status).toBe("running");
  expect(regenerateBrief("daily", fakeQuery([ok("Dos")], calls), at)).toBeUndefined();
  expect((await first.done).text).toBe("Uno");
  expect((await regenerateBrief("daily", fakeQuery([ok("Dos")], calls), at)!.done).text).toBe("Dos");
  expect(calls).toHaveLength(2);
});

test("the scheduler starts once per process, like across dev reloads", async () => {
  const calls: Call[] = [];
  const run = fakeQuery([ok("x")], calls);
  expect(startCoachScheduler(run, 60_000)).toBe(true);
  expect(startCoachScheduler(run, 60_000)).toBe(false);
  await stopCoachScheduler();
  expect(startCoachScheduler(run, 60_000)).toBe(true);
  await stopCoachScheduler();
});

test("prompts ask for the right sources, in Spanish, without changing data", () => {
  const daily = briefPrompt("daily", "2026-09-30");
  expect(daily).toContain("miércoles 2026-09-30");
  for (const name of ["get_readiness", "get_active_program", "get_targets", "list_medications"]) expect(daily).toContain(name);
  expect(daily).toContain("3 to 5 lines");
  const weekly = briefPrompt("weekly", "2026-10-04");
  expect(weekly).toContain("lunes 2026-09-28 to domingo 2026-10-04");
  for (const name of ["get_adherence", "body_projection", "list_meals", "Ajuste para la semana"]) expect(weekly).toContain(name);
  for (const prompt of [daily, weekly]) {
    expect(prompt).toContain("Spanish");
    expect(prompt).toContain("Do not change anything");
  }
});

test("replying opens a thread whose first message is the brief", () => {
  const brief = claimBrief("daily", "2026-10-01")!;
  completeBrief(brief.id, "**Hoy:** Pierna.");
  const thread = threadFromBrief(getBrief(brief.id)!);
  expect(thread.title).toBe("Resumen del 1 oct");
  expect(listMessages(thread.id)).toMatchObject([{ role: "assistant", text: "**Hoy:** Pierna.", status: "done" }]);
});

test("get_latest_brief returns the newest brief of a kind", async () => {
  const getLatest = coachTools.find((t) => t.name === "get_latest_brief")!;
  const result = await getLatest.handler({ kind: "weekly" }, undefined);
  const body = JSON.parse((result.content[0] as { text: string }).text);
  expect(body).toMatchObject({ kind: "weekly", period: latestBrief("weekly")!.period });
});
