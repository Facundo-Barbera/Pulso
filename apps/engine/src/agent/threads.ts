import { randomUUID } from "node:crypto";
import type { AgentAttachment, AgentMessage, AgentMessageSource, AgentMessageStatus, AgentProduct, AgentThread, FoodProduct } from "@pulso/contract";
import { db } from "../db";
import type { StoredTool } from "./events";

export const DEFAULT_TITLE = "Nueva conversación";

type ThreadRow = { id: string; title: string; sdk_session_id: string | null; created_at: number; updated_at: number; preview: string | null };
export type MessageRow = {
  id: string;
  thread_id: string;
  context_id: string | null;
  source: string | null;
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

const toMessage = (row: MessageRow, attachments: AgentAttachment[] = [], products: AgentProduct[] = []): AgentMessage => ({
  id: row.id,
  threadId: row.thread_id,
  contextId: row.context_id,
  source: row.source ? (JSON.parse(row.source) as AgentMessageSource) : null,
  role: row.role,
  text: row.text,
  attachments,
  products,
  // How to undo stays in the engine.
  tools: (JSON.parse(row.tools) as StoredTool[]).map(({ revert: _revert, ...tool }) => tool),
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
  return withExtras(rows);
}

/** Rows as clients see them, with their photos and products (read for these messages only). */
export function withExtras(rows: MessageRow[]): AgentMessage[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const photos = attachmentsOf({ messageIds: ids });
  const products = productsOf({ messageIds: ids });
  return rows.map((row) => toMessage(row, photos.get(row.id), products.get(row.id)));
}

type ProductRow = { message_id: string; barcode: string; product_json: string | null };

const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");

/** Scanned products by message id, in the order they were added. */
function productsOf(where: { messageIds: string[] } | { messageId: string }): Map<string, AgentProduct[]> {
  const ids = "messageIds" in where ? where.messageIds : [where.messageId];
  const rows = db()
    .query<ProductRow, string[]>(`SELECT * FROM agent_message_products WHERE message_id IN (${marks(ids.length)}) ORDER BY position`)
    .all(...ids);
  const byMessage = new Map<string, AgentProduct[]>();
  for (const row of rows) {
    const product = row.product_json ? (JSON.parse(row.product_json) as FoodProduct) : null;
    byMessage.set(row.message_id, [...(byMessage.get(row.message_id) ?? []), { barcode: row.barcode, product }]);
  }
  return byMessage;
}

/** Photos by message id, in the order they were sent. */
function attachmentsOf(where: { messageIds: string[] } | { messageId: string }): Map<string, AgentAttachment[]> {
  const ids = "messageIds" in where ? where.messageIds : [where.messageId];
  const rows = db()
    .query<AttachmentRow, string[]>(`SELECT * FROM agent_attachments WHERE message_id IN (${marks(ids.length)}) ORDER BY position`)
    .all(...ids);
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
  return row ? toMessage(row, attachmentsOf({ messageId: id }).get(id), productsOf({ messageId: id }).get(id)) : undefined;
}

export function addMessage(
  threadId: string,
  role: AgentMessage["role"],
  text: string,
  status: AgentMessageStatus,
  attachments: AgentAttachment[] = [],
  products: AgentProduct[] = [],
  source: AgentMessageSource | null = null,
): AgentMessage {
  const now = Date.now();
  const id = randomUUID();
  db().transaction(() => {
    // In the perpetual conversation a message belongs to the active context; elsewhere context_id stays NULL.
    db()
      .query(
        `INSERT INTO agent_messages (id, thread_id, context_id, source, role, text, status, created_at)
         VALUES (?, ?, (SELECT active_context_id FROM agent_conversation WHERE thread_id = ?), ?, ?, ?, ?, ?)`,
      )
      .run(id, threadId, threadId, source && JSON.stringify(source), role, text, status, now);
    attachments.forEach((a, position) => {
      db().query("INSERT INTO agent_attachments (id, message_id, position, width, height) VALUES (?, ?, ?, ?, ?)").run(a.id, id, position, a.width, a.height);
    });
    products.forEach((p, position) => {
      db()
        .query("INSERT INTO agent_message_products (message_id, position, barcode, product_json) VALUES (?, ?, ?, ?)")
        .run(id, position, p.barcode, p.product && JSON.stringify(p.product));
    });
    db().query("UPDATE agent_threads SET updated_at = ? WHERE id = ?").run(now, threadId);
    if (role === "user") {
      const scanned = products[0]?.product?.name;
      const title = text.trim()
        ? titleFrom(text)
        : scanned
          ? titleFrom(scanned)
          : attachments.length > 1
            ? "Fotos"
            : attachments.length
              ? "Foto"
              : products.length
                ? "Producto"
                : DEFAULT_TITLE;
      db().query("UPDATE agent_threads SET title = ? WHERE id = ? AND title = ?").run(title, threadId, DEFAULT_TITLE);
    }
  })();
  return getMessage(id)!;
}

/** A message's tools as saved, with how to undo each. */
export function storedTools(messageId: string): StoredTool[] {
  const row = db().query<{ tools: string }, [string]>("SELECT tools FROM agent_messages WHERE id = ?").get(messageId);
  return row ? (JSON.parse(row.tools) as StoredTool[]) : [];
}

export function setTools(messageId: string, tools: StoredTool[]): void {
  db().query("UPDATE agent_messages SET tools = ? WHERE id = ?").run(JSON.stringify(tools), messageId);
}

export function updateMessage(id: string, patch: { text: string; tools: StoredTool[]; status: AgentMessageStatus; error?: string | null }): void {
  db()
    .query("UPDATE agent_messages SET text = ?, tools = ?, status = ?, error = ? WHERE id = ?")
    .run(patch.text, JSON.stringify(patch.tools), patch.status, patch.error ?? null, id);
}

/** A turn interrupted by an engine restart never finishes; mark it so the phone stops waiting. */
export function failStreamingMessages(reason: string): number {
  return db().query("UPDATE agent_messages SET status = 'error', error = ? WHERE status = 'streaming'").run(reason).changes;
}
