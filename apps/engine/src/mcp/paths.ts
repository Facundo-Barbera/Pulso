import { MCP_PATH } from "@pulso/contract";

/**
 * The MCP endpoint, which checks each client's secret itself and so may answer
 * the tailnet. Exact match: `/api/mcp-admin/*` is NOT this and stays Mac-only.
 * Pure, for the tailnet gate.
 */
export function isMcpPath(pathname: string): boolean {
  return (pathname.replace(/\/+$/, "") || "/") === MCP_PATH;
}
