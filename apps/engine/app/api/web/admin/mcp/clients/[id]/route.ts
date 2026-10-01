import { isScope, revokeClient, setScope } from "@/src/mcp/clients";
import { json, loopbackOnly } from "../../../../http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const notFound = () => json({ code: "not_found", message: "No existe ese agente." }, 404);

/** `{ scope }` → `McpClient`: turns write access on or off. Revoked clients stay revoked. The Mac only. */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  const refused = loopbackOnly(request);
  if (refused) return refused;
  const scope = ((await request.json().catch(() => undefined)) as { scope?: unknown } | undefined)?.scope;
  if (!isScope(scope)) return json({ code: "invalid_request", message: 'El alcance es "read" o "read+write".' }, 400);
  const client = setScope((await params).id, scope);
  return client ? json(client) : notFound();
}

/** Revokes → `McpClient` with `revokedAt`. Its secret stops working; its calls stay in the log. The Mac only. */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  const refused = loopbackOnly(request);
  if (refused) return refused;
  const client = revokeClient((await params).id);
  return client ? json(client) : notFound();
}
