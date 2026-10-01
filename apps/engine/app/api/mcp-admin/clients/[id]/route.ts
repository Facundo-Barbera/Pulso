import { isScope, revokeClient, setScope } from "@/src/mcp/clients";
import { badRequest, jsonBody, macOnly, notFound, NO_STORE } from "../../guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** `McpClientUpdate` → `McpClient`: turns write access on or off. Revoked clients stay revoked. */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  const refused = macOnly(request);
  if (refused) return refused;
  const input = await jsonBody(request);
  if (!isScope(input?.scope)) return badRequest('El alcance es "read" o "read+write".');
  const client = setScope((await params).id, input.scope);
  return client ? Response.json(client, { headers: NO_STORE }) : notFound();
}

/** Revokes the client → `McpClient` with `revokedAt`. Its secret stops working; the audit log keeps its calls. */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  const refused = macOnly(request);
  if (refused) return refused;
  const client = revokeClient((await params).id);
  return client ? Response.json(client, { headers: NO_STORE }) : notFound();
}
