/**
 * The move to one perpetual conversation: the old threads stop being shown, and
 * what the Coach learned in them becomes the starting point of the first
 * context, written once by the model (upkeep.ts) or, when that fails, a
 * trimmed recap.
 */
import type { AgentMessage, AgentThread } from "@pulso/contract";
import { db } from "../db";
import { listMessages } from "./threads";

export type LegacyThread = { thread: AgentThread; messages: AgentMessage[] };

const FALLBACK_CHARS = 12_000;
const FALLBACK_MESSAGE_CHARS = 400;
const INPUT_CHARS = 120_000;
const INPUT_MESSAGE_CHARS = 1500;

/**
 * The old conversations worth distilling, oldest first: every thread but the
 * perpetual one and the live-workout chats, with at least one non-empty message.
 */
export function legacyThreads(except: string | null): LegacyThread[] {
  const rows = db()
    .query<{ id: string; title: string; created_at: number; updated_at: number }, [string]>(
      `SELECT * FROM agent_threads
       WHERE id <> ? AND title NOT LIKE 'Entreno · %'
         AND id NOT IN (SELECT thread_id FROM live_sessions WHERE thread_id IS NOT NULL)
       ORDER BY created_at`,
    )
    .all(except ?? "");
  return rows
    .map((row) => ({
      thread: { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at, preview: null },
      messages: listMessages(row.id).filter((m) => m.text.trim()),
    }))
    .filter((t) => t.messages.length > 0);
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
const line = (m: AgentMessage, max: number) => `${m.role === "user" ? "Persona" : "Coach"}: ${cut(m.text.trim(), max)}`;

/** Threads as text, newest kept first when they don't all fit in `budget`; returned oldest first. */
function transcript(threads: LegacyThread[], perMessage: number, budget: number): string {
  const blocks: string[] = [];
  let used = 0;
  for (const { thread, messages } of [...threads].reverse()) {
    const block = [`### ${thread.title} (${day(thread.createdAt)})`, ...messages.map((m) => line(m, perMessage))].join("\n");
    if (used + block.length > budget) {
      const room = budget - used;
      if (room > 200) blocks.push(`${block.slice(0, room)}…`);
      break;
    }
    blocks.push(block);
    used += block.length + 2;
  }
  return blocks.reverse().join("\n\n");
}

/** The deterministic digest: the old conversations themselves, trimmed. Used until (or instead of) the model's. */
export function fallbackDigest(threads: LegacyThread[]): string {
  return transcript(threads, FALLBACK_MESSAGE_CHARS, FALLBACK_CHARS);
}

export const DISTILL_PROMPT = `
You are preparing the memory of a personal health coach (training, diet, body composition) who is moving from many separate conversations with one person to a single ongoing one.
Below are the earlier conversations, oldest first. Write a compact summary the coach will start from, in Spanish, as Markdown with these ### sections (skip a section when there is nothing for it):
### Sobre la persona — durable facts: goals, body, health, injuries, schedule, equipment, food likes and dislikes.
### Decisiones y planes — what was decided or set up (programs, diet plans, medication or supplement routines), with dates when they matter.
### Preferencias — how they like to be coached and to talk.
### Pendiente — open questions, things promised, follow-ups.
Be concrete (numbers, names, dates) and brief: at most about 400 words. Only what the conversations say; never invent. Write only the summary.
`.trim();

/** What the model reads to distill: the old conversations, newest kept when they don't all fit. */
export const distillPrompt = (threads: LegacyThread[]) =>
  `${DISTILL_PROMPT}\n\n<conversations>\n${transcript(threads, INPUT_MESSAGE_CHARS, INPUT_CHARS)}\n</conversations>`;
