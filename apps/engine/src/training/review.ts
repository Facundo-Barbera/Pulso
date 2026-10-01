import fs from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { LoadSuggestion, ProgramDay, SessionAdjustment } from "@pulso/contract";
import { newTurnState, translate } from "../agent/events";
import { getProfile } from "../agent/profile";
import { agentOptions, type QueryFn } from "../agent/runner";
import { claudeMd } from "../agent/workspace";
import { dataDir } from "../db";
import { adjustmentFor, claimReview, decide, fallbackChanges, fallbackRationale, getAdjustment, GUARDRAILS, lastSessionId, runningReviews } from "./adjust";
import { detectSignals, signalsKey } from "./signals";
import { activeProgramView, unitOf } from "./store";
import { formatWeight } from "./units";

/**
 * The engine detects, the Coach decides. When a signal fires for the next
 * workout (./signals.ts), a review is claimed for that session and those
 * signals, and one short Coach turn reads what it needs and calls
 * set_session_adjustment — changes within the guardrails, or no change. If the
 * Coach can't (provider down, timeout, no decision), the fixed table in
 * ./adjust.ts decides and the result says so. A scheduler tick looks every
 * REVIEW_TICK_MS, and opening Entreno nudges it, so the review is usually done
 * before the person opens the app.
 */

export const REVIEW_TICK_MS = 15 * 60_000;
export const REVIEW_LIMIT_MS = 3 * 60_000;

export const REVIEW_PERSONA = `
You are Pulso's Coach. Before the person's next workout the app noticed something (listed below) and asks you to review that one session: keep it, or adjust it for today only.
- Read what you need first: their recent sessions and exercise history, readiness and sleep, health events, calendar. Be quick: a few tool calls.
- Then call set_session_adjustment exactly once for the day below: noChange true when the plan is right as it is, otherwise the changes. Typical: after a break, a bit less load (−10 to −30 %) and maybe a set fewer, reps toward the bottom of the range, building back over two or three sessions; low readiness or bad sleep, a small cut; an injury, swap or skip what loads that area (find_similar_exercises) and never push through pain; a new block, carry loads over where exercises repeat. Two days off in a four-day week is normal rest, not a break.
- The guardrails are enforced; if the tool refuses, fix what it says and call it again.
- rationale: ONE calm sentence in Spanish for the next-workout card, no jargon, saying what you noticed and what changes, e.g. "Llevas 9 días sin entrenar y dormiste poco: hoy 2 series por ejercicio y un 10 % menos de peso."
- Then reply with that sentence only.
`.trim();

/** Tools the review gets (names without the `mcp__pulso__` prefix). */
export const REVIEW_TOOLS = [
  "get_active_program",
  "list_sessions",
  "exercise_history",
  "get_readiness",
  "get_daily_metrics",
  "get_sleep_nights",
  "list_health_events",
  "get_calendar",
  "find_similar_exercises",
  "list_exercises",
  "set_session_adjustment",
];

/** What the review turn starts from: the day, its normal suggestions, the signals and the bounds. */
export function reviewContext(adjustment: SessionAdjustment, day: ProgramDay, suggestions: Record<string, LoadSuggestion>, now: Date): string {
  const rows = day.exercises.map((ex) => {
    if (ex.kind === "cardio") return `- ${ex.id} · ${ex.exerciseName} (cardio)`;
    const s = suggestions[ex.id];
    const load = s?.weightKg != null ? ` · progression suggests ${formatWeight(s.weightKg, unitOf(ex.exerciseId))} × ${s.reps}` : " · no history";
    return `- ${ex.id} · ${ex.exerciseName} · ${ex.sets} × ${ex.repMin}–${ex.repMax}${load}`;
  });
  return [
    `Today: ${now.toISOString().slice(0, 10)}.`,
    `## The session to review: ${day.name} (dayId ${day.id})`,
    ...rows,
    "",
    "## What the app noticed",
    ...adjustment.signals.map((s) => `- ${s.kind}${s.level ? ` (${s.level})` : ""}: ${s.detail}`),
    "",
    "## Guardrails",
    `- loadPercent between ${(GUARDRAILS.minLoadShare - 1) * 100} and 0 (never heavier than progression, never under ${GUARDRAILS.minLoadShare * 100} % of the last load)`,
    `- at most ${GUARDRAILS.maxSetsRemoved} sets fewer per exercise, never more sets; reps within the range`,
    `- swaps of the same kind; skip at most half the exercises; at most ${GUARDRAILS.maxWarmups} cardio warm-up of up to ${GUARDRAILS.maxWarmupMinutes} min`,
  ].join("\n");
}

/**
 * Claims the review of the next workout when a signal fires and nobody has
 * reviewed it for these signals yet. A decision the Coach made in a chat
 * (no signals) stands. Undefined when there is nothing to review.
 */
export function claimDueReview(now = Date.now()): { adjustment: SessionAdjustment; day: ProgramDay; suggestions: Record<string, LoadSuggestion> } | undefined {
  const view = activeProgramView(now);
  const day = view.program?.days.find((d) => d.id === view.nextDayId);
  if (!view.program || !day) return undefined;
  const signals = detectSignals(view.program, day, view.blocks ?? [], now);
  if (signals.length === 0) return undefined;
  const since = lastSessionId();
  const current = adjustmentFor(view.program.id, day.id, since);
  if (current?.status === "ready" && current.decidedBy === "coach" && current.signals.length === 0) return undefined;
  const adjustment = claimReview(signalsKey(view.program.id, day.id, since, signals), view.program.id, day.id, since, signals, now);
  return adjustment && { adjustment, day, suggestions: view.suggestions };
}

/** The fixed table decides, saying why the Coach didn't. */
function fallback(adjustment: SessionAdjustment, day: ProgramDay, error: string): SessionAdjustment {
  console.error(`[review] ${day.name}: the Coach couldn't decide (${error}); using the fallback table`);
  const changes = fallbackChanges(day, adjustment.signals);
  return decide(adjustment.id, { decidedBy: "fallback", noChange: false, rationale: fallbackRationale(adjustment.signals, changes), changes, error });
}

/**
 * Runs one Coach turn on a claimed review. Never throws: without a decision
 * from the Coach the fallback decides. Returns the adjustment as it ends.
 */
export async function runReview(adjustment: SessionAdjustment, day: ProgramDay, suggestions: Record<string, LoadSuggestion>, run: QueryFn = query, now = new Date()): Promise<SessionAdjustment> {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), REVIEW_LIMIT_MS);
  const state = newTurnState();
  try {
    const cwd = path.join(dataDir(), "reviews");
    fs.mkdirSync(cwd, { recursive: true });
    const mode = { persona: REVIEW_PERSONA, context: `${claudeMd(getProfile(), now)}\n\n${reviewContext(adjustment, day, suggestions, now)}`, tools: REVIEW_TOOLS };
    const options = { ...agentOptions(cwd, mode.context, undefined, abortController, mode), persistSession: false };
    for await (const message of run({ prompt: `Review my next session: ${day.name}.`, options })) translate(message, state);
  } catch (error) {
    state.error ??= abortController.signal.aborted ? "timeout" : error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(timer);
  }
  const after = getAdjustment(adjustment.id);
  if (after?.status === "ready") return after;
  return fallback(adjustment, day, state.error ?? "no decision");
}

/** Reviews the next workout if it is due. Returns what it decided. */
export async function runDueReviews(now = new Date(), run: QueryFn = query): Promise<SessionAdjustment[]> {
  const due = claimDueReview(now.getTime());
  return due ? [await runReview(due.adjustment, due.day, due.suggestions, run, now)] : [];
}

// ── Scheduler (the daily brief's pattern, src/coach/scheduler.ts) ────────────

type Scheduler = { timer: ReturnType<typeof setInterval>; run: QueryFn; ticking: Promise<SessionAdjustment[]> | null };
const g = globalThis as { __pulso_review_scheduler__?: Scheduler };

function tick(scheduler: Scheduler): Promise<SessionAdjustment[]> {
  scheduler.ticking ??= runDueReviews(new Date(), scheduler.run)
    .catch((error) => {
      console.error("[review] tick failed:", error);
      return [];
    })
    .finally(() => {
      scheduler.ticking = null;
    });
  return scheduler.ticking;
}

/**
 * Starts the review scheduler once per process. Off with
 * PULSO_COACH_SCHEDULER=off, like the briefs. A review left `reviewing` by
 * the last process is retried on the first tick (it is stale by then or taken
 * when REVIEW_STALE_MS passes).
 */
export function startReviewScheduler(run: QueryFn = query, every = REVIEW_TICK_MS): boolean {
  if (g.__pulso_review_scheduler__ || process.env.PULSO_COACH_SCHEDULER === "off") return false;
  const scheduler: Scheduler = { timer: setInterval(() => void tick(scheduler), every), run, ticking: null };
  scheduler.timer.unref?.();
  g.__pulso_review_scheduler__ = scheduler;
  if (runningReviews().length) console.log(`[review] ${runningReviews().length} review(s) left running will be retried`);
  void tick(scheduler);
  return true;
}

export async function stopReviewScheduler(): Promise<void> {
  const scheduler = g.__pulso_review_scheduler__;
  if (!scheduler) return;
  clearInterval(scheduler.timer);
  g.__pulso_review_scheduler__ = undefined;
  await scheduler.ticking;
}

/** Opening Entreno (or Empezar) kicks a tick without waiting for it, so a stale review catches up. */
export function nudgeReviews(): void {
  const scheduler = g.__pulso_review_scheduler__;
  if (scheduler) void tick(scheduler);
}
