/**
 * Pulso as an MCP server for other agents (Claude Code, Telar, Delta…).
 * Each client has its own secret; read-only unless write is enabled for it.
 * The admin API (`/api/mcp-admin/*`) answers on the Mac only.
 */

/** Path of the Streamable HTTP endpoint, on loopback and through the tailnet proxy. */
export const MCP_PATH = "/api/mcp";

export type McpScope = "read" | "read+write";

export type McpClient = {
  id: string;
  name: string;
  scope: McpScope;
  createdAt: number;
  lastUsedAt: number | null;
  /** Set once revoked; the secret stops working and the row stays for the audit log. */
  revokedAt: number | null;
};

/** One URL a client can use, with ready-to-paste config. */
export type McpEndpoint = {
  url: string;
  /** `claude mcp add --transport http pulso <url> --header "Authorization: Bearer …"` */
  claudeCode: string;
  /** `{"mcpServers":{"pulso":{"type":"http","url":…,"headers":{…}}}}`, pretty-printed. */
  json: string;
};

export type McpConnection = {
  /** From this Mac. */
  loopback: McpEndpoint;
  /** From other tailnet machines; null when this Mac has no Tailscale IP. */
  tailnet: McpEndpoint | null;
};

/** POST /api/mcp-admin/clients */
export type McpClientCreate = { name: string; scope?: McpScope };
/** The secret is returned this once and never again. */
export type McpClientCreated = { client: McpClient; secret: string; connection: McpConnection };
/** PATCH /api/mcp-admin/clients/:id */
export type McpClientUpdate = { scope: McpScope };

/** A tool as exposed to clients: `write` tools are hidden from read-only ones. */
export type McpToolInfo = { name: string; access: "read" | "write" };

/** One call. Never holds arguments or results, only which tool and how it went. */
export type McpAuditEntry = {
  id: number;
  clientId: string;
  clientName: string;
  tool: string;
  outcome: "ok" | "error" | "refused";
  at: number;
};
