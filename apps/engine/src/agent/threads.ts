import { randomUUID } from "node:crypto";
import type { AgentAttachment, AgentMessage, AgentMessageStatus, AgentThread, AgentToolUse } from "@pulso/contract";
import { db } from "../db";

export const DEFAULT_TITLE = "Nueva conversación";

type ThreadRow = { id: string; title: string; sdk_session_id: string | null; created_at: number; updated_at: number; preview: string | null };
type MessageRow = {
  id: string;
  thread_id: string;
  role: AgentMessage["role"];
  text: string;
  tools: string;
  status: AgentMessageStatus;
  error: string | null;
  created_at: number;
};

const toThread = (row: ThreadRow): AgentThread => ({
  id: row.id,
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  preview: row.preview ? row.preview.slice(0, 140) : null,
});

type AttachmentRow = { id: string; message_id: string; width: number; height: number };

const toMessage = (row: MessageRow, attachments: AgentAttachment[] = []): AgentMessage => ({
  id: row.id,
  threadId: row.thread_id,
  role: row.role,
  text: row.text,
  attachments,
  tools: JSON.parse(row.tools) as AgentToolUse[],
  status: row.status,
  error: row.error,
  createdAt: row.created_at,
});

// The latest non-empty message of each thread, for the list. rowid keeps insertion order within a millisecond.
const THREAD_SELECT = `
  SELECT t.*, (SELECT m.text FROM agent_messages m WHERE m.thread_id = t.id AND m.text <> ''
               ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS preview
  FROM agent_threads t`;

export function listThreads(): AgentThread[] {
  return db().query<ThreadRow, []>(`${THREAD_SELECT} ORDER BY t.updated_at DESC`).all().map(toThread);
}

export function getThread(id: string): AgentThread | undefined {
  const row = db().query<ThreadRow, [string]>(`${THREAD_SELECT} WHERE t.id = ?`).get(id);
  return row ? toThread(row) : undefined;
}

export function createThread(title = DEFAULT_TITLE): AgentThread {
  const now = Date.now();
  const id = randomUUID();
  db().query("INSERT INTO agent_threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, title, now, now);
  return getThread(id)!;
}

export function deleteThread(id: string): boolean {
  return db().query("DELETE FROM agent_threads WHERE id = ?").run(id).changes > 0;
}

export function sdkSessionOf(threadId: string): string | null {
  return db().query<{ sdk_session_id: string | null }, [string]>("SELECT sdk_session_id FROM agent_threads WHERE id = ?").get(threadId)?.sdk_session_id ?? null;
}

export function setSdkSession(threadId: string, sessionId: string | null): void {
  db().query("UPDATE agent_threads SET sdk_session_id = ? WHERE id = ?").run(sessionId, threadId);
}

/** Titles a thread from its first message: first line, cut at a word near 48 characters. */
export function titleFrom(text: string): string {
  const line = text.trim().split("\n")[0]!.replace(/\s+/g, " ").trim();
  if (!line) return DEFAULT_TITLE;
  if (line.length <= 48) return line;
  const cut = line.slice(0, 48);
  const space = cut.lastIndexOf(" ");
  return `${(space > 24 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`;
}

export function listMessages(threadId: string, limit?: number): AgentMessage[] {
  const rows = db()
    .query<MessageRow, [string, number]>(
      "SELECT * FROM (SELECT *, rowid AS r FROM agent_messages WHERE thread_id = ? ORDER BY created_at DESC, r DESC LIMIT ?) ORDER BY created_at, r",
    )
    .all(threadId, limit ?? -1);
  const photos = attachmentsOf({ threadId });
  return rows.map((row) => toMessage(row, photos.get(row.id)));
}

/** Photos by message id, in the order they were sent: those of one thread, or of one message. */
function attachmentsOf(where: { threadId: string } | { messageId: string }): Map<string, AgentAttachment[]> {
  const rows =
    "threadId" in where
      ? db()
          .query<AttachmentRow, [string]>("SELECT a.* FROM agent_attachments a JOIN agent_messages m ON m.id = a.message_id WHERE m.thread_id = ? ORDER BY a.position")
          .all(where.threadId)
      : db().query<AttachmentRow, [string]>("SELECT * FROM agent_attachments WHERE message_id = ? ORDER BY position").all(where.messageId);
  const byMessage = new Map<string, AgentAttachment[]>();
  for (const row of rows) {
    const list = byMessage.get(row.message_id) ?? [];
    list.push({ id: row.id, mime: "image/jpeg", width: row.width, height: row.height });
    byMessage.set(row.message_id, list);
  }
  return byMessage;
}

/** True when the photo belongs to a message of this thread. */
export function hasAttachment(threadId: string, id: string): boolean {
  return !!db()
    .query("SELECT 1 FROM agent_attachments a JOIN agent_messages m ON m.id = a.message_id WHERE a.id = ? AND m.thread_id = ?")
    .get(id, threadId);
}

export function getMessage(id: string): AgentMessage | undefined {
  const row = db().query<MessageRow, [string]>("SELECT * FROM agent_messages WHERE id = ?").get(id);
  return row ? toMessage(row, attachmentsOf({ messageId: id }).get(id)) : undefined;
}

export function addMessage(threadId: string, role: AgentMessage["role"], text: string, status: AgentMessageStatus, attachments: AgentAttachment[] = []): AgentMessage {
  const now = Date.now();
  const id = randomUUID();
  db().transaction(() => {
    db().query("INSERT INTO agent_messages (id, thread_id, role, text, status, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, threadId, role, text, status, now);
    attachments.forEach((a, position) => {
      db().query("INSERT INTO agent_attachments (id, message_id, position, width, height) VALUES (?, ?, ?, ?, ?)").run(a.id, id, position, a.width, a.height);
    });
    db().query("UPDATE agent_threads SET updated_at = ? WHERE id = ?").run(now, threadId);
    if (role === "user") {
      const title = text.trim() ? titleFrom(text) : attachments.length > 1 ? "Fotos" : attachments.length ? "Foto" : DEFAULT_TITLE;
      db().query("UPDATE agent_threads SET title = ? WHERE id = ? AND title = ?").run(title, threadId, DEFAULT_TITLE);
    }
  })();
  return getMessage(id)!;
}

export function updateMessage(id: string, patch: { text: string; tools: AgentToolUse[]; status: AgentMessageStatus; error?: string | null }): void {
  db()
    .query("UPDATE agent_messages SET text = ?, tools = ?, status = ?, error = ? WHERE id = ?")
    .run(patch.text, JSON.stringify(patch.tools), patch.status, patch.error ?? null, id);
}

/** A turn interrupted by an engine restart never finishes; mark it so the phone stops waiting. */
export function failStreamingMessages(reason: string): number {
  return db().query("UPDATE agent_messages SET status = 'error', error = ? WHERE status = 'streaming'").run(reason).changes;
}
