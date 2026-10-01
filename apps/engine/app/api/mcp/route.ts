import { handleMcp } from "@/src/mcp/server";

export const dynamic = "force-dynamic";

/**
 * Pulso's tools for other agents, over MCP Streamable HTTP. Each client sends
 * its own secret; on the tailnet the gate lets this path through (isMcpPath).
 */
export const POST = handleMcp;
export const GET = handleMcp;
export const DELETE = handleMcp;
