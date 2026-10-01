/**
 * What Ajustes › Agentes (MCP) draws: every external MCP client with its last
 * calls, and how many tools each scope reaches. Admin data: only the Mac
 * renders it, and `GET /api/web/admin/mcp` answers on loopback only.
 */
import type { McpAuditEntry, McpClient } from "@pulso/contract";
import { toolInfos } from "../mcp/access";
import { auditLog, listClients } from "../mcp/clients";

export type AgentClient = McpClient & {
  /** newest first, at most `RECENT_CALLS` */
  recent: McpAuditEntry[];
  /** refused calls among `recent`: the client tried a tool its scope hides */
  refused: number;
};

export type AgentsOverview = {
  /** live clients first, then revoked; each group newest first */
  clients: AgentClient[];
  tools: { read: number; write: number };
};

export const RECENT_CALLS = 8;

export function agentsOverview(): AgentsOverview {
  const clients = listClients()
    .map((client): AgentClient => {
      const recent = auditLog({ clientId: client.id, limit: RECENT_CALLS });
      return { ...client, recent, refused: recent.filter((e) => e.outcome === "refused").length };
    })
    .sort((a, b) => Number(a.revokedAt !== null) - Number(b.revokedAt !== null));
  const tools = toolInfos();
  return { clients, tools: { read: tools.filter((t) => t.access === "read").length, write: tools.filter((t) => t.access === "write").length } };
}
