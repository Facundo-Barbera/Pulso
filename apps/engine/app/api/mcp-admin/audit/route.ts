import type { McpAuditEntry } from "@pulso/contract";
import { auditLog } from "@/src/mcp/clients";
import { macOnly, NO_STORE } from "../guard";

export const dynamic = "force-dynamic";

/** `McpAuditEntry[]`, newest first. `?clientId=` filters, `?limit=` (default 100, max 1000). */
export function GET(request: Request): Response {
  const refused = macOnly(request);
  if (refused) return refused;
  const query = new URL(request.url).searchParams;
  const body: McpAuditEntry[] = auditLog({ clientId: query.get("clientId") ?? undefined, limit: Number(query.get("limit")) || undefined });
  return Response.json(body, { headers: NO_STORE });
}
