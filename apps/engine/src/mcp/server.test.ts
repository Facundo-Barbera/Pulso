import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpScope } from "@pulso/contract";
import { auditLog, createClient, revokeClient, setScope, setSensitive } from "./clients";
import { handleMcp } from "./server";

const URL_ = new URL("http://127.0.0.1:3230/api/mcp");

/** A real MCP client whose HTTP goes straight into the route handler. */
async function connect(secret: string): Promise<Client> {
  const client = new Client({ name: "test", version: "0" });
  const transport = new StreamableHTTPClientTransport(URL_, {
    requestInit: { headers: { authorization: `Bearer ${secret}` } },
    fetch: (url, init) => handleMcp(new Request(url, init)),
  });
  await client.connect(transport);
  return client;
}

const newClient = (scope: McpScope = "read") => createClient({ name: `test ${scope}`, scope });
const textOf = (result: Awaited<ReturnType<Client["callTool"]>>) => (result.content as { text: string }[])[0]!.text;

const initialize = (secret?: string) =>
  handleMcp(
    new Request(URL_, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }),
    }),
  );

describe("auth", () => {
  test("no, wrong or revoked secrets get 401", async () => {
    expect((await initialize()).status).toBe(401);
    expect((await initialize("pulso_mcp_nope")).status).toBe(401);
    const { client, secret } = newClient();
    expect((await initialize(secret)).status).toBe(200);
    revokeClient(client.id);
    expect((await initialize(secret)).status).toBe(401);
  });

  test("the SDK client refuses to connect without a valid secret", async () => {
    await expect(connect("pulso_mcp_nope")).rejects.toThrow();
  });
});

describe("scopes", () => {
  test("a read-only client lists no write tool and cannot call one", async () => {
    const { client: row, secret } = newClient("read");
    const mcp = await connect(secret);
    const names = (await mcp.listTools()).tools.map((t) => t.name);
    expect(names).toContain("get_profile");
    expect(names).not.toContain("update_profile");

    const refused = await mcp.callTool({ name: "update_profile", arguments: { notes: "x" } });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain("not found");

    const read = await mcp.callTool({ name: "get_profile", arguments: {} });
    expect(read.isError).toBeFalsy();
    await mcp.close();

    expect(auditLog({ clientId: row.id }).map((a) => [a.tool, a.outcome])).toEqual([
      ["get_profile", "ok"],
      ["update_profile", "refused"],
    ]);
  });

  test("enabling write lets the same secret write", async () => {
    const { client: row, secret } = newClient("read");
    setScope(row.id, "read+write");
    const mcp = await connect(secret);
    expect((await mcp.listTools()).tools.map((t) => t.name)).toContain("update_profile");
    const wrote = await mcp.callTool({ name: "update_profile", arguments: { notes: "Prefiere entrenar temprano" } });
    expect(wrote.isError).toBeFalsy();
    expect(JSON.parse(textOf(wrote)).notes).toBe("Prefiere entrenar temprano");
    await mcp.close();
  });

  test("Sustancias stays hidden, even with write, until the client is granted the sensitive scope", async () => {
    const { client: row, secret } = newClient("read+write");
    expect(row.sensitive).toBe(false);
    let mcp = await connect(secret);
    let names = (await mcp.listTools()).tools.map((t) => t.name);
    expect(names).toContain("update_profile");
    expect(names.filter((n) => n.includes("substance"))).toEqual([]);
    const refused = await mcp.callTool({ name: "substance_summary", arguments: {} });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain("not found");
    await mcp.close();
    expect(auditLog({ clientId: row.id })[0]).toMatchObject({ tool: "substance_summary", outcome: "refused" });

    expect(setSensitive(row.id, true)?.sensitive).toBe(true);
    mcp = await connect(secret);
    names = (await mcp.listTools()).tools.map((t) => t.name);
    expect(names).toContain("substance_summary");
    expect(names).toContain("log_substance_use");
    expect((await mcp.listTools()).tools.find((t) => t.name === "substance_summary")!.description).toContain("private health data");
    expect((await mcp.callTool({ name: "substance_summary", arguments: {} })).isError).toBeFalsy();
    await mcp.close();

    // A read-only client with the grant sees the sensitive reads but not their writes.
    const reader = newClient("read");
    setSensitive(reader.client.id, true);
    mcp = await connect(reader.secret);
    names = (await mcp.listTools()).tools.map((t) => t.name);
    expect(names).toContain("substance_summary");
    expect(names).not.toContain("log_substance_use");
    await mcp.close();
  });

  test("tool schemas are JSON Schema objects and personal tools carry the warning", async () => {
    const mcp = await connect(newClient("read+write").secret);
    const tools = (await mcp.listTools()).tools;
    const workouts = tools.find((t) => t.name === "list_workouts")!;
    expect(workouts.inputSchema.type).toBe("object");
    expect(Object.keys(workouts.inputSchema.properties ?? {})).toEqual(["limit"]);
    expect(tools.find((t) => t.name === "list_medications")!.description).toContain("private health data");
    await mcp.close();
  });

  test("invalid arguments are an error, audited without the arguments", async () => {
    const { client: row, secret } = newClient("read");
    const mcp = await connect(secret);
    const bad = await mcp.callTool({ name: "list_workouts", arguments: { limit: 999 } });
    expect(bad.isError).toBe(true);
    await mcp.close();
    const [entry] = auditLog({ clientId: row.id });
    expect(entry).toMatchObject({ tool: "list_workouts", outcome: "error", clientName: "test read" });
    expect(Object.keys(entry!).sort()).toEqual(["at", "clientId", "clientName", "id", "outcome", "tool"]);
  });

  test("GET has no stream: 405", async () => {
    const { secret } = newClient();
    const response = await handleMcp(new Request(URL_, { headers: { authorization: `Bearer ${secret}` } }));
    expect(response.status).toBe(405);
  });
});
