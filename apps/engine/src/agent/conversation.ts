/**
 * The Coach's one perpetual conversation: a thread whose messages are split into
 * contexts, one SDK session each. «Contexto nuevo» starts a fresh session; going
 * back makes an old one active again. Quiet markers in the feed say when either
 * happened, or when the Coach summarized what came before.
 */
import { randomUUID } from "node:crypto";
import type { AgentContext, AgentFeedItem, AgentFeedMarker, AgentMessage, AgentMessageSource } from "@pulso/contract";
import { db } from "../db";
import { fallbackDigest, legacyThreads } from "./distill";
import { addMessage, createThread, withExtras, type MessageRow } from "./threads";

export const PAGE = 40;
/** Transcripts of contexts left alone this long may be deleted; going back then starts from a recap. */
export const PRUNE_AFTER_MS = 30 * 24 * 60 * 60_000;

type ConversationRow = { thread_id: string; active_context_id: string; distill_started_at: number | null; distilled_at: number | null };
export type ContextRow = {
  id: string;
  thread_id: string;
  sdk_session_id: string | null;
  seed: string | null;
  started_at: number;
  compacted_at: number | null;
  pruned_at: number | null;
};
type MarkerRow = { id: string; thread_id: string; context_id: string; kind: AgentFeedMarker["kind"]; created_at: number };

const row = () => db().query<ConversationRow, []>("SELECT * FROM agent_conversation WHERE id = 1").get() ?? undefined;

function insertContext(threadId: string, seed: string | null, now: number): string {
  const id = randomUUID();
  db().query("INSERT INTO agent_contexts (id, thread_id, seed, started_at) VALUES (?, ?, ?, ?)").run(id, threadId, seed, now);
  return id;
}

function addMarker(threadId: string, contextId: string, kind: AgentFeedMarker["kind"], at: number): void {
  db().query("INSERT INTO agent_feed_markers (id, thread_id, context_id, kind, created_at) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), threadId, contextId, kind, at);
}

/**
 * The conversation, created on first use. The old threads (all but live-workout
 * chats) are not shown in it: the first context starts from a digest of them,
 * a trimmed recap until the model's summary replaces it (distillation.ts).
 * Safe to call any number of times.
 */
export function ensureConversation(now = Date.now()): ConversationRow {
  const existing = row();
  if (existing) return existing;
  db().transaction(() => {
    const thread = createThread("Coach");
    const legacy = legacyThreads(thread.id);
    const contextId = insertContext(thread.id, legacy.length ? fallbackDigest(legacy) : null, now);
    db()
      .query("INSERT INTO agent_conversation (id, thread_id, active_context_id, distilled_at) VALUES (1, ?, ?, ?)")
      .run(thread.id, contextId, legacy.length ? null : now);
    if (legacy.length) addMarker(thread.id, contextId, "distilled", now);
  })();
  return row()!;
}

export const conversationThreadId = () => ensureConversation().thread_id;

export function getContext(id: string): ContextRow | undefined {
  return db().query<ContextRow, [string]>("SELECT * FROM agent_contexts WHERE id = ?").get(id) ?? undefined;
}

export const activeContext = (): ContextRow => getContext(ensureConversation().active_context_id)!;

/** The active context when `threadId` is the conversation; undefined for any other thread. */
export function contextOfThread(threadId: string): ContextRow | undefined {
  const conversation = row();
  return conversation?.thread_id === threadId ? getContext(conversation.active_context_id) : undefined;
}

export function setContextSession(contextId: string, sessionId: string | null): void {
  db().query("UPDATE agent_contexts SET sdk_session_id = ? WHERE id = ?").run(sessionId, contextId);
}

/** A context's messages, oldest first: what a recap rebuilds a lost session from. */
export function contextMessages(contextId: string): AgentMessage[] {
  return withExtras(db().query<MessageRow, [string]>("SELECT * FROM agent_messages WHERE context_id = ? ORDER BY created_at, rowid").all(contextId));
}

const lastMarker = (threadId: string) =>
  db().query<MarkerRow, [string]>("SELECT * FROM agent_feed_markers WHERE thread_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(threadId) ?? undefined;

const latestMessageAt = (threadId: string) =>
  db().query<{ at: number | null }, [string]>("SELECT MAX(created_at) AS at FROM agent_messages WHERE thread_id = ?").get(threadId)?.at ?? 0;

const lastMessageAt = (contextId: string) =>
  db().query<{ at: number | null }, [string]>("SELECT MAX(created_at) AS at FROM agent_messages WHERE context_id = ?").get(contextId)?.at ?? null;

/** Newest first, with how much each holds. */
export function listContexts(): AgentContext[] {
  const conversation = ensureConversation();
  return db()
    .query<ContextRow & { n: number; last: number | null }, [string]>(
      `SELECT c.*, COUNT(m.id) AS n, MAX(m.created_at) AS last FROM agent_contexts c
       LEFT JOIN agent_messages m ON m.context_id = c.id
       WHERE c.thread_id = ? GROUP BY c.id ORDER BY c.started_at DESC, c.rowid DESC`,
    )
    .all(conversation.thread_id)
    .map((c) => ({ id: c.id, startedAt: c.started_at, lastMessageAt: c.last, messageCount: c.n, active: c.id === conversation.active_context_id }));
}

/** «Contexto nuevo»: a fresh session from the next message. An active context with no messages yet is kept as is. */
export function newContext(now = Date.now()): ContextRow {
  const current = activeContext();
  if (lastMessageAt(current.id) === null) return current;
  const id = insertContext(current.thread_id, null, now);
  db().transaction(() => {
    db().query("UPDATE agent_conversation SET active_context_id = ? WHERE id = 1").run(id);
    addMarker(current.thread_id, id, "context", now);
  })();
  return getContext(id)!;
}

/** «Volver a este contexto»: makes an earlier context active again; new messages still go at the bottom. Undefined when there is no such context. */
export function switchContext(id: string, now = Date.now()): ContextRow | undefined {
  const conversation = ensureConversation();
  const context = getContext(id);
  if (!context || context.thread_id !== conversation.thread_id) return undefined;
  if (conversation.active_context_id === id) return context;
  db().transaction(() => {
    db().query("UPDATE agent_conversation SET active_context_id = ? WHERE id = 1").run(id);
    // Back and forth with nothing said in between leaves one line, not a stack of them.
    const last = lastMarker(conversation.thread_id);
    if (last?.kind === "switch" && last.created_at >= latestMessageAt(conversation.thread_id)) db().query("DELETE FROM agent_feed_markers WHERE id = ?").run(last.id);
    addMarker(conversation.thread_id, id, "switch", now);
  })();
  return context;
}

/**
 * Records a summary of a context (the SDK's auto-compaction, or the hourly
 * one) with a quiet marker at `markerAt`, unless the feed's last line already
 * is such a marker.
 */
export function recordCompaction(contextId: string, at = Date.now(), markerAt = at): void {
  const context = getContext(contextId);
  if (!context) return;
  db().query("UPDATE agent_contexts SET compacted_at = ? WHERE id = ?").run(at, contextId);
  const last = lastMarker(context.thread_id);
  if (last?.kind === "compacted" && last.created_at >= latestMessageAt(context.thread_id)) return;
  addMarker(context.thread_id, contextId, "compacted", markerAt);
}

/** The context got messages since its last summary (or has never had one). */
export function hasNewSinceCompaction(context: ContextRow): boolean {
  const last = lastMessageAt(context.id);
  return last !== null && last > (context.compacted_at ?? 0);
}

/** Past contexts whose transcript has sat untouched past PRUNE_AFTER_MS: safe to delete, SQLite keeps their text. */
export function prunableContexts(now = Date.now()): ContextRow[] {
  const conversation = ensureConversation();
  return db()
    .query<ContextRow, [string, string, number]>(
      `SELECT c.* FROM agent_contexts c WHERE c.thread_id = ? AND c.id <> ? AND c.sdk_session_id IS NOT NULL
         AND MAX(c.started_at, COALESCE(c.compacted_at, 0), COALESCE((SELECT MAX(created_at) FROM agent_messages WHERE context_id = c.id), 0)) < ?`,
    )
    .all(conversation.thread_id, conversation.active_context_id, now - PRUNE_AFTER_MS);
}

export function markPruned(contextId: string, now = Date.now()): void {
  db().query("UPDATE agent_contexts SET sdk_session_id = NULL, pruned_at = ? WHERE id = ?").run(now, contextId);
}

/** Claims the one-time distillation; false when it is done, or another run claimed it less than `staleMs` ago. */
export function claimDistillation(now = Date.now(), staleMs = 15 * 60_000): boolean {
  ensureConversation(now);
  return (
    db()
      .query("UPDATE agent_conversation SET distill_started_at = ? WHERE id = 1 AND distilled_at IS NULL AND (distill_started_at IS NULL OR distill_started_at < ?)")
      .run(now, now - staleMs).changes > 0
  );
}

/** The model's digest replaces the trimmed one on the first context; null keeps the trimmed one. Either way it is done. */
export function finishDistillation(digest: string | null, now = Date.now()): void {
  db().transaction(() => {
    if (digest) db().query("UPDATE agent_contexts SET seed = ? WHERE seed IS NOT NULL AND thread_id = (SELECT thread_id FROM agent_conversation WHERE id = 1)").run(digest);
    db().query("UPDATE agent_conversation SET distilled_at = ? WHERE id = 1").run(now);
  })();
}

export const distillationPending = () => ensureConversation().distilled_at === null;

/** The old conversations to distill (none once it is done). */
export const pendingLegacy = () => (distillationPending() ? legacyThreads(conversationThreadId()) : []);

const toMarker = (m: MarkerRow): AgentFeedMarker => ({ id: m.id, kind: m.kind, contextId: m.context_id, createdAt: m.created_at });

/**
 * One page of the feed, oldest first: up to `limit` messages before the message
 * `before` (the latest ones without it) and the markers between them. A marker
 * sharing a millisecond with a message goes first. `before` in the result names
 * the page before this one, null at the start.
 */
export function feedPage(before?: string, limit = PAGE): { items: AgentFeedItem[]; before: string | null } {
  const threadId = ensureConversation().thread_id;
  let upperRow = Number.MAX_SAFE_INTEGER;
  let upperAt = Number.MAX_SAFE_INTEGER;
  if (before) {
    const cursor = db().query<{ r: number; created_at: number }, [string, string]>("SELECT rowid AS r, created_at FROM agent_messages WHERE id = ? AND thread_id = ?").get(before, threadId);
    if (!cursor) return { items: [], before: null };
    upperRow = cursor.r;
    upperAt = cursor.created_at;
  }
  const rows = db()
    .query<MessageRow, [string, number, number]>("SELECT * FROM agent_messages WHERE thread_id = ? AND rowid < ? ORDER BY rowid DESC LIMIT ?")
    .all(threadId, upperRow, limit + 1);
  const older = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  const lowerAt = older ? page[0]!.created_at : -1;
  const markers = db()
    .query<MarkerRow, [string, number, number]>("SELECT * FROM agent_feed_markers WHERE thread_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at, rowid")
    .all(threadId, lowerAt, upperAt)
    .map(toMarker);

  const items: AgentFeedItem[] = [];
  let next = 0;
  for (const message of withExtras(page)) {
    while (next < markers.length && markers[next]!.createdAt <= message.createdAt) items.push({ type: "marker", marker: markers[next++]! });
    items.push({ type: "message", message });
  }
  for (; next < markers.length; next++) items.push({ type: "marker", marker: markers[next]! });
  return { items, before: older ? page[0]!.id : null };
}

/**
 * «Responder» on a brief, «Ver por qué» on a review: it goes into the active
 * context as the Coach's message and is handed to the next turn
 * (runner.withQuoted). The same quote twice is not added again.
 */
export function quoteMessage(source: AgentMessageSource, text: string): AgentMessage {
  const threadId = conversationThreadId();
  const existing = db()
    .query<MessageRow, [string, string, string]>("SELECT * FROM agent_messages WHERE thread_id = ? AND source = ? AND text = ? ORDER BY rowid DESC LIMIT 1")
    .get(threadId, JSON.stringify(source), text);
  return existing ? withExtras([existing])[0]! : addMessage(threadId, "assistant", text, "done", [], [], source);
}
