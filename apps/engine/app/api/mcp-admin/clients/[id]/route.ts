import { parseUpdate, revokeClient, updateClient } from "@/src/mcp/clients";
import { badRequest, jsonBody, macOnly, notFound, NO_STORE } from "../../guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** `McpClientUpdate` → `McpClient`: turns write access or the sensitive grant on or off. Revoked clients stay revoked. */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  const refused = macOnly(request);
  if (refused) return refused;
  const update = parseUpdate(await jsonBody(request));
  if (typeof update === "string") return badRequest(update);
  const client = updateClient((await params).id, update);
  return client ? Response.json(client, { headers: NO_STORE }) : notFound();
}

/** Revokes the client → `McpClient` with `revokedAt`. Its secret stops working; the audit log keeps its calls. */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  const refused = macOnly(request);
  if (refused) return refused;
  const client = revokeClient((await params).id);
  return client ? Response.json(client, { headers: NO_STORE }) : notFound();
}
