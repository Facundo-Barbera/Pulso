import { expect, test } from "bun:test";
import type { McpAuditEntry, McpClient, McpClientCreated, McpToolInfo } from "@pulso/contract";
import { GET as auditGET } from "@/app/api/mcp-admin/audit/route";
import { DELETE as revokeDELETE, PATCH as scopePATCH } from "@/app/api/mcp-admin/clients/[id]/route";
import { GET as listGET, POST as createPOST } from "@/app/api/mcp-admin/clients/route";
import { GET as toolsGET } from "@/app/api/mcp-admin/tools/route";
import { authenticateClient, recordCall } from "./clients";

const BASE = "http://127.0.0.1:3281/api/mcp-admin";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (method: string, body: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

async function create(name: string, scope?: string): Promise<McpClientCreated> {
  const response = await createPOST(new Request(`${BASE}/clients`, json("POST", { name, scope })));
  expect(response.status).toBe(201);
  return response.json();
}

test("creating a client returns the secret once, read-only by default, with a connection card", async () => {
  const created = await create("Claude Code");
  expect(created.client.scope).toBe("read");
  expect(created.secret).toStartWith("pulso_mcp_");
  expect(created.connection.loopback.url).toBe("http://127.0.0.1:3281/api/mcp");
  expect(created.connection.loopback.claudeCode).toBe(
    `claude mcp add --transport http pulso http://127.0.0.1:3281/api/mcp --header "Authorization: Bearer ${created.secret}"`,
  );
  expect(JSON.parse(created.connection.loopback.json).mcpServers.pulso).toEqual({
    type: "http",
    url: "http://127.0.0.1:3281/api/mcp",
    headers: { Authorization: `Bearer ${created.secret}` },
  });
  expect(authenticateClient(`Bearer ${created.secret}`)?.id).toBe(created.client.id);

  const listed: McpClient[] = await listGET(new Request(`${BASE}/clients`)).json();
  const row = listed.find((c) => c.id === created.client.id)!;
  expect(row.name).toBe("Claude Code");
  expect(JSON.stringify(listed)).not.toContain(created.secret);
});

test("bad input is refused", async () => {
  expect((await createPOST(new Request(`${BASE}/clients`, json("POST", { name: " " })))).status).toBe(400);
  expect((await createPOST(new Request(`${BASE}/clients`, json("POST", { name: "x", scope: "admin" })))).status).toBe(400);
  expect((await scopePATCH(new Request(`${BASE}/clients/x`, json("PATCH", { scope: "all" })), params("x"))).status).toBe(400);
  expect((await scopePATCH(new Request(`${BASE}/clients/x`, json("PATCH", { scope: "read" })), params("x"))).status).toBe(404);
});

test("scope changes and revocation", async () => {
  const { client, secret } = await create("Delta", "read+write");
  expect(client.scope).toBe("read+write");

  const lowered: McpClient = await (await scopePATCH(new Request(`${BASE}/clients/${client.id}`, json("PATCH", { scope: "read" })), params(client.id))).json();
  expect(lowered.scope).toBe("read");

  const revoked: McpClient = await (await revokeDELETE(new Request(`${BASE}/clients/${client.id}`, { method: "DELETE" }), params(client.id))).json();
  expect(revoked.revokedAt).toBeNumber();
  expect(authenticateClient(`Bearer ${secret}`)).toBeUndefined();
  // A revoked client cannot be brought back by changing its scope.
  expect((await scopePATCH(new Request(`${BASE}/clients/${client.id}`, json("PATCH", { scope: "read+write" })), params(client.id))).status).toBe(404);
});

test("the audit log lists calls newest first, filterable by client", async () => {
  const { client } = await create("Telar");
  recordCall(client.id, "get_profile", "ok", 1000);
  recordCall(client.id, "log_meal", "refused", 2000);
  const entries: McpAuditEntry[] = await auditGET(new Request(`${BASE}/audit?clientId=${client.id}`)).json();
  expect(entries.map((e) => [e.tool, e.outcome, e.clientName])).toEqual([
    ["log_meal", "refused", "Telar"],
    ["get_profile", "ok", "Telar"],
  ]);
});

test("tools are listed with their access", async () => {
  const tools: McpToolInfo[] = await toolsGET(new Request(`${BASE}/tools`)).json();
  expect(tools.find((t) => t.name === "get_profile")?.access).toBe("read");
  expect(tools.find((t) => t.name === "log_meal")?.access).toBe("write");
});

test("admin answers only on the Mac, even if the gate let the tailnet through", async () => {
  const tailnet = { "x-pulso-via": "tailnet" };
  expect((await createPOST(new Request(`${BASE}/clients`, json("POST", { name: "x" }, tailnet)))).status).toBe(403);
  expect(listGET(new Request(`${BASE}/clients`, { headers: tailnet })).status).toBe(403);
  expect(auditGET(new Request(`${BASE}/audit`, { headers: tailnet })).status).toBe(403);
  expect(toolsGET(new Request(`${BASE}/tools`, { headers: tailnet })).status).toBe(403);
  expect((await revokeDELETE(new Request(`${BASE}/clients/x`, { method: "DELETE", headers: tailnet }), params("x"))).status).toBe(403);
});
