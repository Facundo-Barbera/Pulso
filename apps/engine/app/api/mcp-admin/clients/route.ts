import { ENGINE_PORT, type McpClient, type McpClientCreated } from "@pulso/contract";
import { createClient, isScope, listClients } from "@/src/mcp/clients";
import { connectionCard } from "@/src/mcp/connection";
import { badRequest, jsonBody, macOnly, NO_STORE } from "../guard";

export const dynamic = "force-dynamic";

/** `McpClient[]`, newest first, revoked ones included. */
export function GET(request: Request): Response {
  const refused = macOnly(request);
  if (refused) return refused;
  const body: McpClient[] = listClients();
  return Response.json(body, { headers: NO_STORE });
}

/** `McpClientCreate` → `McpClientCreated`: the secret and connection card are shown this once. */
export async function POST(request: Request): Promise<Response> {
  const refused = macOnly(request);
  if (refused) return refused;
  const input = await jsonBody(request);
  if (!input || typeof input.name !== "string" || !input.name.trim()) return badRequest("Falta el nombre del cliente.");
  if (input.scope !== undefined && !isScope(input.scope)) return badRequest('El alcance es "read" o "read+write".');
  if (input.sensitive !== undefined && typeof input.sensitive !== "boolean") return badRequest("sensitive es true o false.");
  const { client, secret } = createClient({ name: input.name, scope: input.scope, sensitive: input.sensitive });
  const port = Number(new URL(request.url).port) || ENGINE_PORT;
  const body: McpClientCreated = { client, secret, connection: connectionCard(secret, port) };
  return Response.json(body, { status: 201, headers: NO_STORE });
}
