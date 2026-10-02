import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { McpAuditEntry, McpClient, McpClientUpdate, McpScope } from "@pulso/contract";
import { db } from "../db";

type Row = { id: string; name: string; scope: McpScope; sensitive: number; created_at: number; last_used_at: number | null; revoked_at: number | null };

const COLUMNS = "id, name, scope, sensitive, created_at, last_used_at, revoked_at";
const toClient = (r: Row): McpClient => ({ id: r.id, name: r.name, scope: r.scope, sensitive: r.sensitive === 1, createdAt: r.created_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at });

// Only the hash is stored, like device tokens: a leaked database does not leak working secrets.
const hash = (secret: string) => createHash("sha256").update(secret).digest("hex");

export const isScope = (value: unknown): value is McpScope => value === "read" || value === "read+write";

/** A new client, read-only and without sensitive data unless asked. The secret is returned this once and never again. */
export function createClient(input: { name: string; scope?: McpScope; sensitive?: boolean }, now = Date.now()): { client: McpClient; secret: string } {
  const secret = `pulso_mcp_${randomBytes(32).toString("base64url")}`;
  const client: McpClient = { id: randomUUID(), name: input.name.trim().slice(0, 80) || "Agente", scope: input.scope ?? "read", sensitive: input.sensitive === true, createdAt: now, lastUsedAt: null, revokedAt: null };
  db().query("INSERT INTO mcp_clients (id, name, secret_hash, scope, sensitive, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(client.id, client.name, hash(secret), client.scope, client.sensitive ? 1 : 0, now);
  return { client, secret };
}

export function getClient(id: string): McpClient | undefined {
  const row = db().query<Row, [string]>(`SELECT ${COLUMNS} FROM mcp_clients WHERE id = ?`).get(id);
  return row ? toClient(row) : undefined;
}

export function listClients(): McpClient[] {
  return db().query<Row, []>(`SELECT ${COLUMNS} FROM mcp_clients ORDER BY created_at DESC`).all().map(toClient);
}

/** Undefined when there is no such client or it is revoked (a revoked secret stays dead). */
export function setScope(id: string, scope: McpScope): McpClient | undefined {
  db().query("UPDATE mcp_clients SET scope = ? WHERE id = ? AND revoked_at IS NULL").run(scope, id);
  const client = getClient(id);
  return client && !client.revokedAt ? client : undefined;
}

/** Grants or withdraws the sensitive scope (Sustancias). Undefined when there is no such client or it is revoked. */
export function setSensitive(id: string, sensitive: boolean): McpClient | undefined {
  db().query("UPDATE mcp_clients SET sensitive = ? WHERE id = ? AND revoked_at IS NULL").run(sensitive ? 1 : 0, id);
  const client = getClient(id);
  return client && !client.revokedAt ? client : undefined;
}

/** A PATCH body: a scope, the sensitive grant, or both. A string is the Spanish reason it is not valid. */
export function parseUpdate(input: unknown): McpClientUpdate | string {
  const body = (input && typeof input === "object" ? input : {}) as { scope?: unknown; sensitive?: unknown };
  if (body.scope === undefined && body.sensitive === undefined) return "Indica el alcance o el acceso a datos sensibles.";
  if (body.scope !== undefined && !isScope(body.scope)) return 'El alcance es "read" o "read+write".';
  if (body.sensitive !== undefined && typeof body.sensitive !== "boolean") return "sensitive es true o false.";
  return { scope: body.scope, sensitive: body.sensitive };
}

/** Applies a parsed update. Undefined when there is no such client or it is revoked. */
export function updateClient(id: string, update: McpClientUpdate): McpClient | undefined {
  let client = getClient(id);
  if (update.scope !== undefined) client = setScope(id, update.scope);
  if (update.sensitive !== undefined) client = setSensitive(id, update.sensitive);
  return client && !client.revokedAt ? client : undefined;
}

export function revokeClient(id: string, now = Date.now()): McpClient | undefined {
  db().query("UPDATE mcp_clients SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?").run(now, id);
  return getClient(id);
}

/** The live client behind `Authorization: Bearer <secret>`, or undefined. */
export function authenticateClient(header: string | null | undefined, now = Date.now()): McpClient | undefined {
  const secret = /^Bearer\s+(.+)$/i.exec(header ?? "")?.[1]?.trim();
  if (!secret) return undefined;
  const row = db().query<Row, [string]>(`SELECT ${COLUMNS} FROM mcp_clients WHERE secret_hash = ? AND revoked_at IS NULL`).get(hash(secret));
  if (!row) return undefined;
  db().query("UPDATE mcp_clients SET last_used_at = ? WHERE id = ?").run(now, row.id);
  return toClient({ ...row, last_used_at: now });
}

export function recordCall(clientId: string, tool: string, outcome: McpAuditEntry["outcome"], now = Date.now()): void {
  db().query("INSERT INTO mcp_audit (client_id, tool, outcome, at) VALUES (?, ?, ?, ?)").run(clientId, tool, outcome, now);
}

/** Newest first. */
export function auditLog(options: { clientId?: string; limit?: number } = {}): McpAuditEntry[] {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);
  return db()
    .query<{ id: number; client_id: string; name: string; tool: string; outcome: McpAuditEntry["outcome"]; at: number }, [string | null, string | null, number]>(
      `SELECT a.id, a.client_id, c.name, a.tool, a.outcome, a.at FROM mcp_audit a JOIN mcp_clients c ON c.id = a.client_id
       WHERE (? IS NULL OR a.client_id = ?) ORDER BY a.at DESC, a.id DESC LIMIT ?`,
    )
    .all(options.clientId ?? null, options.clientId ?? null, limit)
    .map((r) => ({ id: r.id, clientId: r.client_id, clientName: r.name, tool: r.tool, outcome: r.outcome, at: r.at }));
}
