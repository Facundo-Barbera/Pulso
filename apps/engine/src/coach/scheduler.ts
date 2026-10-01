import { query } from "@anthropic-ai/claude-agent-sdk";
import type { CoachBrief, CoachBriefKind } from "@pulso/contract";
import type { QueryFn } from "../agent/runner";
import { latestNight } from "../sleep/store";
import { generateBrief } from "./generate";
import { dueBriefs, localDate, periodFor } from "./periods";
import { claimBrief, failRunningBriefs } from "./store";

export const TICK_MS = 15 * 60_000;

type Scheduler = { timer: ReturnType<typeof setInterval>; run: QueryFn; ticking: Promise<CoachBrief[]> | null };

// Survives Next's dev reloads, like the db connection: one scheduler per process.
const g = globalThis as { __pulso_coach_scheduler__?: Scheduler };

/**
 * Writes every brief that is due at `at` and does not exist yet, one after
 * another. Safe to call any number of times: each period is claimed in SQLite
 * before it is generated. Returns the briefs it wrote.
 */
export async function runDueBriefs(at = new Date(), run: QueryFn = query): Promise<CoachBrief[]> {
  const written: CoachBrief[] = [];
  for (const { kind, period } of dueBriefs(at, { sleptToday: latestNight() === localDate(at) })) {
    const claimed = claimBrief(kind, period, { now: at.getTime() });
    if (claimed) written.push(await generateBrief(claimed, run, at));
  }
  return written;
}

/**
 * The manual "regenerate": claims the current period of `kind` even if it is
 * done and writes it again in the background. Returns the `running` row, or
 * undefined when that brief is already being written.
 */
export function regenerateBrief(kind: CoachBriefKind, run: QueryFn = query, at = new Date()): { brief: CoachBrief; done: Promise<CoachBrief> } | undefined {
  const claimed = claimBrief(kind, periodFor(kind, at), { force: true, now: at.getTime() });
  if (!claimed) return undefined;
  return { brief: claimed, done: generateBrief(claimed, run, at) };
}

/** Runs a tick unless the previous one is still going. */
function tick(scheduler: Scheduler): Promise<CoachBrief[]> {
  scheduler.ticking ??= runDueBriefs(new Date(), scheduler.run)
    .catch((error) => {
      console.error("[coach] scheduler tick failed:", error);
      return [];
    })
    .finally(() => {
      scheduler.ticking = null;
    });
  return scheduler.ticking;
}

/**
 * Starts the brief scheduler once per process: a tick now and every TICK_MS.
 * Returns false when it was already running (a dev reload) or is turned off
 * with PULSO_COACH_SCHEDULER=off.
 */
export function startCoachScheduler(run: QueryFn = query, every = TICK_MS): boolean {
  if (g.__pulso_coach_scheduler__ || process.env.PULSO_COACH_SCHEDULER === "off") return false;
  failRunningBriefs("La Mac se reinició antes de terminar este resumen.");
  const scheduler: Scheduler = { timer: setInterval(() => void tick(scheduler), every), run, ticking: null };
  scheduler.timer.unref?.();
  g.__pulso_coach_scheduler__ = scheduler;
  console.log(`[coach] brief scheduler started (every ${Math.round(every / 60_000)} min)`);
  void tick(scheduler);
  return true;
}

/** For tests and shutdown. Resolves when the tick in flight, if any, ends. */
export async function stopCoachScheduler(): Promise<void> {
  const scheduler = g.__pulso_coach_scheduler__;
  if (!scheduler) return;
  clearInterval(scheduler.timer);
  g.__pulso_coach_scheduler__ = undefined;
  await scheduler.ticking;
}

/** Kicks a tick from a request (e.g. the phone opening Hoy) without waiting for it. */
export function nudgeCoachScheduler(): void {
  const scheduler = g.__pulso_coach_scheduler__;
  if (scheduler) void tick(scheduler);
}
