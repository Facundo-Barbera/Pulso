import { ENGINE_PORT, MCP_PATH, TAILNET_PORT, type McpConnection, type McpEndpoint } from "@pulso/contract";
import { tailnetIp } from "../../scripts/tailnet-ip.mjs";

function endpoint(url: string, secret: string): McpEndpoint {
  return {
    url,
    claudeCode: `claude mcp add --transport http pulso ${url} --header "Authorization: Bearer ${secret}"`,
    json: JSON.stringify({ mcpServers: { pulso: { type: "http", url, headers: { Authorization: `Bearer ${secret}` } } } }, null, 2),
  };
}

/** Where a client reaches Pulso with `secret`: this Mac's loopback, and the tailnet proxy when Tailscale is up. */
export function connectionCard(secret: string, port = ENGINE_PORT): McpConnection {
  const ip = tailnetIp();
  return {
    loopback: endpoint(`http://127.0.0.1:${port}${MCP_PATH}`, secret),
    tailnet: ip ? endpoint(`http://${ip}:${TAILNET_PORT}${MCP_PATH}`, secret) : null,
  };
}
