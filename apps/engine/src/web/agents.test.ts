import { expect, test } from "bun:test";
import type { McpClient, McpClientCreated } from "@pulso/contract";
import { DELETE as revokeDELETE, PATCH as scopePATCH } from "@/app/api/web/admin/mcp/clients/[id]/route";
import { POST as createPOST } from "@/app/api/web/admin/mcp/clients/route";
import { GET as overviewGET } from "@/app/api/web/admin/mcp/route";
import { authenticateClient, recordCall } from "../mcp/clients";
import { agentsOverview, RECENT_CALLS, type AgentsOverview } from "./agents";

const BASE = "http://127.0.0.1:3281/api/web/admin/mcp";
const TAILNET = { "x-pulso-via": "tailnet" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const send = (method: string, body: unknown, headers: Record<string, string> = {}) => ({ method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

async function create(name: string, scope?: string): Promise<McpClientCreated> {
  const response = await createPOST(new Request(`${BASE}/clients`, send("POST", { name, scope })));
  expect(response.status).toBe(201);
  return response.json();
}

test("creating returns the secret once with the Mac endpoint on the request's port", async () => {
  const created = await create("Claude Code");
  expect(created.client.scope).toBe("read");
  expect(created.secret).toStartWith("pulso_mcp_");
  expect(created.connection.loopback.url).toBe("http://127.0.0.1:3281/api/mcp");
  expect(authenticateClient(`Bearer ${created.secret}`)?.id).toBe(created.client.id);
  expect(JSON.stringify(agentsOverview())).not.toContain(created.secret);
});

test("the overview carries recent calls newest first, counts refused ones, and puts revoked clients last", async () => {
  const live = await create("Telar", "read+write");
  const gone = await create("Viejo");
  for (let i = 0; i < RECENT_CALLS + 2; i++) recordCall(live.client.id, "get_profile", "ok", 1000 + i);
  recordCall(live.client.id, "log_meal", "refused", 5000);
  await revokeDELETE(new Request(`${BASE}/clients/${gone.client.id}`, { method: "DELETE" }), params(gone.client.id));

  const overview: AgentsOverview = await overviewGET(new Request(BASE)).json();
  const row = overview.clients.find((c) => c.id === live.client.id)!;
  expect(row.recent).toHaveLength(RECENT_CALLS);
  expect(row.recent[0]).toMatchObject({ tool: "log_meal", outcome: "refused" });
  expect(row.refused).toBe(1);
  expect(overview.clients.at(-1)!.revokedAt).toBeNumber();
  expect(overview.tools.read).toBeGreaterThan(0);
  expect(overview.tools.write).toBeGreaterThan(0);
});

test("scope changes; a revoked client stays revoked", async () => {
  const { client, secret } = await create("Delta");
  const raised: McpClient = await (await scopePATCH(new Request(`${BASE}/clients/${client.id}`, send("PATCH", { scope: "read+write" })), params(client.id))).json();
  expect(raised.scope).toBe("read+write");
  expect((await scopePATCH(new Request(`${BASE}/clients/x`, send("PATCH", { scope: "all" })), params("x"))).status).toBe(400);

  const revoked: McpClient = await (await revokeDELETE(new Request(`${BASE}/clients/${client.id}`, { method: "DELETE" }), params(client.id))).json();
  expect(revoked.revokedAt).toBeNumber();
  expect(authenticateClient(`Bearer ${secret}`)).toBeUndefined();
  expect((await scopePATCH(new Request(`${BASE}/clients/${client.id}`, send("PATCH", { scope: "read" })), params(client.id))).status).toBe(404);
  expect((await revokeDELETE(new Request(`${BASE}/clients/nope`, { method: "DELETE" }), params("nope"))).status).toBe(404);
});

test("bad input is refused", async () => {
  expect((await createPOST(new Request(`${BASE}/clients`, send("POST", { name: " " })))).status).toBe(400);
  expect((await createPOST(new Request(`${BASE}/clients`, send("POST", { name: "x", scope: "admin" })))).status).toBe(400);
});

test("every admin route answers only on the Mac", async () => {
  expect(overviewGET(new Request(BASE, { headers: TAILNET })).status).toBe(403);
  expect((await createPOST(new Request(`${BASE}/clients`, send("POST", { name: "x" }, TAILNET)))).status).toBe(403);
  expect((await scopePATCH(new Request(`${BASE}/clients/x`, send("PATCH", { scope: "read" }, TAILNET)), params("x"))).status).toBe(403);
  expect((await revokeDELETE(new Request(`${BASE}/clients/x`, { method: "DELETE", headers: TAILNET }), params("x"))).status).toBe(403);
});
