import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpClient } from "@pulso/contract";
import { z } from "zod";
import { describeFor, visibleTools } from "./access";
import { authenticateClient, recordCall } from "./clients";

const NO_STORE = { "cache-control": "no-store" };

const instructions = (client: McpClient) =>
  "Pulso is the person's personal health app: diet, training, body composition, sleep and medication. " +
  "Everything here is their private health data; use it only for what they asked. Times are epoch ms unless a tool says otherwise. " +
  (client.scope === "read"
    ? "This connection is read-only: it can look but not log or change anything. Write access is enabled per client in Pulso's settings on the Mac."
    : "This connection can also write: log and change things only when the person asked for it.") +
  (client.sensitive ? " It may also see the person's Sustancias log, which is especially private: never repeat it outside what they asked." : "");

const failure = (text: string): CallToolResult => ({ content: [{ type: "text", text }], isError: true });

/**
 * An MCP server for one client: the Coach's tools (agent/registry.ts) that its
 * scope allows. Tools outside the scope are not listed and calling one answers
 * as if it did not exist. Every call lands in the audit log, without arguments.
 */
export function serverFor(client: McpClient): McpServer {
  const tools = new Map(visibleTools(client.scope, client.sensitive).map((t) => [t.name, t]));
  const mcp = new McpServer({ name: "pulso", version: "1.0.0" }, { capabilities: { tools: {} }, instructions: instructions(client) });

  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...tools.values()].map((t) => {
      const { $schema, ...inputSchema } = z.toJSONSchema(z.object(t.inputSchema), { io: "input" });
      return { name: t.name, description: describeFor(t), inputSchema: inputSchema as { type: "object" }, annotations: t.annotations };
    }),
  }));

  mcp.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    const t = tools.get(name);
    if (!t) {
      recordCall(client.id, name.slice(0, 100), "refused");
      return failure(`Tool ${name} not found.`);
    }
    const args = z.object(t.inputSchema).safeParse(request.params.arguments ?? {});
    if (!args.success) {
      recordCall(client.id, name, "error");
      return failure(`Invalid arguments: ${args.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`);
    }
    try {
      const result = await t.handler(args.data, extra);
      recordCall(client.id, name, result.isError ? "error" : "ok");
      return result;
    } catch (error) {
      recordCall(client.id, name, "error");
      return failure((error as Error).message);
    }
  });

  return mcp;
}

/**
 * Streamable HTTP, stateless: every POST authenticates and gets a fresh server
 * with JSON responses, so there is no session to leak or expire. No GET stream.
 */
export async function handleMcp(request: Request): Promise<Response> {
  const client = authenticateClient(request.headers.get("authorization"));
  if (!client) {
    return Response.json(
      { code: "unauthorized", message: "Pulso needs this client's secret: Authorization: Bearer <secret>." },
      { status: 401, headers: { ...NO_STORE, "www-authenticate": 'Bearer realm="pulso"' } },
    );
  }
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...NO_STORE, allow: "POST" } });

  const mcp = serverFor(client);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await mcp.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await mcp.close();
  }
}
