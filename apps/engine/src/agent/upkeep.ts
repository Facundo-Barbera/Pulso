/**
 * The conversation's housekeeping, outside any turn: the one-time distillation
 * of the old threads, an hourly summary (/compact) of the active context once it
 * has gone quiet and grown big, and deleting the transcripts of contexts left alone for a
 * month. Sends wait for whatever of it is running (settled()).
 */
import fs from "node:fs";
import path from "node:path";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import {
  activeContext,
  claimDistillation,
  conversationThreadId,
  finishDistillation,
  hasNewSinceCompaction,
  lastMessageAt,
  markPruned,
  pendingLegacy,
  prunableContexts,
  recordCompaction,
  setContextSession,
  setContextTokens,
  type ContextRow,
} from "./conversation";
import { dataDir } from "../db";
import { distillPrompt, type LegacyThread } from "./distill";
import { newTurnState, translate } from "./events";
import { getProfile } from "./profile";
import { activeTurn, agentOptions, lastTurnEndedAt, type QueryFn } from "./runner";
import { deleteTranscript, stripImages } from "./transcripts";
import { claudeMd, prepareWorkspace } from "./workspace";

export const HOUR_MS = 60 * 60_000;
/** The hourly summary waits this long after the latest message, so it never lands between a reply and the person's answer. */
export const IDLE_BEFORE_COMPACT_MS = 30 * 60_000;
/**
 * Below this many tokens the hourly summary leaves a context alone. The fixed
 * part (system prompt and tool schemas) is most of the first ~60k and no
 * summary shrinks it; above this the history is big enough that the next long
 * turn could hit the SDK's own compaction near AUTO_COMPACT_WINDOW mid-turn.
 */
export const COMPACT_ABOVE_TOKENS = 110_000;
const COMPACT_LIMIT_MS = 5 * 60_000;
const DISTILL_LIMIT_MS = 5 * 60_000;
/** What /compact keeps; the CLI takes the rest of the line as instructions for the summary. */
export const COMPACT_PROMPT =
  "/compact Keep everything a health coach needs to carry on: what you learned about the person, decisions and plans made, what you logged or changed for them, open questions and promises, and the last exchange in enough detail to continue it naturally.";

type Upkeep = { timer: ReturnType<typeof setInterval>; run: QueryFn; ticking: Promise<void> | null };
type Running = { compaction: Promise<boolean> | null; distillation: Promise<void> | null };

// Survive Next's dev reloads, like the turns: one of each per process.
const g = globalThis as { __pulso_upkeep__?: Upkeep; __pulso_upkeep_running__?: Running };
const running = (): Running => (g.__pulso_upkeep_running__ ??= { compaction: null, distillation: null });

export const compacting = () => running().compaction !== null;

/**
 * Worth an hourly summary: messages since the last one, none for
 * IDLE_BEFORE_COMPACT_MS, and more than COMPACT_ABOVE_TOKENS in the context as
 * its last turn measured it (unknown size: no).
 */
export function worthCompacting(context: ContextRow, now = Date.now()): boolean {
  const at = lastMessageAt(context.id);
  const last = at === null ? null : Math.max(at, lastTurnEndedAt(context.thread_id) ?? 0);
  return (
    hasNewSinceCompaction(context) &&
    last !== null &&
    now - last >= IDLE_BEFORE_COMPACT_MS &&
    context.context_tokens !== null &&
    context.context_tokens > COMPACT_ABOVE_TOKENS
  );
}

/**
 * Summarizes the active context with /compact when it is worth it
 * (worthCompacting), it has a session, and no turn is in flight. Resolves true
 * when it summarized. Never throws.
 */
export function compactActive(run: QueryFn = query, now = new Date()): Promise<boolean> {
  const state = running();
  if (state.compaction) return state.compaction;
  const context = activeContext();
  const session = context.sdk_session_id;
  if (!session || !worthCompacting(context, now.getTime()) || activeTurn(context.thread_id)) return Promise.resolve(false);
  state.compaction = (async () => {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), COMPACT_LIMIT_MS);
    const turn = newTurnState();
    try {
      stripImages(session);
      const profile = claudeMd(getProfile(), now);
      const options = agentOptions(prepareWorkspace(null, profile), profile, session, abortController);
      for await (const message of run({ prompt: COMPACT_PROMPT, options })) translate(message, turn);
    } catch (error) {
      turn.error ??= error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }
    if (turn.sessionId && turn.sessionId !== session) setContextSession(context.id, turn.sessionId);
    if (!turn.compacted) {
      console.warn(`[agent] hourly compaction of ${session} did not summarize${turn.error ? `: ${turn.error}` : ""}`);
      return false;
    }
    recordCompaction(context.id, Date.now());
    setContextTokens(context.id, turn.contextTokens ?? null);
    return true;
  })().finally(() => {
    state.compaction = null;
  });
  return state.compaction;
}

/** One plain model call that never touches tools, files or the person's data. */
export function distillOptions(abortController: AbortController): Options {
  const cwd = path.join(dataDir(), "coach");
  fs.mkdirSync(cwd, { recursive: true });
  return {
    ...agentOptions(cwd, "", undefined, abortController),
    systemPrompt: "You summarize conversations faithfully and concisely.",
    mcpServers: {},
    tools: [],
    allowedTools: [],
    hooks: {},
    persistSession: false,
    maxTurns: 1,
  };
}

/** The model's summary of the old conversations. Throws when it can't write one. */
export async function distill(threads: LegacyThread[], run: QueryFn = query): Promise<string> {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), DISTILL_LIMIT_MS);
  const state = newTurnState();
  let final: string | undefined;
  try {
    for await (const message of run({ prompt: distillPrompt(threads), options: distillOptions(abortController) })) {
      translate(message, state);
      if (message.type === "result" && message.subtype === "success" && !message.is_error) final = message.result;
    }
  } finally {
    clearTimeout(timer);
  }
  const text = (final ?? state.text).trim();
  if (state.error || !text) throw new Error(state.error ?? "empty distillation");
  return text;
}

/**
 * The one-time distillation: the model summarizes the old threads and the
 * summary becomes what the first context starts from; if the model fails, the
 * trimmed recap written at migration stays. Claimed in SQLite, so it runs once.
 */
export function distillOnce(run: QueryFn = query, now = Date.now()): Promise<void> {
  const state = running();
  if (state.distillation) return state.distillation;
  const legacy = pendingLegacy();
  if (!legacy.length) {
    if (claimDistillation(now)) finishDistillation(null, now);
    return Promise.resolve();
  }
  if (!claimDistillation(now)) return Promise.resolve();
  state.distillation = distill(legacy, run)
    .then((digest) => finishDistillation(digest))
    .catch((error) => {
      console.error("[agent] distilling the old conversations failed; keeping the trimmed recap:", error);
      finishDistillation(null);
    })
    .finally(() => {
      state.distillation = null;
    });
  return state.distillation;
}

/** Deletes the transcripts of past contexts untouched for a month; their messages stay, and going back starts from a recap. */
export function pruneTranscripts(now = Date.now()): number {
  const prunable = prunableContexts(now);
  for (const context of prunable) {
    deleteTranscript(context.sdk_session_id!);
    markPruned(context.id, now);
  }
  return prunable.length;
}

/** Waits (up to `ms`) for a summary or the distillation in flight, so a turn starts from what they produce. */
export async function settled(ms = 90_000): Promise<void> {
  const { compaction, distillation } = running();
  const pending = [compaction, distillation].filter(Boolean);
  if (!pending.length) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.allSettled(pending), new Promise((r) => (timer = setTimeout(r, ms)))]);
  clearTimeout(timer);
}

async function tick(upkeep: Upkeep): Promise<void> {
  try {
    conversationThreadId();
    pruneTranscripts();
    await compactActive(upkeep.run);
  } catch (error) {
    console.error("[agent] upkeep tick failed:", error);
  }
}

/**
 * Starts the conversation's upkeep once per process: the distillation now if
 * it is pending, then every hour a summary and a prune. Off with
 * PULSO_COACH_SCHEDULER=off, like the briefs.
 */
export function startUpkeep(run: QueryFn = query, every = HOUR_MS): boolean {
  if (g.__pulso_upkeep__ || process.env.PULSO_COACH_SCHEDULER === "off") return false;
  const upkeep: Upkeep = {
    timer: setInterval(() => {
      upkeep.ticking ??= tick(upkeep).finally(() => (upkeep.ticking = null));
    }, every),
    run,
    ticking: null,
  };
  upkeep.timer.unref?.();
  g.__pulso_upkeep__ = upkeep;
  void distillOnce(run);
  console.log(`[agent] conversation upkeep started (every ${Math.round(every / 60_000)} min)`);
  return true;
}

/** For tests and shutdown. */
export async function stopUpkeep(): Promise<void> {
  const upkeep = g.__pulso_upkeep__;
  if (!upkeep) return;
  clearInterval(upkeep.timer);
  g.__pulso_upkeep__ = undefined;
  await upkeep.ticking;
}
