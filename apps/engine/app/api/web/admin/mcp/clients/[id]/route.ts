import { parseUpdate, revokeClient, updateClient } from "@/src/mcp/clients";
import { json, loopbackOnly } from "../../../../http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const notFound = () => json({ code: "not_found", message: "No existe ese agente." }, 404);

/** `{ scope?, sensitive? }` → `McpClient`: turns write access or the sensitive grant (Sustancias) on or off. Revoked clients stay revoked. The Mac only. */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  const refused = loopbackOnly(request);
  if (refused) return refused;
  const update = parseUpdate(await request.json().catch(() => undefined));
  if (typeof update === "string") return json({ code: "invalid_request", message: update }, 400);
  const client = updateClient((await params).id, update);
  return client ? json(client) : notFound();
}

/** Revokes → `McpClient` with `revokedAt`. Its secret stops working; its calls stay in the log. The Mac only. */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  const refused = loopbackOnly(request);
  if (refused) return refused;
  const client = revokeClient((await params).id);
  return client ? json(client) : notFound();
}
