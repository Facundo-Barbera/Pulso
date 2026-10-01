import { ENGINE_PORT, type McpClientCreated } from "@pulso/contract";
import { createClient, isScope } from "@/src/mcp/clients";
import { connectionCard } from "@/src/mcp/connection";
import { json, loopbackOnly } from "../../../http";

export const dynamic = "force-dynamic";

/** `McpClientCreate` → `McpClientCreated` (201): the secret and connection card, shown this once. The Mac only. */
export async function POST(request: Request): Promise<Response> {
  const refused = loopbackOnly(request);
  if (refused) return refused;
  const input = (await request.json().catch(() => undefined)) as { name?: unknown; scope?: unknown } | undefined;
  if (typeof input?.name !== "string" || !input.name.trim()) return json({ code: "invalid_request", message: "Falta el nombre del agente." }, 400);
  if (input.scope !== undefined && !isScope(input.scope)) return json({ code: "invalid_request", message: 'El alcance es "read" o "read+write".' }, 400);
  const { client, secret } = createClient({ name: input.name, scope: input.scope });
  const port = Number(new URL(request.url).port) || ENGINE_PORT;
  const body: McpClientCreated = { client, secret, connection: connectionCard(secret, port) };
  return json(body, 201);
}
